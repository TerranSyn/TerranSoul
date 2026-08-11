#!/usr/bin/env bash
# Upload the whole submission cohort to the Harbor hub, PUBLIC.
#
#   usage: upload-cohort.sh [jobs-dir]
#
# ⚠️ --public IS EXPLICIT AND MUST STAY THAT WAY. harbor defaults a NEW upload to
# PRIVATE, and on a RE-upload an omitted flag leaves server-side visibility
# UNCHANGED. A silent private upload succeeds locally and then fails CI, which
# requires trials to be publicly readable.
#
# ⚠️ ONLY REGISTERED CAMPAIGN PREFIXES. jobs-sonnet5-attempt6/ is the excluded
# attempt-6 experiment (RESUME.md 9a) and must never reach the hub, where it
# could be swept into a submission it was deliberately kept out of.
#
# QUARANTINED TRIALS ARE UPLOADED ON PURPOSE. They have to be on the hub for the
# >=5-trials-per-task count to hold; they are zeroed at submission time via the
# submission JSON's `disqualified_trials`, which CI joins in as reward 0
# (leaderboard/src/leaderboard/core/metrics.py). Withholding them would instead
# make the task look under-covered and fail static analysis.
set -uo pipefail
# ⛔ WINDOWS CONSOLE ENCODING KILLS UPLOADS AT RANDOM. harbor renders a Braille
# spinner (U+2800 block) while uploading, and Python defaults stdout to cp1252
# here, so a frame like U+280B raises
#   UnicodeEncodeError: 'charmap' codec can't encode character '⠋'
# and the upload dies AFTER the trial has been sent but BEFORE it is confirmed.
# It is intermittent because it depends which spinner frame is being drawn when
# the encode happens: measured 2026-08-09, 5 of 458 uploads failed this way and
# 453 succeeded. merge-sweep.sh carries the same guard for the same reason.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
JOBS="${1:-jobs-sonnet5}"
PREFIX_FILE="$REPO/mcp-data/.tb-sweep-prefixes.txt"
cd "$HERE" || exit 2

[ -f "$PREFIX_FILE" ] || { echo "no prefix file at $PREFIX_FILE — refusing" >&2; exit 2; }

ok=0; fail=0; skip=0
failed_list=""
while read -r p; do
  [ -n "$p" ] || continue
  for d in "$JOBS/$p"*/; do
    [ -d "$d" ] || continue
    if [ ! -f "$d/result.json" ]; then skip=$((skip+1)); continue; fi
    if harbor upload "$d" --public >/dev/null 2>&1; then
      ok=$((ok+1))
    else
      fail=$((fail+1)); failed_list="$failed_list$d"$'\n'
    fi
    if [ $(( (ok+fail) % 25 )) -eq 0 ]; then
      printf '[upload] %d ok, %d failed, %d skipped\n' "$ok" "$fail" "$skip"
    fi
  done
done < "$PREFIX_FILE"

printf '\n[upload] DONE: %d uploaded, %d FAILED, %d skipped (no result.json)\n' "$ok" "$fail" "$skip"
if [ -n "$failed_list" ]; then
  echo "[upload] failures — re-run these:"
  printf '%s' "$failed_list"
  exit 1
fi
