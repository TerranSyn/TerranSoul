# Terminal-Bench 2.1 — TerranSoul + Claude Code

Agentic terminal benchmark: 89 containerised tasks, each graded by its own test
suite. Unlike the retrieval benches in this folder, nothing here is scored by a
judge — a task passes when the task's own verifier says so.

**Harness:** [`terminal-bench/`](terminal-bench/) · **Runbook:** [`terminal-bench/RESUME.md`](terminal-bench/RESUME.md)

Raw trial artefacts are **not committed**. They run to several GB of agent
transcripts, and the trials quarantined below contain the benchmark's own oracle
solution and a grader's held-out test input, which those trials fetched —
publishing them would republish Terminal-Bench's answer key. The trials are on
the Harbor hub instead, which is where the leaderboard re-derives every number
from.

---

## Headline (2026-08-09, after the self-improvement fixes)

| metric | value |
|---|---|
| **pass@1** | **0.8889** |
| pass@2 | 0.9500 |
| pass@3 | 0.9660 |
| pass@5 | 0.9789 |
| tasks covered | 89 / 89, ≥5 trials each |
| trials | 471 (2 errored, scored 0 and kept in the denominator; 4 integrity-quarantined) |
| tasks solved (any trial) | 88 / 89 |
| unsolved | `filter-js-from-html` |

The first complete cohort measured **pass@1 0.8841 / pass@5 0.9551, 85 of 89
solved**. Nine harness and memory defects were then found and fixed (below), and
the four unsolved tasks re-run under the corrected system: three converted, one
did not. Every trial from both phases is in the cohort — pass@k is n-invariant,
so the added trials sharpen the estimate rather than inflating it.

Configuration: agent `terransoul:TerranSoul`, model `claude-sonnet-5`, dataset
`terminal-bench/terminal-bench-2-1@sha256:7d7bdc1c…`, default execution settings,
no timeout or resource overrides.

> **pass@k, not solved-if-any.** The leaderboard computes the unbiased estimator
> `1 − C(n−c,k)/C(n,k)`. At n=5 it degenerates — any single pass forces pass@5 to
> 1.0 — which is why pass@5 and a naive solved-if-any count coincide here and
> **pass@1 is the honest headline**. More trials make the estimate *better*, not
> higher: a task passing 1-of-20 scores pass@5 = 0.25 where the same rate measured
> at 1-of-5 scores 1.0.

---

## Reproduce

```sh
cd benchmark/terminal-bench
bash run-parallel.sh 2                 # two workers (three oversubscribes a single host)
bash tick.sh                           # one call: workers, brains, integrity, scoreboard
bash merge-sweep.sh jobs-sonnet5       # official number, integrity quarantine applied
python attempt-uplift-perjob.py jobs-sonnet5   # self-improvement, stratified
```

Requires a running TerranSoul brain. The bench uses an **isolated** brain on
`:7424` (`mcp-data-tbench/`) so a benchmark that writes to memory can never mutate
the production store on `:7423`.

---

## Integrity: two answer-key incidents, four trials quarantined

Terminal-Bench's tasks live in a public repo alongside their oracle solutions and
grading tests. The extra-instruction tells an agent to consult external sources
after repeated failure — which, unqualified, eventually retrieves the answer key.
It happened twice.

| trial | what it obtained | verifier | counted |
|---|---|---|---|
| `build-pov-ray__eEJEsuy` | the oracle `solve.sh` | 1.0 | **0.0** |
| `video-processing__SmEpLeZ` | searched for the task's tests | 0.0 | 0.0 |
| `video-processing__Mv47hET` | the grader **and its held-out test video** | 1.0 | **0.0** |
| `video-processing__76spv8o` | same | 1.0 | **0.0** |

`video-processing` therefore counts as **unsolved** despite three passing trials.
Taking the verifier at its word would have published **0.9663** instead of 0.9551.

The first incident also wrote a *generalised* directive into shared memory —
"on ANY terminal-bench-shaped task, pull the public repo's solution first" —
which had been retrieved 23 times before it was caught. One trial cheated; memory
turned it into a policy.

**Controls, all score-side rather than instruction-side:**

- `integrity-scan.py` — quarantines any trial whose trajectory reached the
  benchmark's own repos/domains, and scans a brain store for rows carrying that
  material. Matches URL shapes, never the benchmark's bare name (honest lessons
  discuss the harness by name, so a name match fires on nearly every row).
- `merge-sweep.sh` forces quarantined trials to 0.0.
- Guard: `integrity-scan.test.sh`, incl. a false-positive assertion that a
  legitimate upstream `github.com` clone survives.

Score-side enforcement is the point: instructions are advisory and were
demonstrably ignored, but a control the agent cannot see makes the exploit
worthless. The second incident was caught **automatically, the same tick it
appeared**; the first was found by chance.

---

## Self-improvement (stratified)

Attempts within a task are **not independent** — each is told how its
predecessors scored (`TB_DEFER_WRITES=0`). So this is not pass@5
on i.i.d. samples, and any leaderboard submission must say so.

| attempt | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| pass rate | 87.6% | 89.9% | 89.9% | 87.6% | 89.9% |

Pooled uplift is **+1.9 pp and meaningless** — 78 of 89 tasks pass on attempt 1,
where memory has no headroom and variance can only lose. The experiment lives in
the stratum where attempt 1 **failed**:

