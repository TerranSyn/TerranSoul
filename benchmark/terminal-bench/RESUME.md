# RESUME — the k=5 submittable TerminalBench run

Written 2026-08-06 because credits were running low mid-run. **This file is
self-contained on purpose:** if the session that launched the run is gone, this
is the only thing that knows how to continue it. Do not assume any conversation
context survives.

---

## 1. What is running

A **fresh k=5 run for leaderboard submission** — 89 tasks x 5 attempts = 445
trials, output in `benchmark/terminal-bench/jobs-submit/`.

| setting | value | why it matters |
|---|---|---|
| agent | `terransoul:TerranSoul` | owner decision; a `ClaudeCode` subclass that only overrides `name()` |
| dataset | `terminal-bench/terminal-bench-2-1@sha256:7d7bdc1cbedad549fc1140404bd4dc45e5fd0ea7c4186773687d177ad3a0699a` | submission is REJECTED without the pinned ref — trials carry `source` and CI filters on it |
| attempts | 5 | leaderboard requires `MIN_TRIALS_PER_TASK = 5` |
| workers | 3 | owner chose 3 over 5 on 2026-08-06 |
| deferral | `TB_DEFER_WRITES=0` | attempt 1 teaches attempts 2-5 — owner decision, see `rules/tbench-playbook.md` |

## 2. Relaunch command (verbatim)

Run from `benchmark/terminal-bench/`. It resumes; it does not restart.

```bash
TB_JOBS_DIR="$PWD/jobs-submit" \
TB_AGENT="terransoul:TerranSoul" \
TB_TARGET_ATTEMPTS=5 TB_ATTEMPTS=5 \
TB_DATASET="terminal-bench/terminal-bench-2-1@sha256:7d7bdc1cbedad549fc1140404bd4dc45e5fd0ea7c4186773687d177ad3a0699a" \
bash run-parallel.sh 3
```

`run-parallel.sh` passes `TB_RESUME=1` itself — **mandatory**, because
`run-sweep` truncates `$STATE` unless resuming, which wipes the shard
assignment and makes every worker run all 89 tasks.

## 3. Check state before relaunching

```bash
bash sweep-status.sh          # per-worker progress, liveness, brain calls
```

Ledgers, all append-only and written **per task** (not per batch), so an abrupt
kill loses at most the one task in flight:

| file | meaning |
|---|---|
| `mcp-data/.tb-par{w}-state.txt` | tasks this worker considers DONE (accumulates across runs) |
| `mcp-data/.tb-par{w}-state.txt.shard` | the tasks assigned to this worker THIS run |
| `mcp-data/.tb-par{w}-accepted.txt` | tasks accepted as failed trials (0.0) |
| `mcp-data/.tb-par{w}-retries.txt` | per-task error counter that drives retry vs accept |
| `mcp-data/.tb-par{w}.lock` | holds the worker pid; stale locks read as `[dead]` |

Progress = intersection of `.shard` and `-state.txt`. `-state.txt` alone is
larger because it carries earlier runs' tasks too — do not read it as progress.

## 4. ⛔ BEFORE YOU RESUME AFTER A CREDIT OUTAGE — READ THIS

Credit exhaustion does **not** pause the sweep cleanly. The agent inside each
container runs on the owner's subscription; when it can no longer call the
model, the trial ERRORS, and `classify_errored_task` will — after its retry
budget — do this:

```bash
echo "$t" >> "$STATE"; echo "$t" >> "$ACCEPTED"
"task $t ERRORED terminally — accepting as a failed trial (0.0)"
```

That marks the task **done with a score of 0**, and a later resume SKIPS it.
Left unchecked, an outage silently converts the remaining tasks into unearned
zeros and the run stays "complete" while being worthless. This is the same
corruption that disqualified the previous corpus (see the playbook's
"THE OLD `jobs/` CORPUS CANNOT BE RELABELLED" section).

`last_job_hit_rate_limit` only greps `result.json` for the literal `RateLimit`,
so a credit/usage-limit error with different wording is NOT caught.

**So, after any outage, before relaunching:**

```bash
bash credit-outage-check.sh        # lists tasks accepted as 0.0 during the window
```

Any task it lists must be **removed from `$STATE` and `$ACCEPTED` and re-run**,
because its zero is an artifact of the outage and not a result. The script only
reports; removal is deliberate.

## 5. When the run completes

1. Confirm every task has >=5 non-errored trials and `n_errored_trials` is 0.
   An errored trial still contributes to `mean`, so the headline number is
   inflated until they are re-run or excluded.
2. Upload each job: `harbor upload jobs-submit/<job> --public`
3. Add `terransoul` and `claude-opus-5` to
   `leaderboard/src/leaderboard/display-names.json`
4. `uv run lb submit <hub links>`
5. **The PR must disclose** that attempts are not independent: with deferral
   off, attempt 1's lesson is available to attempts 2-5 of the same task, so
   pass@5 is not comparable to agents that start each attempt blank.
   Cross-TASK learning is the separate, uncontested claim. Owner approved
   opening the PR without a wording checkpoint (2026-08-06).

## 6. Owed cleanups (safe to do any time the sweep is stopped)

* `run-sweep.par.sh` still defaults `TB_DEFER_WRITES=1` and never exports
  `TB_ONE_JOB_PER_TASK`. It was held open by the live sweep so it could not be
  edited (`5cf76578` fixed `run-sweep.sh` and `run-sweep.next.sh`).
  `run-parallel.sh` passes `TB_DEFER_WRITES=0` explicitly, so live behaviour is
  correct — this is latent, not active. Verify with
  `bash selfimprove-default.test.sh` after editing, and add `.par.sh` to it.
* Stale `mcp-data/logs/tbench-par3.log` from an earlier 4-worker run makes
  `sweep-status.sh` print a permanent `worker 3 [dead]` row.
