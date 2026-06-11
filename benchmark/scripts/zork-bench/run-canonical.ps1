# benchmark/scripts/zork-bench/run-canonical.ps1
#
# BENCH-ZORK-1.5 canonical orchestrator.
# Runs 3 arms × 3 episodes × 300 turns sequentially against the gemma4:e4b
# Ollama model inside the zork-bench docker image. Writes a per-arm log,
# and a parallel watcher updates benchmark/progress.md every 15 minutes.
#
# Usage (from repo root):
#   pwsh -File benchmark/scripts/zork-bench/run-canonical.ps1
#
# Status file: target-copilot-bench/bench-results/zork-bench/.canonical-status.json
# Watcher log: target-copilot-bench/bench-results/zork-bench/.watcher.log

param(
    [string]$Model    = 'gemma4:e4b',
    [int]$Episodes    = 3,
    [int]$MaxTurns    = 300,
    [string[]]$Arms   = @('none', 'zorkgpt-default', 'terransoul-brain'),
    [int]$WatcherMinutes = 5,
    # Self-healing: kill container if no new turn appears within this many minutes.
    # 0 disables. Default = 4x watcher cadence so a single slow cold-load doesn't trigger.
    [int]$StallMinutes = 20,
    # Pre-flight warmup: POST a 1-token generate to Ollama before starting bench.
    # Catches model-too-big-for-GPU 500s before wasting an hour.
    [bool]$PreflightOllama = $true,
    # Cold-load timeout for the warmup generate. Large models (10GB+) on first
    # load can take several minutes; 300s was too tight for gemma4:e4b cold.
    [int]$PreflightTimeoutSec = 600,
    [string]$OllamaUrl = 'http://localhost:11434'
)

