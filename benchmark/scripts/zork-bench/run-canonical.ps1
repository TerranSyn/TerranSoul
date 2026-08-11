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
# Status file: benchmark/results/zork-bench/.canonical-status.json
# Watcher log: benchmark/results/zork-bench/.watcher.log

param(
    [string]$Model    = 'gemma4:e4b',
    [int]$Episodes    = 3,
    [int]$MaxTurns    = 300,
    [string[]]$Arms   = @('none', 'zorkgpt-default', 'terransoul-brain'),
    [int]$WatcherMinutes = 5,
    # Terminal discipline: the background progress watcher is a persistent
    # Start-Job (an extra powershell.exe worker that also ORPHANS if the run is
    # killed midway). It only updates progress.md + does a stall docker-kill —
    # neither is needed for the result. OFF by default so a bench spawns the
    # minimum processes (orchestrator + container + brain). Pass -Watcher to
    # re-enable live progress.md + the stall-watchdog.
    [switch]$Watcher,
    # Self-healing: kill container if no new turn appears within this many minutes.
    # 0 disables. Default = 4x watcher cadence so a single slow cold-load doesn't trigger.
    [int]$StallMinutes = 20,
    # Pre-flight warmup: POST a 1-token generate to Ollama before starting bench.
    # Catches model-too-big-for-GPU 500s before wasting an hour.
    [bool]$PreflightOllama = $true,
    # Cold-load timeout for the warmup generate. Large models (10GB+) on first
    # load can take several minutes; 300s was too tight for gemma4:e4b cold.
    [int]$PreflightTimeoutSec = 600,
    [string]$OllamaUrl = 'http://localhost:11434',
    # MCP endpoint + data dir. Defaults preserve the historical behaviour
    # (dev tray on 7423 reading <repo>/mcp-data). For an AGI-pure isolated
    # brain, start a second MCP instance (TERRANSOUL_MCP_DATA_DIR=
    # <repo>/mcp-data-bench, TERRANSOUL_MCP_PORT=7424) and pass
    # -McpPort 7424 -McpDataDir mcp-data-bench so bench traffic never
    # touches the developer brain.
    [int]$McpPort = 7423,
    [string]$McpDataDir = 'mcp-data',
    # Optional ROM override for cross-game runs. The Jericho suite is baked into
    # the image at /bench/jericho-game-suite/, so e.g.
    # -Rom /bench/jericho-game-suite/905.z5 runs the unchanged bridge on a
    # different game. Empty = the image default (zork1.z5).
    [string]$Rom = '',
    # Output subdir under benchmark/results/. Override to an
    # empty/fresh dir so `run_bench.py --resume` cannot count a PRIOR run's
    # completed episodes (it globs zork_bench_<arm>_ep*.jsonl in the whole
    # out-dir, regardless of run timestamp) and skip ep1 of a fresh run.
    [string]$OutSubdir = 'zork-bench'
)

