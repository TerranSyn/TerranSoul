# benchmark/scripts/zork-bench/resume-bench.ps1
#
# Resilient Zork bench runner — runs arms sequentially with --resume.
# Safe to re-run anytime; skips already-completed episodes.
#
# Usage:
#   .\benchmark\scripts\zork-bench\resume-bench.ps1
#   .\benchmark\scripts\zork-bench\resume-bench.ps1 -Arms "none"
#   .\benchmark\scripts\zork-bench\resume-bench.ps1 -Arms "none","terransoul-brain"
#   .\benchmark\scripts\zork-bench\resume-bench.ps1 -Rebuild

param(
    [string[]]$Arms = @("none", "zorkgpt-default", "terransoul-brain"),
    [int]$Episodes = 3,
    [int]$MaxTurns = 300,
    [string]$Model = "gemma4:e4b",
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$outDir = "$repoRoot\target-copilot-bench\bench-results\zork-bench"
$mcpData = "$repoRoot\mcp-data"

# Rebuild image if requested or if it doesn't exist
$imageExists = docker images -q zork-bench 2>$null
if ($Rebuild -or -not $imageExists) {
    Write-Host "[bench] Building zork-bench image (model=$Model)..."
    docker build -t zork-bench `
        --build-arg "BENCH_MODEL=$Model" `
        -f "$repoRoot\benchmark\scripts\zork-bench\Dockerfile" `
        "$repoRoot"
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
}

# Run each arm sequentially — one container at a time for full GPU access
foreach ($arm in $Arms) {
    Write-Host "`n[bench] === Arm: $arm ($Episodes episodes, max $MaxTurns turns) ==="
    Write-Host "[bench] --resume enabled: completed episodes will be skipped"

    docker run `
        --restart on-failure:3 `
        --name "zork-bench-$arm" `
        -v "${outDir}:/out" `
        -v "${mcpData}:/mcp-data" `
        --add-host host.docker.internal:host-gateway `
        zork-bench `
        --arm $arm `
        --episodes $Episodes `
        --max-turns $MaxTurns `
        --mcp-host host.docker.internal `
        --resume

    $exitCode = $LASTEXITCODE
    # Remove the container after success (keep on failure for debugging)
    if ($exitCode -eq 0) {
        docker rm "zork-bench-$arm" 2>$null | Out-Null
        Write-Host "[bench] Arm $arm complete"
    } else {
        Write-Host "[bench] WARNING: Arm $arm exited with code $exitCode"
        Write-Host "[bench] Container 'zork-bench-$arm' kept for debugging"
        Write-Host "[bench] To resume: docker start -a zork-bench-$arm"
    }
}

Write-Host "`n[bench] === All arms complete ==="
Write-Host "[bench] Results in: $outDir"