$ErrorActionPreference = 'Stop'
$repoRoot   = (Resolve-Path "$PSScriptRoot/../../..").Path
$outDir     = Join-Path $repoRoot 'target-copilot-bench\bench-results\zork-bench'
$statusFile = Join-Path $outDir '.canonical-status.json'
$watcherLog = Join-Path $outDir '.watcher.log'
$progressMd = Join-Path $repoRoot 'benchmark\progress.md'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# --- Rebuild Docker image with the correct model baked in ----------------
# ROOT CAUSE FIX: The model is baked at `docker build` time via --build-arg
# BENCH_MODEL. Without this step, stale images use whatever model was last
# built (often phi4:latest or a wrong default), causing empty/broken responses.
Write-Host "[canonical] Rebuilding zork-bench image (model=$Model)..."
docker build -t zork-bench `
    --build-arg "BENCH_MODEL=$Model" `
    -f "$repoRoot\benchmark\scripts\zork-bench\Dockerfile" `
    "$repoRoot"
if ($LASTEXITCODE -ne 0) { throw "Docker build failed for model=$Model" }

# --- Pre-flight Ollama warmup --------------------------------------------
# Self-healing layer 1: load the target model with a 1-token generate. If
# Ollama returns 500 (typically model > VRAM), abort the run NOW instead of
# letting the bench burn 30+ minutes on a guaranteed-fail loop.
#
# Self-healing patches (mirrors brain failover + stall-watchdog pattern):
#   a) `ollama ps` precheck — if the target model is already loaded, skip
#      the HTTP warmup entirely. Eliminates the most common hang source.
#   b) Wall-clock guard via Start-Job — `Invoke-RestMethod -TimeoutSec` only
#      bounds the SOCKET read; a stalled TCP connect or a wedged ollama
#      worker can still hang for >timeout. Wrap the call in a job and
#      Stop-Job after $PreflightTimeoutSec so we never block forever.
#   c) Soft-fail by default — on hang/timeout/connection error, log a WARN
#      and continue. The bench has its own watcher + stall-watchdog
#      (StallMinutes) that will kill the docker container if no turn
#      advances. Only HARD-abort on confirmed OOM/500 from ollama, where
#      proceeding is guaranteed to burn hours on failing generates.
if ($PreflightOllama) {
    Write-Host "[canonical] Pre-flight: checking $Model at $OllamaUrl ..."

    # (a) Skip if already loaded — fastest path, zero HTTP risk.
    $alreadyLoaded = $false
    try {
        $psOut = docker exec ollama ollama ps 2>&1 | Out-String
        if ($psOut -match [regex]::Escape($Model)) {
            $alreadyLoaded = $true
            Write-Host "[canonical] Pre-flight SKIP: $Model already loaded in VRAM (per 'ollama ps')."
        }
    } catch {
        Write-Host "[canonical] Pre-flight: 'ollama ps' check failed ($($_.Exception.Message)); proceeding with HTTP warmup."
    }

    if (-not $alreadyLoaded) {
        Write-Host "[canonical] Pre-flight: warming up $Model (wall-clock limit ${PreflightTimeoutSec}s) ..."
        $body = @{ model = $Model; prompt = 'hi'; stream = $false; options = @{ num_predict = 1 } } | ConvertTo-Json
        # (b) Wall-clock guard via background job — survives socket hangs.
        $warmJob = Start-Job -ScriptBlock {
            param($url, $body, $httpTimeout)
            try {
                $r = Invoke-RestMethod -Uri "$url/api/generate" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec $httpTimeout
                return @{ ok = $true; eval_count = $r.eval_count }
            } catch {
                return @{ ok = $false; error = $_.Exception.Message }
            }
        } -ArgumentList $OllamaUrl, $body, $PreflightTimeoutSec
        $completed = Wait-Job -Job $warmJob -Timeout $PreflightTimeoutSec
        if (-not $completed) {
            # (c) Hung — kill job, warn, continue. Stall-watchdog handles the bench.
            Write-Host "[canonical] Pre-flight WARN: warmup did not return within ${PreflightTimeoutSec}s. Killing warmup, continuing — bench stall-watchdog (StallMinutes=$StallMinutes) will catch any wedged container."
            Stop-Job $warmJob -ErrorAction SilentlyContinue
            Remove-Job $warmJob -Force -ErrorAction SilentlyContinue
        } else {
            $result = Receive-Job -Job $warmJob -ErrorAction SilentlyContinue
            Remove-Job $warmJob -Force -ErrorAction SilentlyContinue
            if ($result -and $result.ok) {
                Write-Host "[canonical] Pre-flight OK: model loaded, eval_count=$($result.eval_count)"
            } else {
                $msg = if ($result) { $result.error } else { '(no result)' }
                # Only HARD-abort on confirmed OOM/500 — those are non-recoverable.
                if ($msg -match '500' -or $msg -match 'out of memory' -or $msg -match 'OOM') {
                    throw "ABORTED: Ollama cannot load model=$Model (likely > GPU VRAM). Pick a smaller model or run on bigger hardware. Original error: $msg"
                }
                # Otherwise soft-fail — could be transient. Let the bench try.
                Write-Host "[canonical] Pre-flight WARN: warmup failed ($msg). Continuing — bench stall-watchdog will catch a wedged container."
            }
        }
    }
}

function Write-Status {
    param([hashtable]$Patch)
    $current = @{}
    if (Test-Path $statusFile) {
        try { $current = Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    foreach ($k in $Patch.Keys) { $current[$k] = $Patch[$k] }
    $current['updated_at'] = (Get-Date -AsUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $current | ConvertTo-Json -Depth 6 | Set-Content -Path $statusFile -Encoding UTF8
}

# --- Launch progress watcher as background job ---------------------------
# Two outputs per tick (every $WatcherMinutes min):
#   1. APPEND a one-line tick to the BENCH-ZORK-1.5 Live tail section at the
#      end of benchmark/progress.md so accumulated history is visible.
#   2. Update the BENCH_PROGRESS_START/END block near the top with the current
#      snapshot.
$watcherScript = {
    param($statusFile, $progressMd, $watcherLog, $intervalMin, $totalEpisodes, $stallMinutes, $containerName)
    # Self-healing layer 2: stall tracking. If $tn does not advance for
    # ($stallMinutes / $intervalMin) consecutive ticks, kill the named docker
    # container so the orchestrator unblocks. Persists across ticks via closure.
    $prevTn = -1
    $stallTicks = 0
    $maxStallTicks = if ($stallMinutes -gt 0 -and $intervalMin -gt 0) { [Math]::Max(1, [int][Math]::Ceiling($stallMinutes / $intervalMin)) } else { 0 }
    while ($true) {
        try {
            if (Test-Path $statusFile) {
                $st = Get-Content $statusFile -Raw | ConvertFrom-Json
                # Count completed-episode artifacts on disk (per-episode .jsonl files
                # are written when a docker episode finishes — well before the parent
                # arm's docker run exits and bumps $st.episodes_done). Filter by
                # $st.started_at so stale artifacts from earlier runs don't inflate
                # the count. Falls back to $st.episodes_done if the artifact dir or
                # started_at is unavailable.
                $artifactDir = Split-Path -Parent $statusFile
                $diskDone = $null
                if ($st.started_at -and (Test-Path $artifactDir)) {
                    try {
                        $startedAt = [datetime]::Parse($st.started_at, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                        $diskDone = (Get-ChildItem $artifactDir -Filter 'zork_bench_*_ep*.jsonl' -ErrorAction SilentlyContinue |
                            Where-Object { $_.LastWriteTimeUtc -ge $startedAt }).Count
                    } catch {}
                }
                $statusDone = if ($st.episodes_done) { [int]$st.episodes_done } else { 0 }
                $done = if ($diskDone -ne $null) { [Math]::Max([int]$diskDone, $statusDone) } else { $statusDone }
                $pct  = if ($totalEpisodes -gt 0) { [math]::Round(100.0 * $done / $totalEpisodes, 1) } else { 0 }

                # Live turn count from the most recently-touched transcript file.
                # Pattern '^--- Turn N ---' is emitted once per played turn.
                $liveTurns = '-'
                $liveScore = '-'
                $bestScore = '-'
                $maxTurnsCap = if ($st.max_turns) { [int]$st.max_turns } else { 0 }
                try {
                    $latestTr = Get-ChildItem $artifactDir -Filter 'zork_bench_*_ep*.transcript.txt' -ErrorAction SilentlyContinue |
                        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
                    if ($latestTr) {
                        $tn = (Select-String -Path $latestTr.FullName -Pattern '^--- Turn \d+ ---' -ErrorAction SilentlyContinue).Count
                        if ($maxTurnsCap -gt 0) { $liveTurns = "$tn/$maxTurnsCap" } else { $liveTurns = "$tn" }

                        # Stall watchdog: if turn count unchanged across ticks, count it.
                        if ($maxStallTicks -gt 0 -and $tn -is [int] -and $tn -gt 0) {
                            if ($tn -eq $prevTn) {
                                $stallTicks++
                                "$(Get-Date -AsUTC -Format o) stall tick $stallTicks/$maxStallTicks at turns=$tn" | Add-Content -Path $watcherLog
                                if ($stallTicks -ge $maxStallTicks) {
                                    "$(Get-Date -AsUTC -Format o) STALL DETECTED — killing container $containerName" | Add-Content -Path $watcherLog
                                    try { docker kill $containerName 2>&1 | Out-Null } catch {}
                                    $stallTicks = 0
                                }
                            } else {
                                $stallTicks = 0
                            }
                            $prevTn = $tn
                        }
                    }
                    # Score lives only in the runner.log (the harness's stdout). Parse
                    # 'Score: N, Location:' lines from the most recent runner log.
                    $latestRunner = Get-ChildItem $artifactDir -Filter 'iter-*.runner.log' -ErrorAction SilentlyContinue |
                        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
                    if ($latestRunner) {
                        $scoreMatches = Select-String -Path $latestRunner.FullName -Pattern 'Score:\s*(\d+),' -ErrorAction SilentlyContinue
                        if ($scoreMatches) {
                            $lastM = $scoreMatches | Select-Object -Last 1
                            $liveScore = $lastM.Matches[0].Groups[1].Value
                            $maxS = 0
                            foreach ($m in $scoreMatches) {
                                $v = [int]$m.Matches[0].Groups[1].Value
                                if ($v -gt $maxS) { $maxS = $v }
                            }
                            $bestScore = "$maxS"
                        }
                    }
                } catch {}

                $elapsed = if ($st.started_at) {
                    $started = if ($st.started_at -is [datetime]) { $st.started_at.ToUniversalTime() } else { [datetime]::Parse($st.started_at, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal) }
                    $delta = (Get-Date -AsUTC) - $started
                    "{0}h{1:00}m" -f [int]$delta.TotalHours, $delta.Minutes
                } else { '0h00m' }
                # Display in local time so the human reading progress.md sees
                # their wall-clock; offset suffix (e.g. +10:00) keeps the
                # timestamp unambiguous. Internal math (elapsed) still uses UTC.
                $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')

                # 1. Append a one-line tick to the end of progress.md.
                $tickLine = "$now  [$($st.phase)]  pct=$pct% ($done/$totalEpisodes eps)  turns=$liveTurns  score=$liveScore (best=$bestScore/350)  elapsed=$elapsed  last_event=$($st.last_event)"
                Add-Content -Path $progressMd -Value $tickLine -Encoding UTF8

                # 2. Refresh the BENCH_PROGRESS_START/END block.
                $md = Get-Content $progressMd -Raw
                $startTag = '<!-- BENCH_PROGRESS_START -->'
                $endTag   = '<!-- BENCH_PROGRESS_END -->'
                $startIdx = $md.LastIndexOf($startTag)
                $endIdx   = $md.LastIndexOf($endTag)
                if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
                    $armsBlock = @()
                    foreach ($a in $st.arms.PSObject.Properties) {
                        $arm = $a.Value
                        $scores = ($arm.final_scores -join ', ')
                        $turns  = ($arm.turns -join ', ')
                        $epDone = ($arm.final_scores | Where-Object { $_ -ne $null -and $_ -ne '-' }).Count
                        $armsBlock += ("arm={0,-22} final_scores: [{1}]  turns: [{2}]  wall: {3}  ({4}/{5} episodes)" -f `
                            $a.Name, $scores, $turns, ($arm.wall_clock ?? '0h00m'), $epDone, $st.episodes_per_arm)
                    }
                    $stagesBlock = @()
                    foreach ($s in $st.stages) { $stagesBlock += $s }
                    $body = @"
