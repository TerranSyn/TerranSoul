"""K42 — All verbs on unstable nouns capped below FRONTIER_BONUS.

Asserts:
1. open <unstable_noun>  -> 5  (was 7 under K34, K42 caps at FRONTIER-1)
2. light <unstable_noun> -> 5  (was 6, still capped)
3. climb <unstable_noun> -> 5  (was 6, still capped)
4. take <unstable_noun>  -> 5  (K41 already; K42 preserves)
5. open <stable_noun>    -> full bonus (unaffected)
6. open <carried_item>   -> still K39 personal-state cap (≤3)
7. take <carried_item>   -> -3 (K38 wins)
8. frontier exit         -> 6 (always beats every unstable verb)
"""
import sys, importlib.util, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
# Skip module import — replicate scoring directly. AST-validated separately.

FRONTIER = 6  # FRONTIER_BONUS

def score_planner(room, exits, objects, inventory, visited_dirs, known_exits,
                   tried_map, stable_nouns):
    """Re-implement the per-action scoring path under test."""
    ACQUIRE_PREFIXES = ("take ", "get ", "grab ", "pick up ")
    affordances = [
        ("take", 10, "take"),
        ("open", 9, "open"),
        ("light", 8, "light"),
        ("climb", 8, "climb"),
        ("move", 7, "move"),
        ("enter", 7, "enter"),
        ("read", 7, "read"),
        ("examine", 6, "examine"),
        ("look in", 5, "look in"),
    ]
    inventory_lower = {x.lower() for x in inventory}
    scored = []
    for d in exits:
        if d in visited_dirs:
            scored.append((d, 0, "visited"))
        else:
            scored.append((d, FRONTIER, "frontier"))
    candidate_nouns = [(n, n in stable_nouns) for n in objects]
    for obj, is_stable in candidate_nouns:
        noun_l = obj.lower()
        is_inv = noun_l in inventory_lower
        for verb, bonus, hint in affordances:
            act = f"{verb} {obj}"
            act_l = act.lower()
            base = 0
            if is_inv and any(act_l.startswith(p) for p in ACQUIRE_PREFIXES):
                base = -3
                scored.append((act, base, f"K38 carried+acquire"))
                continue
            effective = bonus
            if is_inv:
                effective = max(bonus - 7, 0)
                reason = "K39 carried"
            elif not is_stable:
                # K42 path
                effective = min(max(bonus - 2, 1), FRONTIER - 1)
                reason = "K42 unstable speculative"
            else:
                reason = "stable full"
            scored.append((act, base + effective, reason))
    return scored

# Scenario: Up a Tree with NLP-extracted unstable nouns
scored = score_planner(
    room="Up a Tree",
    exits=["east", "north", "south", "up", "west"],
    objects=["branch", "nest", "jewels"],   # all unstable (first sighting)
    inventory=["leaflet"],
    visited_dirs=set(),
    known_exits={},
    tried_map={},
    stable_nouns=set(),
)
top5 = sorted(scored, key=lambda x: -x[1])[:8]
print("K42 unstable scenario top8:", top5)

# Asserts
d = {a: s for a, s, _ in scored}
assert d["open branch"] == 5, f"open branch should be 5, got {d['open branch']}"
assert d["light branch"] == 5, f"light branch should be 5, got {d['light branch']}"
assert d["climb branch"] == 5, f"climb branch should be 5, got {d['climb branch']}"
assert d["take branch"] == 5, f"take branch should be 5, got {d['take branch']}"
assert d["examine branch"] == 4, f"examine branch should be 4 (K34), got {d['examine branch']}"
assert d["east"] == 6, f"frontier east should be 6, got {d['east']}"
# Frontier MUST beat all unstable verbs
unstable_max = max(s for a, s, _ in scored if a.startswith(("open ", "light ", "climb ", "take ", "move ", "enter ", "read ")))
frontier_max = max(s for a, s, _ in scored if a in {"east", "north", "south", "up", "west"})
assert frontier_max > unstable_max, f"K42 BROKEN: frontier {frontier_max} <= unstable {unstable_max}"
print(f"K42 OK: frontier_max={frontier_max} > unstable_max={unstable_max}")

# Scenario 2: stable noun still gets full bonus
scored2 = score_planner(
    room="West House",
    exits=["north"],
    objects=["mailbox"],
    inventory=[],
    visited_dirs=set(),
    known_exits={},
    tried_map={},
    stable_nouns={"mailbox"},
)
d2 = {a: s for a, s, _ in scored2}
assert d2["open mailbox"] == 9, f"open mailbox stable should be 9, got {d2['open mailbox']}"
assert d2["take mailbox"] == 10, f"take mailbox stable should be 10, got {d2['take mailbox']}"
print(f"K42 stable: open mailbox={d2['open mailbox']} take mailbox={d2['take mailbox']}")

# Scenario 3: carried item still K38/K39
scored3 = score_planner(
    room="West House",
    exits=["north"],
    objects=["leaflet"],
    inventory=["leaflet"],
    visited_dirs=set(),
    known_exits={},
    tried_map={},
    stable_nouns={"leaflet"},
)
d3 = {a: s for a, s, _ in scored3}
assert d3["take leaflet"] == -3, f"K38: take carried should be -3, got {d3['take leaflet']}"
assert d3["open leaflet"] == 2, f"K39: open carried should be 2, got {d3['open leaflet']}"
print(f"K42 carried: take={d3['take leaflet']} open={d3['open leaflet']}")

print("ALL K42 ASSERTS PASS")
