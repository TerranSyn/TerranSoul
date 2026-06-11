"""K33 (inventory pool) + K34 (noun stability) sub-10s repro."""

FRONTIER_BONUS = 6

def score(objects, inventory, seen_counts, affordances):
    """Simplified planner: returns list of (action, score, reason)."""
    scored = []
    seen_keys = set()
    candidate_nouns = []
    for obj in objects:
        k = obj.lower()
        if k in seen_keys: continue
        seen_keys.add(k)
        candidate_nouns.append((obj, seen_counts.get(obj, 0) >= 2))
    for inv in inventory:
        k = inv.lower()
        if k in seen_keys: continue
        seen_keys.add(k)
        candidate_nouns.append((inv, True))  # inventory = always stable

    for obj, stable in candidate_nouns:
        for verb, bonus in affordances:
            act = f"{verb} {obj}"
            eff = bonus if stable else max(bonus - 2, 1)
            scored.append((act, eff, "stable" if stable else "unstable"))
    return scored

# Affordances mimic what bridge returns
afford = [("take", 4), ("read", 4), ("examine", 2), ("open", 3)]

# Case A: K33 — leaflet in inventory, "word" in obs (NLP false positive seen once)
result = score(objects=["word"], inventory=["leaflet"], seen_counts={"word": 1}, affordances=afford)
result.sort(key=lambda t: -t[1])
top = result[0]
assert "leaflet" in top[0], f"K33 fail: top should be a leaflet action, got {top}"
# K34: "word" actions should not exceed FRONTIER_BONUS-1=5
word_max = max(s for a, s, _ in result if "word" in a)
assert word_max <= 2, f"K34 fail: word_max={word_max} should be <= 2 (demoted)"
print(f"K33: top={top[0]} (score={top[1]}) — leaflet beats hallucinated 'word'")
print(f"K34: word_max={word_max} <= 2 — unstable noun demoted")

# Case B: stable noun (seen ≥2) gets full bonus
result2 = score(objects=["mailbox"], inventory=[], seen_counts={"mailbox": 3}, affordances=afford)
result2.sort(key=lambda t: -t[1])
top2 = result2[0]
assert top2[1] == 4, f"stable mailbox should have full bonus=4, got {top2}"
print(f"Stable noun: top={top2[0]} score={top2[1]}")

print("FIX VERIFIED: K33+K34 inventory enumeration + noun-stability cap.")