```
TerranSoul BENCH-ZORK-1.5 canonical run progress
chunk:         BENCH-ZORK-1.5
scope:         3 arms × $($st.episodes_per_arm) episodes × $($st.max_turns) turns
model:         $($st.model) (Ollama, ctx=4096)
game:          Zork 1 (zork1.z5)
brain:         TerranSoul MCP tray on :7423 (preserved across episodes per arm; wiped between arms)
updated_at:    $now
elapsed:       $elapsed
phase:         $($st.phase)
last_event:    $($st.last_event)
progress_pct:  $pct%   ($done / $totalEpisodes episodes complete)
update_cadence: every $intervalMin minutes (Live tail at bottom is the accumulated log)

--- stages ---
$($stagesBlock -join "`n")

--- arms ---
$($armsBlock -join "`n")
```
"@
                    $newMd = $md.Substring(0, $startIdx + $startTag.Length) + "`n`n" + $body + "`n`n" + $md.Substring($endIdx)
                    Set-Content -Path $progressMd -Value $newMd -Encoding UTF8 -NoNewline
                    "$now wrote progress.md pct=$pct phase=$($st.phase)" | Add-Content -Path $watcherLog
                }
            }
        } catch {
            "$(Get-Date -AsUTC -Format o) watcher error: $_" | Add-Content -Path $watcherLog
        }
        Start-Sleep -Seconds ($intervalMin * 60)
    }
}

Write-Host "Launching watcher background job (every $WatcherMinutes min, stall-watchdog=$StallMinutes min)..."
$totalEps = $Episodes * $Arms.Count
$containerName = 'zork-bench-active'
$watcherJob = Start-Job -ScriptBlock $watcherScript -ArgumentList $statusFile, $progressMd, $watcherLog, $WatcherMinutes, $totalEps, $StallMinutes, $containerName

# --- Initialize status ---------------------------------------------------
$initArms = @{}
foreach ($a in $Arms) {
    $initArms[$a] = @{
        final_scores = @('-','-','-')
        turns        = @('-','-','-')
        wall_clock   = '0h00m'
    }
}
Write-Status @{
    started_at      = (Get-Date -AsUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
    model           = $Model
    max_turns       = $MaxTurns
    episodes_per_arm = $Episodes
    episodes_done   = 0
    arms            = $initArms
    phase           = 'prep'
    last_event      = "watcher started, $WatcherMinutes-min cadence"
    stages          = @(
        '[x] stage 0 — model pull',
        '[x] stage 1 — docker rebuild',
        '[ ] stage 2 — arm=none',
        '[ ] stage 3 — arm=zorkgpt-default',
        '[ ] stage 4 — arm=terransoul-brain',
        '[ ] stage 5 — collect summaries + transcripts'
    )
    notes           = "  - Sequential per-arm (Ollama single-inference).`n  - Watcher cadence: $WatcherMinutes min."
}

