# Spec 012 model bake-off queue runner (post-audit, harness-fixed).
# After iter-F (qwen3.5:9b) the harness was audited and a bug found:
# the spec-010 examine-noun debounce reset whenever the LLM's *original*
# first token wasn't "examine" — verbose models emit paragraphs first
# token "i"/"the"/etc. so the room-aware fallback could inject
# `examine door` 9× in a row (iter-F ep1 confirmed). A Layer-5 cap was
# added that tracks the FINAL substituted action regardless of layer.
#
# This queue re-runs every model affected by the bug (B2, E, F, G) plus
# adds H (qwen3.5:4b) under the fixed harness. Iter-A (qwen2.5:7b) is
# kept as the surviving spec-011 baseline because its outputs were
# extraction-friendly and never triggered the buggy path.
#
# Waits for any active zork-bench-active container to finish, then runs
# each (model, archive-tag) pair sequentially. Records per-iter logs and
# archives results into benchmark/results/<tag>/.
#
# Usage:
#   pwsh -NoProfile -File benchmark/scripts/zork-bench/queue-bakeoff.ps1
#
# To resume after machine restart or kill: this script is idempotent —
# it skips iters whose archive dir already exists.

param(
    [int]$Episodes = 2,
    [int]$MaxTurns = 10,
    [int]$WatcherMinutes = 3,
    [int]$StallMinutes = 20
)

$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $repo

$resultsBase = Join-Path $repo 'target-copilot-bench\bench-results'
$active      = Join-Path $resultsBase 'zork-bench'
$runner      = Join-Path $PSScriptRoot 'run-canonical.ps1'

# Queue: ordered list of (Ollama tag, archive folder suffix). All runs use
# the spec-012 harness fix. Iter-I is the incumbent recommended Local LLM
# (gemma4:e4b) re-baselined so the winner comparison includes a clean
# side-by-side under fair conditions.
$queue = @(
    @{ Model = 'gemma4:e4b';  Tag = 'spec012-I-gemma4-e4b-rebaseline-10t' },
    @{ Model = 'qwen3.5:9b';  Tag = 'spec012-F-qwen3.5-9b-10t' },
    @{ Model = 'qwen3.5:4b';  Tag = 'spec012-H-qwen3.5-4b-10t' },
    @{ Model = 'gpt-oss:20b'; Tag = 'spec012-G-gpt-oss-20b-10t' },
    @{ Model = 'gemma3:4b';   Tag = 'spec012-E-gemma3-4b-10t' }
)

function Wait-NoActiveContainer {
    while ($true) {
        $running = (docker ps --filter 'name=zork-bench-active' --format '{{.Names}}' 2>$null) -join ''
        if ([string]::IsNullOrWhiteSpace($running)) { return }
        Write-Host "[queue] zork-bench-active still running, waiting 60s..."
        Start-Sleep -Seconds 60
    }
}

function Wait-NoActiveDir {
    while ($true) {
        if (-not (Test-Path $active)) { return }
        $items = Get-ChildItem $active -ErrorAction SilentlyContinue
        if (-not $items -or $items.Count -eq 0) { return }
        # Active iter still writing; check container too.
        $running = (docker ps --filter 'name=zork-bench-active' --format '{{.Names}}' 2>$null) -join ''
        if ([string]::IsNullOrWhiteSpace($running)) {
            # No container running but dir has files: it's a finished but un-archived run.
            Write-Host "[queue] active dir has leftover files but no container; treating as finished."
            return
        }
        Start-Sleep -Seconds 60
    }
}

function Get-OllamaContainerId {
    $id = (docker ps --filter 'ancestor=ollama/ollama' --format '{{.ID}}' 2>$null) -join ''
    if ([string]::IsNullOrWhiteSpace($id)) {
        $id = (docker ps --filter 'name=ollama' --format '{{.ID}}' 2>$null) -join ''
    }
    return $id.Trim()
}

function Ensure-Model {
    param([string]$Model)
    $cid = Get-OllamaContainerId
    if (-not $cid) {
        throw "[queue] no running ollama container found; start it first."
    }
    $list = docker exec $cid ollama list 2>&1
    if ($list -match [regex]::Escape($Model)) {
        Write-Host "[queue] model $Model already pulled."
        return
    }
    Write-Host "[queue] pulling $Model (this may take several minutes)..."
    docker exec $cid ollama pull $Model
    if ($LASTEXITCODE -ne 0) {
        throw "[queue] failed to pull $Model (exit $LASTEXITCODE). Tag may not exist on Ollama registry."
    }
}

foreach ($job in $queue) {
    $model    = $job.Model
    $tag      = $job.Tag
    $archive  = Join-Path $resultsBase "zork-bench-canonical-$tag"

    if (Test-Path $archive) {
        Write-Host "[queue] SKIP $tag — archive already exists at $archive"
        continue
    }

    Write-Host ""
    Write-Host "================================================================="
    Write-Host "[queue] Starting iter: model=$model tag=$tag"
    Write-Host "================================================================="

    Wait-NoActiveContainer
    Wait-NoActiveDir

    try {
        Ensure-Model -Model $model
    } catch {
        Write-Host "[queue] ABORT iter ${tag}: $_"
        $abortDir = "$archive-aborted"
        New-Item -ItemType Directory -Force -Path $abortDir | Out-Null
        "ABORTED: $_" | Out-File (Join-Path $abortDir 'HANG-NOTES.md') -Encoding utf8
        continue
    }

    # Clear/create active dir.
    if (Test-Path $active) {
        Remove-Item $active -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $active | Out-Null

    $ts  = Get-Date -Format 'yyyyMMddHHmmss'
    $log = Join-Path $active "iter-$tag-$ts.runner.log"

    & pwsh -NoProfile -File $runner `
        -Model $model `
        -Episodes $Episodes `
        -MaxTurns $MaxTurns `
        -Arms terransoul-brain `
        -WatcherMinutes $WatcherMinutes `
        -StallMinutes $StallMinutes *>&1 | Tee-Object -FilePath $log

    $exit = $LASTEXITCODE
    Write-Host "[queue] iter $tag finished with exit=$exit, archiving to $archive"

    Move-Item $active $archive -Force
    "Auto-archived by queue-bakeoff.ps1. exit=$exit, ts=$ts" |
        Out-File (Join-Path $archive 'QUEUE-NOTES.md') -Encoding utf8

    docker rm -f zork-bench-active 2>$null | Out-Null
    New-Item -ItemType Directory -Force -Path $active | Out-Null
}

Write-Host ""
Write-Host "[queue] All bake-off iters processed. Review archives under $resultsBase."
