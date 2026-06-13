# benchmark/scripts/zork-bench/reset-bench-brain.ps1
#
# Reset the ISOLATED bench MCP brain instance to a fresh, task-naive state.
# Used between cross-game/cross-arm runs so no game's memories leak into the
# next run (rules/bench-agi-purity.md), without ever touching the developer
# brain in <repo>/mcp-data.
#
# What it does:
#   1. stop any process serving the bench port
#   2. delete the bench data dir entirely
#   3. start a fresh instance (seeds from mcp-data/shared/memory-seed.sql)
#   4. AGI-purity pass: remove the zorkgpt.com ep120 audit row (score
#      milestones + a room name) the seed still carries, then restart so the
#      in-memory indexes match the store
#
# Usage: pwsh -File benchmark/scripts/zork-bench/reset-bench-brain.ps1 [-Port 7424]

param(
    [int]$Port = 7424,
    [string]$DataDirName = 'mcp-data-bench',
    # Cold-loading the brain LLM (e.g. gemma4:12b ~7 GB) can take minutes;
    # /health blocks on the live provider probe until the model is up.
    [int]$HealthTimeoutSec = 360
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/../../..").Path
$dataDir  = Join-Path $repoRoot $DataDirName
$binary   = Join-Path $repoRoot 'target-mcp\release\terransoul.exe'

function Stop-BenchInstance {
    param([int]$Port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "[reset-bench-brain] stopping pid $($c.OwningProcess) on :$Port"
        try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop } catch {}
    }
    # Wait until the port is actually FREE — the binary falls back to the
    # next port if the requested one is still held during bind (observed:
    # a kill->bind race left the fresh instance on :7426 instead of :7425).
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    Write-Host "[reset-bench-brain] WARN: :$Port still held after 20s"
}

function Start-BenchInstance {
    $env:TERRANSOUL_MCP_DATA_DIR = $dataDir
    $env:TERRANSOUL_MCP_PORT = "$Port"
    # Idle timeout is in SECONDS (binary logs "idle timeout (480s)").
    # 480 made bench instances self-terminate after 8 idle minutes —
    # observed as "hung" health checks + locked data dirs mid-shutdown.
    $env:TERRANSOUL_MCP_IDLE_TIMEOUT = '28800'
    # Capture the binary's stdio — without it a hung startup is a black box.
    $logDir = Join-Path $dataDir 'logs'
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $p = Start-Process $binary -ArgumentList '--mcp-tray' -WorkingDirectory $repoRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'instance.out.log') `
        -RedirectStandardError (Join-Path $logDir 'instance.err.log')
    Write-Host "[reset-bench-brain] started bench MCP pid $($p.Id) on :$Port (data=$dataDir)"
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
            if ($h.status -eq 'ok') { return $h }
        } catch {}
        Start-Sleep -Seconds 3
    }
    throw "bench MCP on :$Port did not become healthy within ${HealthTimeoutSec}s"
}

Stop-BenchInstance -Port $Port
# A hung instance can stop serving its port yet stay alive holding the data
# dir (observed: /health wedged, listener gone, obs.sqlite locked). Kill any
# terransoul.exe that is NOT one of the legitimate dev/release/tray servers
# (the owners of 7421/7422/7423).
$keep = @()
foreach ($lp in 7421, 7422, 7423) {
    $c = Get-NetTCPConnection -LocalPort $lp -State Listen -ErrorAction SilentlyContinue
    if ($c) { $keep += $c.OwningProcess }
}
foreach ($proc in (Get-Process terransoul -ErrorAction SilentlyContinue)) {
    if ($proc.Id -notin $keep) {
        Write-Host "[reset-bench-brain] killing stray terransoul pid $($proc.Id)"
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
    }
}
Start-Sleep -Seconds 3
if (Test-Path $dataDir) {
    Write-Host "[reset-bench-brain] deleting $dataDir"
    # File handles of a just-killed process can take seconds to release;
    # retry the delete with backoff instead of failing on the first lock.
    $attempts = 0
    while ($true) {
        try {
            Remove-Item -Recurse -Force $dataDir -ErrorAction Stop
            break
        } catch {
            $attempts++
            if ($attempts -ge 10) {
                # Something (AV scanner, lingering handle) still holds the
                # dir. The goal is a FRESH brain, not this exact path — fall
                # back to a timestamped sibling dir and report it loudly.
                $stamp = Get-Date -Format 'HHmmss'
                $dataDir = "$dataDir-$stamp"
                Write-Host "[reset-bench-brain] delete kept failing — using fresh dir $dataDir"
                break
            }
            Write-Host "[reset-bench-brain] delete locked (attempt $attempts), retrying in 3s"
            Start-Sleep -Seconds 3
        }
    }
}
New-Item -ItemType Directory -Force $dataDir | Out-Null

$h = Start-BenchInstance
Write-Host "[reset-bench-brain] fresh instance: $($h.memory_total) seeded memories"

# AGI-purity pass: drop the ep120 audit row by content match (id-independent),
# then restart so HNSW/FTS indexes are rebuilt from the store.
Stop-BenchInstance -Port $Port
$py = @"
import sqlite3
c = sqlite3.connect(r'$dataDir\memory.db')
n = c.execute("DELETE FROM memories WHERE content LIKE 'ZORKGPT.COM ep120 AUDIT%'").rowcount
c.commit()
print(f'purity rows removed: {n}; remaining:', c.execute('SELECT COUNT(*) FROM memories').fetchone()[0])
"@
python -c $py

$h = Start-BenchInstance
Write-Host "[reset-bench-brain] ready: $($h.memory_total) memories, status=$($h.status)"