# --- Run each arm sequentially -------------------------------------------
$episodesDone = 0
foreach ($arm in $Arms) {
    $armStart = Get-Date -AsUTC
    Write-Host "=== Starting arm=$arm ($Episodes eps × $MaxTurns turns) ==="
    Write-Status @{
        phase = "running arm=$arm"
        last_event = "started arm=$arm at $($armStart.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
    }
    $logFile = Join-Path $outDir "arm-$arm-canonical.log"
    # Remove any stale container with the same name (e.g. from a previous killed run).
    docker rm -f $containerName 2>&1 | Out-Null
    docker run --rm `
        --name $containerName `
        --add-host=host.docker.internal:host-gateway `
        -v "${repoRoot}\target-copilot-bench\bench-results\zork-bench:/out" `
        -v "${repoRoot}\mcp-data:/mcp-data:ro" `
        zork-bench `
        --arm $arm `
        --episodes $Episodes `
        --max-turns $MaxTurns `
        --mcp-host host.docker.internal `
        2>&1 | Tee-Object -FilePath $logFile

    $armEnd = Get-Date -AsUTC
    $delta = $armEnd - $armStart
    $wall = "{0}h{1:00}m" -f [int]$delta.TotalHours, $delta.Minutes

    # Parse the latest summary JSON for this arm.
    $summary = Get-ChildItem $outDir -Filter "zork_bench_${arm}_summary_*.json" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $scores = @('-','-','-')
    $turns  = @('-','-','-')
    if ($summary) {
        try {
            $s = Get-Content $summary.FullName -Raw | ConvertFrom-Json
            # summary aggregates all eps; per-episode jsonl files have per-ep score.
            $jsonlFiles = Get-ChildItem $outDir -Filter "zork_bench_${arm}_ep*_$($s.episode_id -replace '.*-(\d{8}T\d{6}).*','$1')*.jsonl" -ErrorAction SilentlyContinue
            # Fall back to grep summary fields if individual per-ep tracking absent.
            $scores[0] = "$($s.final_score)"
            $turns[0]  = "$($s.turns)"
        } catch {}
    }

    $episodesDone += $Episodes
    $statusArms = (Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable).arms
    $statusArms[$arm] = @{ final_scores = $scores; turns = $turns; wall_clock = $wall }
    Write-Status @{
        episodes_done = $episodesDone
        arms          = $statusArms
        last_event    = "finished arm=$arm  wall=$wall"
    }
}

Write-Status @{
    phase      = 'done'
    last_event = 'all arms finished; collect summaries + transcripts next'
}

Write-Host "All arms finished. Stopping watcher..."
Stop-Job $watcherJob -ErrorAction SilentlyContinue
Remove-Job $watcherJob -ErrorAction SilentlyContinue
Write-Host "Done. See $outDir for artifacts."
