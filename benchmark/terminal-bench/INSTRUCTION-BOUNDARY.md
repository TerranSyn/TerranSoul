# Agent-instruction changes during the k=5 submittable run

`extra-instruction.md` is what the agent is TOLD, so changing it mid-campaign
means trials before and after ran under different conditions. That is real
harness drift and it must be disclosed rather than hidden — it is one of the
reasons the previous 324-trial corpus cannot be pooled.

Recording the boundary here so any submission can state it precisely.

| # | when | change | trials before |
|---|---|---|---|
| 1 | 2026-08-07, at 30 of 89 tasks clean | added the **opening move** recording category, and a line asking for an opening-move lookup BEFORE the first command | 30 tasks had 5 clean trials under the previous instruction |

## Why it was changed mid-run

Owner asked twice for each worker to finish faster using self-improvement.
Measured on the live bench brain: 1318 memories, of which only **216 (16%)**
were phrased as a procedural shortcut. The other 84% were task solutions, which
pay off only if that exact task recurs. The single highest-leverage missing
category was the opening move, since every task begins with orientation.

## What this does NOT change

* No task-specific content, walkthroughs, or answers were added — the category
  is generic and names no task (`rules/bench-agi-purity.md` holds).
* No execution settings, timeouts, or resource overrides.
* The dataset ref, agent identity, and attempt count are untouched.

## What a submission must say

That ~30 of 89 tasks were completed under the earlier instruction and the
remainder under this one, and that the change asks the agent to record and
retrieve opening moves. Anyone comparing per-task timings across that boundary
should treat it as two populations.
