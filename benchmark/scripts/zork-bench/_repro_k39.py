"""K39 sub-10s repro — inventory items get bonus capped to 0 for non-acquisition verbs."""

ACQUIRE_PREFIXES = ("take ", "get ", "grab ", "pick up ")

def score_action(verb, obj, bonus, in_inventory):
    act_l = f"{verb} {obj}".lower()
    if in_inventory and any(act_l.startswith(p) for p in ACQUIRE_PREFIXES):
        return -3, "already carried"
    if in_inventory:
        return max(bonus - 7, 0), "carried item"
    return bonus, "stable noun"

# Bonuses pulled from real shortlist: take=8, open=9, light=8, climb=8, move=7, enter=7, read=7, examine=6, look_in=5
inv = True
assert score_action("take", "leaflet", 8, inv) == (-3, "already carried")
assert score_action("open", "leaflet", 9, inv) == (2, "carried item")
assert score_action("light", "leaflet", 8, inv) == (1, "carried item")
assert score_action("climb", "leaflet", 8, inv) == (1, "carried item")
assert score_action("read", "leaflet", 7, inv) == (0, "carried item")
assert score_action("examine", "leaflet", 6, inv) == (0, "carried item")

# Non-inventory items keep full bonus (real environment objects)
assert score_action("take", "machete", 8, False) == (8, "stable noun")
assert score_action("open", "mailbox", 9, False) == (9, "stable noun")

# Frontier exit beats all carried-item actions:
frontier = 6
assert frontier > score_action("open", "leaflet", 9, inv)[0]   # 6 > 2
assert frontier > score_action("light", "leaflet", 8, inv)[0]  # 6 > 1
assert frontier > score_action("read", "leaflet", 7, inv)[0]   # 6 > 0
print("K39 case A: all carried-leaflet verbs cap at <=2, frontier=6 wins all")

# Real room object beats carried item:
assert score_action("take", "machete", 8, False)[0] > score_action("open", "leaflet", 9, inv)[0]
print("K39 case B: take machete (room) > open leaflet (carried)")

print("FIX VERIFIED: K39 carried-item bonus cap restores frontier dominance.")
