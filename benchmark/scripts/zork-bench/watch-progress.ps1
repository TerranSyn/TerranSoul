# benchmark/scripts/zork-bench/watch-progress.ps1
#
# Standalone BENCH-ZORK-1.5 progress watcher. Survives the parent shell
# closing (unlike the Start-Job watcher inside run-canonical.ps1) by
# reading state from disk and refreshing benchmark/progress.md +
# .canonical-status.json on a fixed cadence.
#
# Counts an episode as "complete" when its jsonl file contains an
# `episode_end` event (first line of the file by convention). Works even
# when the orchestrator that started the docker runs is gone.
#
# Usage:
#   pwsh -File benchmark/scripts/zork-bench/watch-progress.ps1
#   pwsh -File benchmark/scripts/zork-bench/watch-progress.ps1 -Once
#   pwsh -File benchmark/scripts/zork-bench/watch-progress.ps1 -IntervalMinutes 2

param(
    [int]$IntervalMinutes = 5,
    [int]$EpisodesPerArm  = 3,
    [string[]]$Arms       = @('none', 'zorkgpt-default', 'terransoul-brain'),
    [string]$OutDir       = '',
    [int]$MaxTurns        = 300,
    [string]$ChunkLabel   = 'BENCH-ZORK-1.5',
    [switch]$Once
)

$ErrorActionPreference = 'Continue'
$repoRoot   = (Resolve-Path "$PSScriptRoot/../../..").Path
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $outDir = Join-Path $repoRoot 'target-copilot-bench\bench-results\zork-bench'
} elseif ([System.IO.Path]::IsPathRooted($OutDir)) {
    $outDir = $OutDir
} else {
    $outDir = Join-Path $repoRoot $OutDir
}
$statusFile = Join-Path $outDir '.canonical-status.json'
$watcherLog = Join-Path $outDir '.watcher.log'
$progressMd = Join-Path $repoRoot 'benchmark\progress.md'
$totalEps   = $EpisodesPerArm * $Arms.Count

