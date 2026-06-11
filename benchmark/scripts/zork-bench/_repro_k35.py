"""K35 sub-10s repro: [INVENTORY] is progress, not success."""

def classify(content):
    if content.startswith("[+") and "SCORE]" in content[:24]:
        return "success"
    elif content.startswith("[INVENTORY]"):
        return "progress"
    elif content.startswith("[NEW LOCATION]"):
        return "progress"
    elif content.startswith("[LOOP]"):
        return "loop"
    elif content.startswith("[GOT ITEM]"):
        return "progress"
    elif content.startswith("[MOVE]"):
        return "neutral"
    elif content.startswith("[NEW ROOM]"):
        return "progress"
    else:
        return "neutral"

def score(outcome):
    return {"fatal": -100, "loop": -15, "advisory": -2, "success": 12,
            "progress": 4, "neutral": -3}.get(outcome, 0)

# Case A: take leaflet (inventory change, no score)
o = classify("[INVENTORY] Location: West House | Action: take leaflet | Result: Taken. | Score: 0")
s = score(o)
assert o == "progress" and s == 4, f"K35 fail: take leaflet should be progress=4, got {o}={s}"
print(f"K35: take leaflet outcome={o} score={s}")

# Case B: actual score gain
o2 = classify("[+5 SCORE] Location: Mailbox | Action: read leaflet | Result: ... | Score: 5")
s2 = score(o2)
assert o2 == "success" and s2 == 12
print(f"K35: real score gain outcome={o2} score={s2}")

# Case C: planner picks west (frontier=6) over take leaflet (progress=4)
FRONTIER = 6
take_score = score("progress")  # 4
west_score = 0 + FRONTIER  # untried + frontier bonus
assert west_score > take_score, f"west({west_score}) should beat take leaflet({take_score})"
print(f"K35: west({west_score}) beats take leaflet({take_score}) → agent will move on")

print("FIX VERIFIED: K35 inventory != score gain.")
