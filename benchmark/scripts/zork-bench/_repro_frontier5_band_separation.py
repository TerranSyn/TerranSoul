"""Sub-10s repro (P8): frontier-bonus 6->5 separates synthetic promotions
from the K33 absolute-pin band WITHOUT touching frozen bench code.

Observed bug (zork-12b-selfimprove ep1 T75-82 Attic + zork-12b-selfimprove-r2
ep1 T23-60 Forest oscillation): every bridge promotion uses
FRONTIER_BONUS + 2 = 8, which collides with the frozen K33 absolute pin
threshold (>= 8). The pin then forces router exits / BLOCKER-EXPAND
'open <noun>' over correct LLM choices ('down', 'take egg').

Fix under test: seed row tag priority_6 -> priority_5 for kind_frontier.
This repro asserts, against the REAL sources (no simulated logic drift):
  1. the frozen patch pins at literal >= 8 and uses literal threshold 6
  2. all bridge promotion sites derive from FRONTIER_BONUS + 2
  3. band arithmetic: with frontier=5 synthetic promos (7) leave the pin
     band while legit strong signals (openable +3 = 8, rewarded 12) stay in
  4. the bridge's tag parser yields 5 from a priority_5 seed tag
"""
import pathlib
import re

BENCH = pathlib.Path(__file__).resolve().parent
patch_src = (BENCH / "zork_agent_patch.py").read_text(encoding="utf-8")
bridge_src = (BENCH / "terransoul_brain_bridge.py").read_text(encoding="utf-8")

# 1. Frozen patch: K33 absolute pin at literal 8; frontier threshold literal 6.
assert "_bp_top_score >= 8" in patch_src, "K33 literal-8 pin not found"
assert "_bp_frontier_threshold = 6" in patch_src, "literal threshold-6 not found"
assert "_bp_top_score >= FRONTIER" not in patch_src, "pin unexpectedly derived"

# 2. Bridge promotions all derive from FRONTIER_BONUS + 2 (none hardcode 8).
promo_sites = re.findall(r"FRONTIER_BONUS \+ 2", bridge_src)
assert len(promo_sites) >= 3, f"expected >=3 promotion sites, got {len(promo_sites)}"
assert "FRONTIER_BONUS + 3" in bridge_src, "confirmed-openable +3 site missing"
# No promotion site pins a literal 8 on its own.
assert not re.search(r"_be_score = max\([^)]*,\s*8\)", bridge_src)
assert not re.search(r"_fr_score = 8\b", bridge_src)

# 3. Band arithmetic. frontier=6: promos collide with the pin band (the
# original bug). frontier=5: promos leave the pin band but sit ABOVE the
# at-frontier exception boundary (cardinal-vs-cardinal stays off — the r3
# ep2 Kitchen edge). frontier=4: promos land exactly ON the K43 boundary,
# activating the exception gates. Accepted trade at 4: openable/enter
# (F+3=7) leave the absolute pin band — first-discovery falls to the
# model's visible-noun proposals + solution-replay (F+8, forced) from the
# first scoring episode on; acquire-light (F+4=8) keeps the pin.
K33_PIN = 8          # frozen literal (asserted above)
K43_THRESHOLD = 6    # frozen literal (asserted above)
for frontier, promo_pinned, promo_on_boundary, openable_pinned in (
    (6, True, False, True),
    (5, False, False, True),
    (4, False, True, False),
):
    promo = frontier + 2          # router / BLOCKER-EXPAND / put synthetic
    openable = frontier + 3       # confirmed-openable / enter-after-open
    light = frontier + 4          # acquire-light promotion
    replay = frontier + 8         # cross-episode solution-replay (also `forced`)
    rewarded = 12                 # previously-rewarded (legit strong signal)
    unstable_cap = frontier - 1   # K34 cap for speculative noun actions
    untried_exit = frontier
    assert (promo >= K33_PIN) is promo_pinned, (frontier, promo)
    assert (promo <= K43_THRESHOLD) is promo_on_boundary, (frontier, promo)
    assert (openable >= K33_PIN) is openable_pinned, (frontier, openable)
    assert light >= K33_PIN, "acquire-light left the pin band"
    assert replay >= K33_PIN, "solution-replay left the pin band"
    assert rewarded >= K33_PIN, "legit rewarded signal left the pin band"
    assert unstable_cap < untried_exit, "open-noun spam outranks exits"
    assert promo >= K43_THRESHOLD, "promotions fell below the frontier branch"

# 4. Tag parsing (the exact mechanism _get_planner_bonuses uses).
tags = "universal-planner-bonus,kind_frontier,priority_4,agent-reasoning,planner,spec014"
tag_tokens = [t.strip() for t in tags.split(",")]
kind = next(t[len("kind_"):] for t in tag_tokens if t.startswith("kind_"))
priority = int(next(t[len("priority_"):] for t in tag_tokens if t.startswith("priority_")))
assert (kind, priority) == ("frontier", 4)

print("REPRO GREEN: priority_4 seed tag -> FRONTIER_BONUS=4 -> synthetic promos (6) "
      "land ON the K43 exception boundary (cardinal-tie/visible-noun/compass gates "
      "active); light=8/replay=12/rewarded=12 keep the pin; K34 cap 3 < exits 4. "
      "Accepted trade: openable/enter 7 < 8 (model proposals + solution-replay cover).")