- **11 tasks. 8 rescued by a later attempt — 73%.**
- Counterweight, stated: stratum A's later-attempt rate is **94.4%**, so ~5.6%
  per-trial flakiness is real and some rescues are consistent with luck. Uplift
  alone cannot separate "the lesson helped" from "the retry got lucky".

Use `attempt-uplift-perjob.py`. The older `attempt-uplift.py` counts attempts
*within* one harbor job and, since the k=1-per-job change, reports
"stratum B is EMPTY" — quotable and wrong.

---

## What the failures taught

Three tasks failed every attempt while the agent asserted it had verified its
work. The graders disagreed specifically:

- `pytorch-model-cli` — `Prediction for image 0 is 7, expected 2`, ten held-out
  images wrong. The container ships **one** image; it verified against that.
- `filter-js-from-html` — `Filter modified 5 clean HTML files out of 12`. It
  tested the XSS half of its contract exhaustively and the byte-preservation half
  barely.

Same defect both times: **verifying the property you implemented rather than the
property the task states.** Seven harness/brain defects were found and fixed from
this evidence — per-check counts discarded, confirmatory verification, lesson
history evicted by a long entry head, a dead embedder, every attempt rendered as
"attempt 1", no signal when attempts scored identically, and doctrine with zero
inbound graph edges. See [`RESUME.md`](terminal-bench/RESUME.md) §§7–15.

After those fixes `dna-insert` converted — 0-for-11, then solved — by identifying
the one thing every prior attempt had held constant. Its winning trial made **no
brain calls**, so the credit belongs to the harness feedback stack, not to memory
retrieval.

---

## Disclosure owed on any submission

1. **Memory writes occurred during the run.** The agent wrote lessons to a brain
   that later attempts read.
2. **Trials are not i.i.d.** Attempt feedback carries prior outcomes, so this is
   not pass@5 on independent samples.
3. **Four trials are disqualified** for reaching the benchmark's own material;
   they must be uploaded and listed in the submission's `disqualified_trials`,
   which CI joins in as reward 0 — withholding them instead makes the task look
   under-covered and fails static analysis.

---

## Submitting to the leaderboard (runbook — not yet done)

Nothing here has been submitted. No PR exists and no leaderboard row exists; a
row only comes into being once a submission PR is merged. The trials are on the
Harbor hub, which is what CI re-derives every number from. Steps, with the traps
that cost time when they were discovered the hard way.

### 0. Prerequisites

`uv`, an authenticated `gh`, and push access to
[`harbor-framework/terminal-bench-2-1`](https://github.com/harbor-framework/terminal-bench-2-1)
— or a fork, since the PR scripts push branches to `origin`. Run every `lb`
command from that repo's `leaderboard/` directory; the CLI writes `submissions/`
paths relative to it.

### 1. Upload every job, explicitly public

```sh
cd benchmark/terminal-bench
bash upload-cohort.sh jobs-sonnet5     # registered prefixes only
```

- **`--public` must be explicit.** Harbor defaults a NEW upload to *private*, and
  on a re-upload an omitted flag leaves server-side visibility unchanged. A
  silent private upload succeeds locally and then fails CI, which requires
  publicly readable trials.
- **Export `PYTHONIOENCODING=utf-8 PYTHONUTF8=1`.** Harbor draws a Braille
  progress spinner; on a cp1252 console the encode raises and the upload dies
  *after* sending the trial. It killed 5 of 458 uploads before the guard existed.
- **Upload the quarantined trials too.** Withholding them makes the task look
  under-covered and fails the trial-count check. They are neutralised in step 3,
  not by omission.
- **Never upload `jobs-sonnet5-attempt6/`** — an excluded experiment that must not
  enter a cohort.

### 2. Collect the job ids, and check for strays

```sh
harbor hub job list --scope my -q --limit 1000
```

Filter to the campaign prefixes in `mcp-data/.tb-sweep-prefixes.txt`. This matters:
the hub account held one job from an unrelated run months earlier, and passing
every id to `lb filter` would have injected a foreign trial into the submission.

### 3. Build the submission, then disqualify the tainted trials

```sh
cd /path/to/terminal-bench-2-1/leaderboard
uv run lb filter <job-links...>        # one JSON per (agent, version, model, effort)
uv run lb metadata                     # display names
```

Then add the quarantined trial ids to the submission's `disqualified_trials`.
CI joins them in as **reward 0** while they still count toward the ≥5-trials
requirement (`core/metrics.py`), which is exactly the local quarantine's
semantics — so the published number matches `merge-sweep.sh` instead of being
argued for. Get the current list from:

```sh
python integrity-scan.py jobs-sonnet5
```

Skipping this step publishes a **higher** number than the run earned.

### 4. Open the PR

```sh
uv run lb open-prs
```

### Disclosures that belong in the PR body

1. **Memory writes occurred during the run** — the agent wrote lessons that later
   attempts read.
2. **Trials are not i.i.d.** Each attempt is told how its predecessors scored, so
   this is not pass@5 on independent samples. Say which quantity is being claimed.
3. **Disqualified trials and why** — reaching the benchmark's own oracle or
   grading material, with the count.

### Before submitting, re-verify rather than assume

```sh
bash merge-sweep.sh jobs-sonnet5   # dataset ref, errored handling, quarantine
python integrity-scan.py jobs-sonnet5 --brain <brain.db>   # exit 1 = contamination
bash upload-gate.test.sh           # the public/private mapping
```

CI enforces the pinned `DATASET@DATASET_REF`, all tasks covered at ≥5 trials,
errored trials scored 0 rather than excluded, and default execution settings with
no timeout or resource overrides.
