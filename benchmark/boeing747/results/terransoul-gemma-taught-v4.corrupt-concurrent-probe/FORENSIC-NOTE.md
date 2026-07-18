# Corrupt first launch of terransoul-gemma-taught-v4 (2026-07-16, iters 1-5)

Archived per the `.corrupt-*` precedent. The iter-1 judgment (55.53/100) ran
CONCURRENTLY with the v4 reference re-probe (two judge workloads sharing one
Ollama instance, 22:35-22:47) — GPU batching makes sampling nondeterministic
even with fixed seeds. Forensic proof: all five iters carry the SAME plane
sha (e97e2db0, actor status no_change x4), iters 2-5 (run alone) scored an
IDENTICAL, stable 48.88 whose per-view profile matches this geometry's
v2/v3 signature, while iter-1's profile is a ~6.6-point outlier produced
inside the probe window. The gate therefore baselined on a corrupted
measurement and demanded an unreachable 55.53+eps forever.

Unpublished, hours-old, single-run-internal baseline => archived and the
track restarted clean (bench-never-regress applies to published floors; this
one is provably a measurement artifact). LESSON: the one-bench rule extends
to ANY concurrent judge workload — reference probes included.

## MECHANISM CORRECTION (same night, ~23:30) — it was num_ctx geometry, not concurrency

The clean relaunch (no concurrent probe) STILL scored iter-1 at 55.4 — refuting
the concurrency hypothesis. The real mechanism: the judge loaded gemma4 at
num_ctx 8192 while the actor/design-reference CLI loads the SAME model at
num_ctx 16384; Ollama reloads on context-size change, so a process's FIRST
judgment runs on a fresh 8192 geometry (55.4-55.53) and every later judgment
runs post-CLI on the 16384 geometry (identical stable 48.88 x4 on the same
sha). Two deterministic-but-different numeric regimes; neither is "corrupt",
but a gate baseline taken in one regime is unreachable in the other. Fix at
source: rubric judge_options.num_ctx aligned to 16384 (one shared model
geometry for the whole run) + reference re-probed under it. The archived
`relaunch-cold-start/` iter-1 documents the cold-geometry score. The original
concurrency lesson still stands on its own merits (batching can defeat seed
determinism); it just wasn't the operative mechanism here.
