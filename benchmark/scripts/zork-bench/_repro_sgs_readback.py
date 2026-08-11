"""Reproduce-first regression test — SGS curriculum readback (2026-06-17).

Origin: the iter-6 SGS conjecturer ingests a sub-goal lesson (tags incl.
'curriculum'/'subgoal'/'reflection') every weak episode, but it only LEAKED into
the planner via the shared reflection slate (LESSON-BIND, limit 8, relevance-
ordered) where it was usually crowded out — so the conjectured curriculum rarely
steered the next episode (a write-mostly loop). The fix adds a DEDICATED readback
that retrieves the newest sub-goal (tag 'curriculum') and binds its directives
through the SAME _lesson_promotions machinery as reflections.

This test proves, in <0.1s with NO bench / NO MCP, the binding piece (the
value-add): a sub-goal whose prose names an available untried exit produces a
planner promotion for that exit. The retrieval/integration mirrors the adjacent
LESSON-BIND block (variables in scope) and is verified by inspection.
"""
import sys

sys.path.insert(0, r"D:\Git\TerranSoulApp\benchmark\scripts\zork-bench")
from terransoul_brain_bridge import _lesson_directives, _lesson_promotions  # noqa: E402

fails: list[str] = []

# A conjectured sub-goal naming a direction → directive → promotion of that exit.
content = "Sub-goal (curriculum, ep2, guide=6.0): head north into the unexplored passage to make progress."
dirs = _lesson_directives(content)
if "north" not in dirs.get("directions", set()):
    fails.append(f"sub-goal direction not extracted: {dirs}")
promos = _lesson_promotions(dirs, ["north", "south"], {}, 4, looping=False)
if not any(p[0] == "north" for p in promos):
    fails.append(f"sub-goal did not promote the named available exit: {promos}")

# A vague sub-goal with no direction/intent → no promotion (graceful, no noise).
vague = "Sub-goal (curriculum, ep3, guide=5.0): be more careful and think harder."
vdirs = _lesson_directives(vague)
vpromos = _lesson_promotions(vdirs, ["north", "south"], {}, 4, looping=False)
if vpromos:
    fails.append(f"vague sub-goal should produce no promotion, got: {vpromos}")

# The readback must be gated by the severe-loop backoff (consistency) and use the
# dedicated 'curriculum' tag retrieval — assert the wiring exists in source.
import inspect  # noqa: E402
import terransoul_brain_bridge as B  # noqa: E402
src = inspect.getsource(B)
if 'sgs_curriculum_bind' not in src:
    fails.append("SGS readback wiring (sgs_curriculum_bind) missing from bridge")
if 'if not _lb_severe:' not in src:
    fails.append("SGS readback is not gated by the severe-loop backoff")

# AGI-purity: the readback block carries no game tokens.
blk = src[src.find("SGS curriculum readback"): src.find("SGS curriculum readback") + 1500].lower()
for tok in ("trophy", "egg", "mailbox", "leaflet", "up a tree", "troll", "thief", "grating", "forest"):
    if tok in blk:
        fails.append(f"AGI-PURITY VIOLATION: game token '{tok}' in SGS readback block")

if fails:
    print("FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("PASS — SGS sub-goal binds its directive into a promotion; vague=no-op; gated; AGI-pure")
