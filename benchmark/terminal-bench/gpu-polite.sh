#!/usr/bin/env bash
# Release the brain model from VRAM whenever the GPU is idle, so a long bench
# does not squat on the card the owner is also using.
#
# WHY THIS IS SAFE AND CHEAP HERE. A Terminal-Bench task spends most of its
# wall-clock running commands inside a container; brain_search calls are brief
# and occasional. Measured 2026-08-07: gemma4:12b-it-qat held 11,147 MiB of
# 12,288 MiB at 1 % GPU utilisation — the model was resident and idle almost
# all of the time, and the owner could not start Microsoft Teams because only
# 940 MiB remained.
#
# So the model is unloaded whenever the GPU has been idle for two consecutive
# checks. The next brain call reloads it. That reload comes from the OS PAGE
# CACHE, not from disk, because the GGUF stays cached after an unload — the
# same property that makes the VRAM-0 design in rules/milestones.md work.
#
# WHAT THIS DOES NOT DO. It never touches the bench's own scoring path: the
# agent under test is Claude Code against the cloud API, not the local model.
# The only cost is retrieval latency on the first brain call after an idle
# stretch, which does not change task outcomes.
#
# Stop it with TaskStop, or by killing the pid it prints.
set -uo pipefail

MODEL="${TB_GPU_POLITE_MODEL:-gemma4:12b-it-qat}"
IDLE_PCT="${TB_GPU_IDLE_PCT:-8}"        # below this counts as idle
INTERVAL="${TB_GPU_POLITE_INTERVAL_S:-30}"
STRIKES="${TB_GPU_POLITE_STRIKES:-2}"   # consecutive idle checks before unload

echo "[gpu-polite] watching; unload '$MODEL' after ${STRIKES}x${INTERVAL}s below ${IDLE_PCT}% GPU"

idle=0
released=0
while true; do
  util="$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc '0-9')"
  [ -z "$util" ] && { sleep "$INTERVAL"; continue; }

  loaded="$(docker exec ollama ollama ps 2>/dev/null | grep -c "$MODEL" || true)"

  if [ "${loaded:-0}" -eq 0 ]; then
    # Nothing resident — nothing to do, and reset so a fresh load gets its
    # full grace period rather than being unloaded immediately.
    idle=0
    sleep "$INTERVAL"
    continue
  fi

  if [ "$util" -lt "$IDLE_PCT" ]; then
    idle=$((idle + 1))
  else
    idle=0
  fi

  if [ "$idle" -ge "$STRIKES" ]; then
    before="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc '0-9')"
    docker exec ollama ollama stop "$MODEL" >/dev/null 2>&1 || true
    sleep 3
    after="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc '0-9')"
    released=$((released + 1))
    echo "[gpu-polite] idle at ${util}% — released VRAM: ${before} -> ${after} MiB free (release #${released})"
    idle=0
  fi

  sleep "$INTERVAL"
done
