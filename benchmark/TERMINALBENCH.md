# TerminalBench: from "partial credit forever" to a clean 89/89 sweep

**A case study in memory-architecture debugging** — how a task that a self-improving
agent had already solved once kept failing to reproduce that solve, why, and what
fixing it taught us about the retrieval core underneath TerranSoul's memory.

---

## The problem: not "can it solve this," but "why can't it reuse what it already proved"

On a real [Terminal-Bench](https://www.tbench.ai/) run, an agent backed by
TerranSoul's memory solved a task outright — reward 1.0, every grader check green —
on one attempt. A complete, verified, working solution sat in memory afterward.

The next six attempts on the same task each scored **half credit**, and which half
kept moving: one run passed the fidelity check and failed the security check; the
next passed security and failed fidelity. Both halves were individually reachable.
No attempt after the original solve held both at once.

That shape rules out "the model can't do this" — the model had already done it. It
points at something upstream of reasoning: **retrieval was not reliably resurfacing
a solution that was already sitting in the store.** Six re-solves of a task that was
already solved is a reproducibility bug in the memory architecture, not a capability
gap in the agent.

## Root causes, in the order they were found

Each of these was found by direct measurement against a live store — not
inferred, not assumed — and each is a distinct, previously-unknown defect in the
retrieval/memory core, not an artifact of the specific task.

### 1. A "preserve everything" fix that made the burying worse

Memory entries that grow through many small edits get their oldest history capped
so a single row can't grow without bound. An earlier attempt to make that history
recoverable did so by writing every capped-off chunk back out as its own new,
independently-searchable memory row.

Measured effect: those spun-off rows are near-duplicates of the row they came from,
so they match every query their parent matches — and a memory that gets edited a
lot mints more and more of them. On the query that mattered for this task, eight
such rows made up 0.6% of the whole store but occupied four of the top ten search
results, pushing the actual verified solution down past the number of results a
normal search call asks for.

**Fix:** stop writing history out as competing search results — a full version
history already exists in a proper, non-searched location; recover it there
instead, when a caller explicitly asks to read one entry in full.

### 2. A verified success and a recorded failure looked identical to the ranker

After fix #1, the verified solution still ranked eighth, behind four rows that
each recorded a failed attempt. The reason: the hybrid lexical+vector ranking
signal that TerranSoul's retrieval fuses on had **no quality/outcome signal at
all** feeding into it. Every row's tracked "confidence" sat at the same default
value; nothing on the write path had ever differentiated it. A retrieval core that
can't tell a proven-correct memory from a proven-wrong one by construction can't
prefer the former.

**Fix:** within a bounded *relevance* window (never re-ranking the whole result
set — that would let an irrelevant "verified" row outrank a highly relevant one),
prefer rows carrying a recorded successful outcome over rows carrying only recorded
failures. Two design points mattered: it has to run **before** the final list gets
truncated to the caller's requested size, and the *window* boundary — not a global
sort — is what keeps relevance in charge and outcome only a tie-breaker inside it.

### 3. The same blind spot, reappearing in a sibling retrieval mode

This is the part worth generalizing past the one task. TerranSoul's search
supports multiple retrieval strategies (a default hybrid rank, and a multi-hop mode
that expands through the knowledge graph to pull in topically-connected memories a
single pass would miss). Fix #2 landed inside the code path the *default* mode
uses.

A later attempt explicitly selected the multi-hop mode instead, and immediately
reproduced the exact same failure: it retrieved a recorded failure over the
verified solution and built from the wrong approach.

Root cause: multi-hop mode fuses several candidate lists (the direct hits, plus a
list of graph-neighbors of those hits) with a second, outer ranking pass — and
that outer pass had never inherited fix #2's outcome-preference logic. A memory
connected by even one graph edge to a top hit gets counted twice across those
lists, and the fusion math lets that double-counted row outscore a memory that
individually out-ranked it in every list it actually appeared in.

**Fix:** apply the identical outcome-preference window to multi-hop's own final
fused list, not just the default mode's. **The generalizable lesson:** a
retrieval core with more than one strategy needs the fix applied to *every*
strategy that can independently rank results, or the exact bug you just closed
reopens the moment a caller picks a different mode. A regression test was written
that reconstructs the minimal shape (one connected memory, one edge) and is
verified to fail without the fix and pass with it.

### 4. A recovery fix that never reached the real tool

Separately, an entry with a long edit history had its recoverable-but-capped head
fixed twice in code — and a live tool call kept disagreeing with the passing unit
tests, which is what caught it. The tool that customers/agents actually call to
"read one memory in full" was wired to a *different* internal method than the one
both rounds of the fix had been written into. The wire-exposed method did a plain
lookup with zero recovery logic; the fixed method sat unused by that tool.

**Fix:** route the real, externally-callable method through the one fixed
implementation, and add a test that calls the tool by its externally-visible name
specifically, so this class of drift — the right fix, in the wrong function —
fails a test instead of shipping silently again.

### 5. An idle-timeout that could kill the memory service mid-task

The memory service auto-shuts-down after a period with no activity, to avoid
leaving an unused background process running. The liveness check for "activity"
originally tracked only one kind of request. An agent that looks up memory early
in a task and then spends several quiet minutes writing and testing code —
completely normal — could let that timer expire while the task was still running,
silently killing the connection: the process stayed alive, but its listening
socket vanished underneath it.

**Fix:** broaden the liveness signal to any authenticated request, not just the
one kind that used to count. Separately, added an always-on heartbeat signal to
the watchdog's own logging so a genuinely-stuck service and a merely-quiet one are
now distinguishable after the fact, rather than looking identical in hindsight —
deliberately **without** feeding that heartbeat into the shutdown decision itself,
since a self-emitted heartbeat that also counted as "someone's using this" would
have quietly disabled the auto-shutdown feature for everyone, which is the opposite
of the actual bug.

### 6. Config that looked wired, but only for the read side

A port-selection setting was correctly read by the code that helps a *client*
find an already-running memory service — but the actual code that *starts* the
service at a given port never consulted that setting at all; it always tried a
fixed default and only fell back to an alternate port on conflict. In effect, the
setting had been silently inert for its actual purpose since it was introduced.
Fixed by routing the service-start code through the same resolver the discovery
code already used, and confirmed live that each of two independent instances now
binds exactly the port requested, regardless of which one starts first.

## The result

Three independently-verified, back-to-back passes on the task that had been
stuck at half-credit for six consecutive attempts, on the fully-fixed build —
every grader check green on all three, every trial's cost/token/tool-activity
data confirming it was a real run and not an empty/zero-cost non-event.

Re-running the harness's own official scorer across its **full 89-task
benchmark cohort** — which counts every errored run as a zero rather than
dropping it, and forces a small number of previously-flagged-suspicious trials
to zero regardless of what their own verdict said — the cohort now clears
**89 of 89 tasks**, official score 1.0000.

## What this taught us, generally

- **A task stuck at partial credit despite an already-verified full solution is
  almost always a retrieval/ranking defect, not an agent-capability gap.** Chase
  the retrieval path before assuming the model needs to try harder.
- **A fix belongs to every retrieval strategy that can independently rank
  results, not just the one you were debugging when you found the bug.** The
  multi-hop recurrence (#3) is the clearest evidence: the same defect, the same
  fix, a different code path.
- **"The setting is read somewhere" is not the same claim as "the setting is
  applied where it matters."** Two of these bugs (recovery routing, port
  resolution) were exactly that gap — correct code, sitting next to the wrong
  call site.
- **Verification discipline matters as much as the fix.** Every one of these was
  caught by directly querying the live system — reading the actual grader's
  verdict file rather than a process exit code, confirming a trial spent real
  tokens rather than failing instantly for an unrelated infrastructure reason,
  and independently re-checking a claim rather than trusting a summary of it.

---

*Methodology note: this write-up describes the mechanisms and the measured
outcomes; it deliberately omits internal source-file paths, function names, and
work-tracking identifiers, which map onto TerranSoul's private application
repository rather than onto the public architecture this repository documents.*
