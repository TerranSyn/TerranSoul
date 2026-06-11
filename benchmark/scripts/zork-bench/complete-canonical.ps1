# benchmark/scripts/zork-bench/complete-canonical.ps1
#
# Waits for the currently running terransoul-brain container to finish,
# then sequentially runs the remaining arms (none, zorkgpt-default)
# to complete the BENCH-ZORK-1.5 canonical 3×3×300 dataset.
#
# Usage (from repo root):
#   pwsh -File benchmark/scripts/zork-bench/complete-canonical.ps1
#
# Prerequisites:
#   - Docker running
#   - Ollama serving gemma4:e4b on localhost:11434
#   - MCP tray on :7423 (for terransoul-brain arm)
#   - Container 8b2710c75783 (brain arm) still running

param(
    [string]$Model = 'gemma4:e4b',
    [int]$Episodes = 3,
    [int]$MaxTurns = 300
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$outDir = "$repoRoot\target-copilot-bench\bench-results\zork-bench"
$statusFile = "$outDir\.canonical-status.json"

function Write-Log { param([string]$msg) Write-Host "[complete-canonical $(Get-Date -Format 'HH:mm:ss')] $msg" }

# --- Step 1: Wait for the running brain container to finish ----------------
$brainContainer = docker ps --filter "ancestor=zork-bench" --format "{{.ID}}" 2>$null | Select-Object -First 1
if ($brainContainer) {
    Write-Log "Waiting for brain container $brainContainer to finish..."
    Write-Log "(This may take several hours — ep2+ep3 at 300 turns each)"
    docker wait $brainContainer 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    Write-Log "Brain container finished (exit=$exitCode)"
    # Grab final logs
    docker logs $brainContainer --tail 20 2>&1 | Tee-Object "$outDir\brain-container-final.log"
    docker rm $brainContainer 2>$null | Out-Null
} else {
    Write-Log "No running brain container found — assuming brain arm already complete"
}

# --- Step 2: Verify brain artifacts exist ----------------------------------
$brainEp3 = Get-ChildItem $outDir -Filter "zork_bench_terransoul-brain_ep3_*.jsonl" -ErrorAction SilentlyContinue
if (-not $brainEp3 -or $brainEp3.Length -lt 1000) {
    Write-Log "WARNING: Brain ep3 JSONL missing or too small. The brain arm may not have completed properly."
    Write-Log "Consider re-running: .\benchmark\scripts\zork-bench\resume-bench.ps1 -Arms 'terransoul-brain'"
}

# --- Step 3: Run 'none' arm (3 eps × 300 turns) ---------------------------
Write-Log "=== Starting arm=none (3 eps × $MaxTurns turns) ==="
# Clean stale tiny none files from prior broken run
Get-ChildItem $outDir -Filter "zork_bench_none_*.jsonl" | Where-Object { $_.Length -lt 1000 } | Remove-Item -Force

docker run --rm `
    --name "zork-bench-none" `
    --add-host host.docker.internal:host-gateway `
    -v "${outDir}:/out" `
    -v "${repoRoot}\mcp-data:/mcp-data:ro" `
    zork-bench `
    --arm none `
    --episodes $Episodes `
    --max-turns $MaxTurns `
    --mcp-host host.docker.internal

$noneExit = $LASTEXITCODE
Write-Log "Arm=none finished (exit=$noneExit)"

# --- Step 4: Run 'zorkgpt-default' arm (3 eps × 300 turns) ----------------
Write-Log "=== Starting arm=zorkgpt-default (3 eps × $MaxTurns turns) ==="
docker run --rm `
    --name "zork-bench-default" `
    --add-host host.docker.internal:host-gateway `
    -v "${outDir}:/out" `
    -v "${repoRoot}\mcp-data:/mcp-data:ro" `
    zork-bench `
    --arm zorkgpt-default `
    --episodes $Episodes `
    --max-turns $MaxTurns `
    --mcp-host host.docker.internal

$defaultExit = $LASTEXITCODE
Write-Log "Arm=zorkgpt-default finished (exit=$defaultExit)"

# --- Step 5: Update status file -------------------------------------------
$status = @{
    phase = 'done'
    last_event = "all arms completed (brain=running-prior, none=$noneExit, default=$defaultExit)"
    updated_at = (Get-Date -AsUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
    completed_at = (Get-Date -AsUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
}
if (Test-Path $statusFile) {
    try {
        $existing = Get-Content $statusFile -Raw | ConvertFrom-Json -AsHashtable
        foreach ($k in $status.Keys) { $existing[$k] = $status[$k] }
        $existing | ConvertTo-Json -Depth 6 | Set-Content $statusFile -Encoding UTF8
    } catch {
        $status | ConvertTo-Json -Depth 6 | Set-Content $statusFile -Encoding UTF8
    }
} else {
    $status | ConvertTo-Json -Depth 6 | Set-Content $statusFile -Encoding UTF8
}

# --- Step 6: List all artifacts --------------------------------------------
Write-Log "=== Canonical run artifacts ==="
Get-ChildItem $outDir -Filter "zork_bench_*.jsonl" | Sort-Object Name | ForEach-Object {
    Write-Log "  $($_.Name)  $([math]::Round($_.Length/1KB))KB"
}
Write-Log "Done. Run the aggregation script next: node benchmark/scripts/zork-bench/run.mjs --aggregate"
