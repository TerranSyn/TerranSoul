"""Reproduce-first regression test — SEVERE-LOOP BACKOFF (2026-06-17).

Origin (v6b clean bench, zork-12b-cleanvram-prereq-v6b): with the infra/VRAM wall
fixed, the FIRST uncontaminated run still floored at 5. The transcript showed the
agent trapped at one room: the actor proposed 'down' (the only escape/backtrack)
but the harness OVERRODE it 184x (orig='down' top='south'/'up') because LESSON-BIND
escalated a GENERIC cross-room direction lesson ('south'/'up') to a force-pin
score. The agent never left the room.

Fix: a two-tier loop gate in the LESSON-BIND read path. The 4-turn tier still
escalates (give the lesson a chance to break a fresh loop); but once the agent is
SEVERELY looping (turns_since_progress >= 8) the lessons have demonstrably failed,
so LESSON-BIND backs off (promotes nothing) and the base frontier/explore/actor
choice executes. Strictly reduces forcing — it can never add a bad override.

This test proves, in <0.1s with NO bench / NO MCP, the pure threshold logic and
that _lesson_promotions still works at the non-severe tier (the escalation path is
unchanged below the severe threshold).
"""
import re
import sys

sys.path.insert(0, r"D:\Git\TerranSoulApp\benchmark\scripts\zork-bench")
from terransoul_brain_bridge import _lesson_promotions, _lesson_directives  # noqa: E402

fails: list[str] = []

# --- 1. the escalation tier (4..7 turns) still promotes a recommended exit -----
dirs = _lesson_directives("the agent looped; it should go south to make progress")
promos = _lesson_promotions(dirs, ["south", "down"], {}, 4, looping=True)
if not any(p[0] == "south" for p in promos):
    fails.append("non-severe escalation tier should still promote a recommended exit")
# escalated score is frontier_bonus(4) + boost(3) = 7 (the force-pin band)
south = [p for p in promos if p[0] == "south"]
if south and south[0][1] < 7:
    fails.append(f"escalated 'south' should reach the force-pin band (>=7), got {south[0][1]}")

# --- 2. the severe gate is exactly turns_since_progress >= 8 (two-tier) --------
# Mirror the bridge's structural thresholds so a future refactor that changes them
# trips this test. The read path uses: _lb_loop = tsp>=4 ; _lb_severe = tsp>=8.
import inspect  # noqa: E402
import terransoul_brain_bridge as B  # noqa: E402
src = inspect.getsource(B)
m_loop = re.search(r"_lb_loop\s*=\s*_lb_tsp\s*>=\s*(\d+)", src)
m_sev = re.search(r"_lb_severe\s*=\s*_lb_tsp\s*>=\s*(\d+)", src)
if not m_loop or int(m_loop.group(1)) != 4:
    fails.append("escalation tier threshold (_lb_loop >= 4) missing/changed")
if not m_sev or int(m_sev.group(1)) != 8:
    fails.append("severe-backoff threshold (_lb_severe >= 8) missing/changed")
if m_loop and m_sev and int(m_sev.group(1)) <= int(m_loop.group(1)):
    fails.append("severe threshold must be strictly above the escalation threshold")

# --- 3. the read loop is gated by _lb_severe (back off = iterate nothing) ------
# The bridge expresses backoff as: for _lb_h in ([] if _lb_severe else _extract_hits(_lb))
if not re.search(r"for _lb_h in \(\[\] if _lb_severe else _extract_hits\(_lb\)\)", src):
    fails.append("LESSON-BIND read loop is not gated by _lb_severe backoff")

# --- 4. AGI-purity: the backoff logic carries no game tokens ------------------
sev_block = src[src.find("SEVERE-LOOP BACKOFF"): src.find("SEVERE-LOOP BACKOFF") + 1200].lower()
for tok in ("trophy", "egg", "mailbox", "leaflet", "up a tree", "forest", "troll", "thief", "grating"):
    if tok in sev_block:
        fails.append(f"AGI-PURITY VIOLATION: game token '{tok}' in backoff logic")

if fails:
    print("FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("PASS — two-tier loop gate: escalate at >=4, back off at >=8; non-severe path intact; AGI-pure")
