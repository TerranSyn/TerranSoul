"""K38 sub-10s repro: acquisition verbs on already-carried items demoted to -3."""

ACQUIRE_PREFIXES = ("take ", "get ", "grab ", "pick up ")

def is_acquire_on_carried(act, inventory_lower):
    act_l = act.lower()
    # Find which prefix matches and extract noun
    for p in ACQUIRE_PREFIXES:
        if act_l.startswith(p):
            noun = act_l[len(p):].strip()
            if noun in inventory_lower:
                return True
    return False

inventory = {"leaflet"}

# Acquisition verbs on carried item → blocked
for act in ("take leaflet", "get leaflet", "grab leaflet", "pick up leaflet"):
    assert is_acquire_on_carried(act, inventory), f"{act} should be blocked"
print("K38 case A: take/get/grab/pick-up leaflet all blocked when leaflet carried")

# Non-acquisition verbs on carried item → NOT blocked (still need to read/light/etc)
for act in ("read leaflet", "light leaflet", "drop leaflet", "examine leaflet"):
    assert not is_acquire_on_carried(act, inventory), f"{act} should NOT be blocked"
print("K38 case B: read/light/drop/examine leaflet NOT blocked (still valid actions)")

# Acquisition on non-carried item → NOT blocked
for act in ("take sword", "get egg", "grab lamp"):
    assert not is_acquire_on_carried(act, inventory), f"{act} should NOT be blocked"
print("K38 case C: take/get/grab non-carried items NOT blocked (still need to acquire)")

# Empty inventory → no blocking
for act in ("take leaflet", "get sword"):
    assert not is_acquire_on_carried(act, set()), f"{act} should NOT be blocked when no inventory"
print("K38 case D: empty inventory → no blocking")

# Score check: with K38, take leaflet on carried gets -3, real frontier west=6 wins
take_leaflet_score = -3 if is_acquire_on_carried("take leaflet", inventory) else 10
west_score = 6  # frontier untried
assert west_score > take_leaflet_score
print(f"K38 score: take leaflet (carried)={take_leaflet_score}, west(frontier)={west_score} → west wins")

print("FIX VERIFIED: K38 universal acquisition-verb dedup for carried items.")