$ErrorActionPreference = 'Stop'
$repoRoot   = (Resolve-Path "$PSScriptRoot/../../..").Path
$outDir     = Join-Path $repoRoot "target-copilot-bench\bench-results\$OutSubdir"
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

    # --- VRAM preflight via the ollama HTTP API (NO console spawns) -------------
    # "TOO MANY TERMINALS" ROOT CAUSE: the old preflight ran ~15 `docker exec
    # ollama ollama ps/stop` calls per run (eviction loop + wait poll x8 + gate +
    # self-heal). On Windows EACH docker-exec pops a conhost console window — a
    # burst of terminals every launch. Fix: do ALL checks over ollama's HTTP API
    # (/api/ps) in-process via Invoke-RestMethod (zero consoles), and collapse the
    # only CLI step (model UNLOAD has no HTTP equivalent) into ONE docker exec.
    #
    # WHY evict at all: on a 12GB GPU the ~8.5GB actor + the dev-tray's ~6.3GB
    # gemma4:e4b cannot co-reside; the actor spills to CPU -> 120s timeouts ->
    # contaminated scores. Evicting frees VRAM; the :7423 dev listener is untouched
    # and its model reloads lazily after the bench. Generic infra hygiene, no game
    # content. (`size_vram == size` => fully on GPU; `< size` => spilled to CPU.)
    function Get-OllamaLoaded {
        try { return @((Invoke-RestMethod -Uri "$OllamaUrl/api/ps" -Method GET -TimeoutSec 8).models) }
        catch { return @() }
    }
    function Test-FullGpu($m) {
        if (-not $m) { return $false }
        return ([double]$m.size_vram -ge [double]$m.size * 0.98)
    }

    try {
        $loaded = Get-OllamaLoaded
        $toEvict = @()
        foreach ($m in $loaded) {
            $nm = "$($m.name)"
            if ($nm -match 'embed') { continue }            # CPU-only embedder, leave it
            if ($nm -ne $Model) { $toEvict += $nm }          # another model (e.g. dev e4b)
            elseif (-not (Test-FullGpu $m)) { $toEvict += $nm }  # actor spilled to CPU -> reload
        }
        $toEvict = @($toEvict | Select-Object -Unique)
        if ($toEvict.Count -gt 0) {
            Write-Host "[canonical] VRAM: evicting $($toEvict -join ', ') to free GPU for $Model"
            $stops = ($toEvict | ForEach-Object { "ollama stop '$_'" }) -join '; '
            docker exec ollama sh -c $stops 2>&1 | Out-Null   # the ONE CLI call
            for ($w = 0; $w -lt 8; $w++) {                    # wait via HTTP (no console)
                $cur = Get-OllamaLoaded
                $bad = $cur | Where-Object { ($_.name -notmatch 'embed' -and $_.name -ne $Model) -or ($_.name -eq $Model -and -not (Test-FullGpu $_)) }
                if (-not $bad) { break }
                Start-Sleep -Seconds 2
            }
        }
    } catch {
        Write-Host "[canonical] VRAM: eviction skipped ($($_.Exception.Message)). If your ollama container is not named 'ollama', free VRAM manually."
    }

    # Warm up the actor unless it is already loaded AND fully on GPU (HTTP only).
    $cur = Get-OllamaLoaded | Where-Object { $_.name -eq $Model } | Select-Object -First 1
    if ($cur -and (Test-FullGpu $cur)) {
        Write-Host "[canonical] Pre-flight SKIP: $Model already 100% GPU."
    } else {
        Write-Host "[canonical] Pre-flight: warming up $Model (timeout ${PreflightTimeoutSec}s) ..."
        $body = @{ model = $Model; prompt = 'hi'; stream = $false; options = @{ num_predict = 1 } } | ConvertTo-Json
        try {
            $r = Invoke-RestMethod -Uri "$OllamaUrl/api/generate" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec $PreflightTimeoutSec
            Write-Host "[canonical] Pre-flight OK: model loaded, eval_count=$($r.eval_count)"
        } catch {
            $msg = $_.Exception.Message
            if ($msg -match '500' -or $msg -match 'out of memory' -or $msg -match 'OOM') {
                throw "ABORTED: Ollama cannot load model=$Model (likely > GPU VRAM). Pick a smaller model or run on bigger hardware. Original error: $msg"
            }
            Write-Host "[canonical] Pre-flight WARN: warmup failed ($msg). Continuing."
        }
    }

    # GPU-placement gate (HTTP): refuse to bench a CPU-spilled actor.
    $final = Get-OllamaLoaded | Where-Object { $_.name -eq $Model } | Select-Object -First 1
    if ($final) {
        $vramPct = if ([double]$final.size -gt 0) { [int](100.0 * [double]$final.size_vram / [double]$final.size) } else { 0 }
        Write-Host "[canonical] GPU-placement: $Model is ${vramPct}% in VRAM"
        # Tiered: only a SEVERE spill (the 64%-CPU catastrophe class that caused
        # 8h episodes + timeouts) is worth aborting. A MILD spill (e.g. 83% GPU
        # under transient VRAM pressure) just runs a bit slower — warn, proceed.
        if ($vramPct -lt 70) {
            throw "ABORTED: $Model is only ${vramPct}% on GPU (severe CPU spill). Free ~2GB of GPU VRAM (close GPU apps) or use bigger hardware before benching."
        } elseif ($vramPct -lt 98) {
            Write-Host "[canonical] GPU-placement WARN: ${vramPct}% on GPU (mild CPU spill) — run will be a bit slower but proceeds."
        }
    } else {
        Write-Host "[canonical] GPU-placement WARN: '$Model' not loaded after warmup; proceeding."
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

$totalEps = $Episodes * $Arms.Count
$containerName = 'zork-bench-active'
$watcherJob = $null
if ($Watcher) {
    Write-Host "Launching watcher background job (every $WatcherMinutes min, stall-watchdog=$StallMinutes min)..."
    $watcherJob = Start-Job -ScriptBlock $watcherScript -ArgumentList $statusFile, $progressMd, $watcherLog, $WatcherMinutes, $totalEps, $StallMinutes, $containerName
} else {
    Write-Host "[canonical] Watcher DISABLED (no -Watcher) — no background Start-Job spawned; progress.md + stall-watchdog off to keep process count minimal."
}

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
    $romArgs = if ($Rom) { @('--rom', $Rom) } else { @() }
    # Upstream ZorkGPT selects the game via pyproject.toml `game_file_path`
    # (TOML, not env/CLI — the --rom flag reaches run_bench.py but upstream
    # never reads it; observed 2026-06-12: a -Rom 905.z5 run silently played
    # zork1.z5). Override by extracting the image's pyproject, rewriting the
    # one path, and bind-mounting it read-only over /bench/pyproject.toml —
    # zero bench/upstream code changes, game selection only.
    $romMount = @()
    if ($Rom) {
        $tomlPath = Join-Path $outDir 'pyproject.rom-override.toml'
        $toml = docker run --rm --entrypoint cat zork-bench /bench/pyproject.toml
        if ($LASTEXITCODE -ne 0 -or -not $toml) { throw "could not extract pyproject.toml from image for ROM override" }
        $patched = $toml -replace 'game_file_path\s*=\s*"[^"]*"', "game_file_path = `"$Rom`""
        if (-not (($patched | Out-String) -match [regex]::Escape($Rom))) { throw "ROM override rewrite failed for $Rom" }
        Set-Content -Path $tomlPath -Value $patched -Encoding UTF8
        $romMount = @('-v', "${tomlPath}:/bench/pyproject.toml:ro")
        Write-Host "[canonical] ROM override active: game_file_path=$Rom (bind-mounted pyproject)"
    }
    docker run --rm `
        --name $containerName `
        --add-host=host.docker.internal:host-gateway `
        -v "${outDir}:/out" `
        -v "${repoRoot}\${McpDataDir}:/mcp-data:ro" `
        @romMount `
        zork-bench `
        --arm $arm `
        --episodes $Episodes `
        --max-turns $MaxTurns `
        --mcp-host host.docker.internal `
        --mcp-port $McpPort `
        @romArgs `
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

if ($watcherJob) {
    Write-Host "All arms finished. Stopping watcher..."
    Stop-Job $watcherJob -ErrorAction SilentlyContinue
    Remove-Job $watcherJob -ErrorAction SilentlyContinue
} else {
    Write-Host "All arms finished. (No watcher job to stop.)"
}
Write-Host "Done. See $outDir for artifacts."