function Get-EpisodeStats {
    param([string]$Arm, [string]$OutDir, [int]$MaxTurns = 300)
    $stats = [pscustomobject]@{
        Done          = 0
        Scores        = @('-','-','-')
        Turns         = @('-','-','-')
        ActiveCount   = 0
        ActiveTurns   = @()   # per-active-episode turn counts
        TotalTurns    = 0     # sum of turns across active episodes
        MaxTotalTurns = 0     # max possible turns (active * MaxTurns)
    }
    # Bug-fixed: previous logic sorted by LastWriteTimeUtc DESC and broke at
    # EpisodesPerArm, which silently dropped older completed episodes when
    # retries piled up. We now iterate ALL files, dedupe by parsed episode
    # number, and prefer the file whose first line is an `episode_end`
    # event. This makes the watcher's `done` count match reality.
    $files = Get-ChildItem $OutDir -Filter "zork_bench_${Arm}_ep*.jsonl" -ErrorAction SilentlyContinue
    $perEp = @{}
    foreach ($f in $files) {
        # Extract `ep<N>` from filename: zork_bench_<arm>_ep<N>_<ts>.jsonl
        if ($f.Name -notmatch '_ep(\d+)_') { continue }
        $epN = [int]$matches[1]
        $first = $null
        try { $first = Get-Content $f.FullName -TotalCount 1 -ErrorAction Stop } catch {}
        $isEnd = $first -and $first.StartsWith('{"type": "episode_end"')
        $existing = $perEp[$epN]
        # Prefer a finished episode over an unfinished one; otherwise prefer
        # the most recently written file.
        if (-not $existing -or ($isEnd -and -not $existing.IsEnd) -or `
            (($isEnd -eq $existing.IsEnd) -and ($f.LastWriteTimeUtc -gt $existing.MTime))) {
            $perEp[$epN] = @{ File = $f.FullName; First = $first; IsEnd = $isEnd; MTime = $f.LastWriteTimeUtc }
        }
    }
    foreach ($epN in ($perEp.Keys | Sort-Object)) {
        $rec = $perEp[$epN]
        if (-not $rec.IsEnd) { continue }
        # Slot index is the 0-based ep number; cap at EpisodesPerArm.
        $slot = $epN - 1
        if ($slot -lt 0 -or $slot -ge $EpisodesPerArm) { continue }
        try {
            $obj = $rec.First | ConvertFrom-Json
            $stats.Scores[$slot] = "$($obj.final_score)"
            $stats.Turns[$slot]  = "$($obj.turns)"
            $stats.Done++
        } catch {}
    }
    # Active container heuristic: transcript files touched in the last 10 min
    $cutoff = (Get-Date).AddMinutes(-10)
    $activeFiles = Get-ChildItem $OutDir -Filter "zork_bench_${Arm}_ep*.transcript.txt" -ErrorAction SilentlyContinue |
                   Where-Object { $_.LastWriteTime -gt $cutoff }
    $stats.ActiveCount = $activeFiles.Count

    # Count REAL Zork turns in active transcript files. Previous logic used
    # lineCount/2, which inflated by ~5x for reasoning models like
    # gemma4:e4b that emit multi-line "thinking + action + goal" blocks per
    # turn (~6-10 transcript lines/turn). The authoritative signal is the
    # number of player command lines, which always begin with "> " by
    # convention in the bench transcript writer.
    foreach ($tf in $activeFiles) {
        $turnCount = 0
        try {
            $turnCount = (Select-String -Path $tf.FullName -Pattern '^> ' -ErrorAction SilentlyContinue | Measure-Object).Count
        } catch { $turnCount = 0 }
        if ($turnCount -lt 1) { $turnCount = 1 }
        $stats.ActiveTurns += $turnCount
        $stats.TotalTurns  += $turnCount
    }
    $stats.MaxTotalTurns = $stats.ActiveCount * $MaxTurns
    return $stats
}

function Update-Progress {
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

    # Load existing status (or initialize)
    $st = $null
    if (Test-Path $statusFile) {
        try { $st = Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    if (-not $st) {
        $st = @{
            episodes_per_arm = $EpisodesPerArm
            max_turns        = $MaxTurns
            model            = 'gemma4:e4b'
            arms             = @{}
            stages           = @()
            phase            = 'unknown'
            last_event       = 'standalone watcher started'
            started_at       = $now
        }
    }

    # Rebuild per-arm stats from disk
    $armsBlock = @{}
    $totalDone = 0
    $totalActive = 0
    $totalActiveTurns = 0
    $totalMaxTurns = 0
    foreach ($a in $Arms) {
        $s = Get-EpisodeStats -Arm $a -OutDir $outDir -MaxTurns $MaxTurns
        $armsBlock[$a] = @{
            final_scores    = $s.Scores
            turns           = $s.Turns
            wall_clock      = '-'
            episodes_done   = $s.Done
            active_episodes = $s.ActiveCount
            active_turns    = $s.ActiveTurns
            total_turns     = $s.TotalTurns
            max_total_turns = $s.MaxTotalTurns
        }
        $totalDone        += $s.Done
        $totalActive      += $s.ActiveCount
        $totalActiveTurns += $s.TotalTurns
        $totalMaxTurns    += $s.MaxTotalTurns
    }

    $st['arms']          = $armsBlock
    $st['episodes_done'] = $totalDone
    $st['updated_at']    = $now
    if ($totalActive -gt 0) {
        $st['phase'] = "running ($totalActive active episode(s))"
    } elseif ($totalDone -ge $totalEps) {
        $st['phase'] = 'done'
    } else {
        $st['phase'] = "idle ($totalDone/$totalEps eps complete)"
    }

    # Write status JSON
    $st | ConvertTo-Json -Depth 6 | Set-Content -Path $statusFile -Encoding UTF8

    # Compose human-readable progress block
    $pct = if ($totalEps -gt 0) { [math]::Round(100.0 * $totalDone / $totalEps, 1) } else { 0 }
    $elapsed = '-'
    if ($st.started_at) {
        try {
            $started = [datetime]::Parse($st.started_at, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
            $delta = (Get-Date).ToUniversalTime() - $started
            # Use floor of TotalHours; [int] uses banker's rounding and
            # produced nonsense like "13h26m" then "13h01m" the next cycle.
            $hoursPart = [math]::Floor($delta.TotalHours)
            $elapsed = "{0}h{1:00}m" -f $hoursPart, $delta.Minutes
        } catch {}
    }

    $armsLines = @()
    foreach ($a in $Arms) {
        $arm = $armsBlock[$a]
        $scores = ($arm.final_scores -join ', ')
        $turns  = ($arm.turns -join ', ')
        $activeTurnsStr = if ($arm.active_turns.Count -gt 0) { ($arm.active_turns -join '+') + "/$($MaxTurns * $arm.active_episodes)t" } else { '-' }
        $armsLines += ("arm={0,-22} done={1}/{2}  active={3}  turns_now={4}  scores=[{5}]  turns=[{6}]" -f `
            $a, $arm.episodes_done, $EpisodesPerArm, $arm.active_episodes, $activeTurnsStr, $scores, $turns)
    }

    $turnProgress = if ($totalMaxTurns -gt 0) { "  active_turns=$totalActiveTurns/${totalMaxTurns}" } else { '' }

    $block = @"
``````
TerranSoul $ChunkLabel progress (standalone watcher)
chunk:          $ChunkLabel
scope:          $($Arms.Count) arms × $EpisodesPerArm episodes × $($st.max_turns) turns
model:          $($st.model)
updated_at:     $now
elapsed:        $elapsed (since $($st.started_at))
phase:          $($st.phase)
progress_pct:   $pct%   ($totalDone / $totalEps episodes complete)
active_episodes: $totalActive (transcript touched in last 10 min)
active_turns:   $totalActiveTurns / $totalMaxTurns (approx turns in running episodes)

--- arms ---
$($armsLines -join "`n")
``````
"@

    # Update or insert the marked block in progress.md
    if (Test-Path $progressMd) {
        # 2026-05-28: `Get-Content -Raw` returns $null when the file is
        # empty (e.g. the operator manually cleared progress.md mid-run).
        # Defaulting to '' here avoids "You cannot call a method on a
        # null-valued expression" on the LastIndexOf below.
        $md = (Get-Content $progressMd -Raw -ErrorAction SilentlyContinue) ?? ''
        $startTag = '<!-- BENCH_PROGRESS_START -->'
        $endTag   = '<!-- BENCH_PROGRESS_END -->'
        $startIdx = $md.LastIndexOf($startTag)
        $endIdx   = $md.LastIndexOf($endTag)

        if ($startIdx -lt 0 -or $endIdx -le $startIdx) {
            # No markers — insert a fresh marked section right after the
            # `## <ChunkLabel> ...` heading so the live block is on top.
            $escapedChunk = [regex]::Escape($ChunkLabel)
            $headingMatch = [regex]::Match($md, "(?m)^## $escapedChunk.*$")
            if ($headingMatch.Success) {
                $insertAt = $headingMatch.Index + $headingMatch.Length
                $section = "`n`n$startTag`n`n$block`n`n$endTag`n"
                $md = $md.Substring(0, $insertAt) + $section + $md.Substring($insertAt)
            } else {
                # Append at the end as a fallback.
                $md += "`n`n## $ChunkLabel — live progress`n`n$startTag`n`n$block`n`n$endTag`n"
            }
        } else {
            $head = $md.Substring(0, $startIdx + $startTag.Length)
            $tail = $md.Substring($endIdx)
            $md = $head + "`n`n" + $block + "`n`n" + $tail
        }

        Set-Content -Path $progressMd -Value $md -Encoding UTF8 -NoNewline

        # Tick line (compact, single line per tick — now includes per-turn progress)
        $tick = "$now  [$($st.phase)]  pct=$pct% ($totalDone/$totalEps)  active=$totalActive  turns=$totalActiveTurns/${totalMaxTurns}  elapsed=$elapsed"
        Add-Content -Path $progressMd -Value $tick -Encoding UTF8
    }

    "$now wrote progress.md pct=$pct phase=$($st.phase) done=$totalDone active=$totalActive turns=$totalActiveTurns/$totalMaxTurns" |
        Add-Content -Path $watcherLog
    Write-Host "[watch] $now pct=$pct% done=$totalDone/$totalEps active=$totalActive turns=$totalActiveTurns/$totalMaxTurns phase=$($st.phase)"
}

Update-Progress
if ($Once) { return }

Write-Host "[watch] entering loop (interval=$IntervalMinutes min). Ctrl+C to stop."
while ($true) {
    Start-Sleep -Seconds ($IntervalMinutes * 60)
    try { Update-Progress } catch {
        "$(Get-Date -AsUTC -Format o) watcher error: $_" | Add-Content -Path $watcherLog
        Write-Host "[watch] error: $_"
    }
}
