#!/usr/bin/env bash
# Snapshot everything needed to resume — or to defend — a Terminal-Bench campaign.
#
#   usage: checkpoint.sh [name]      # default: campaign-<date>
#
# WHY. This campaign has been stopped and resumed eight times (script edits, a
# credential blip, a retry-policy fix, an owner pause). Every restart mints a NEW
# job prefix, and the merge reads a prefix LIST — so the single most expensive
# thing that can be lost is not the trials, it is the bookkeeping that says which
# trials belong to which campaign. Losing it silently produces a number computed
# from one restart out of six, which is exactly the defect merge-sweep.sh was
# rewritten to prevent.
#
# What is captured, and why each matters:
#   state.txt            completed task ids -> a resume skips them instead of paying twice
#   prefixes.txt         every job prefix this campaign used -> the merge covers all of it
#   retries.txt          per-task errored-attempt ledger -> the attempt bound stays bound
#   accepted-failures    tasks whose retry budget was spent, counted as 0.0 BY NAME
#   merged-result.txt    the merged number AS OF NOW, so a later number can be diffed
#   sweep.log            the full run log (witnesses, decisions, repairs)
#   lessons-written.json every lesson the sweep added to the brain, with tags
#
# The lessons snapshot is the one people forget. The bench brain is reset between
# campaigns (`rm -rf mcp-data-tbench`), so without this the corpus a run actually
# learned from is gone, and no later analysis of "did memory help" is possible.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
NAME="${1:-campaign-$(date +%Y%m%d-%H%M%S)}"
CP="$REPO/mcp-data/tb-checkpoints/$NAME"
mkdir -p "$CP"

for f in state prefixes retries accepted-failures; do
  src="$REPO/mcp-data/.tb-sweep-${f}.txt"
  [ -f "$src" ] && cp -f "$src" "$CP/${f}.txt"
done
[ -f "$REPO/mcp-data/logs/tbench-sweep.log" ] && cp -f "$REPO/mcp-data/logs/tbench-sweep.log" "$CP/sweep.log"

bash "$HERE/merge-sweep.sh" "$HERE/jobs" > "$CP/merged-result.txt" 2>&1 || true
bash "$HERE/self-improve-rate.sh" "$CP/sweep.log" > "$CP/self-improve-rate.txt" 2>&1 || true
bash "$HERE/attempt-uplift.sh" "$HERE/jobs" > "$CP/attempt-uplift.txt" 2>&1 || true

# The brain's own contribution. Read-only against the live store; if a sweep is
# running the WAL may hold newer rows, which is fine — this is a floor, not a
# claim of completeness.
node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
try {
  const db=new DatabaseSync(process.argv[1], {readOnly:true});
  const rows=db.prepare('SELECT id,content,tags,importance,created_at FROM memories WHERE id>1123 ORDER BY id').all();
  fs.writeFileSync(process.argv[2], JSON.stringify(rows,null,1));
  console.log('  lessons captured : '+rows.length);
} catch (e) { console.error('  lessons capture failed: '+e.message); }
" "$REPO/mcp-data-tbench/memory.db" "$CP/lessons-written.json" || true

echo "  checkpoint       : $CP"
du -sh "$CP" 2>/dev/null | awk '{print "  size             : "$1}'
