"""K28 spacy fallback repro — runs inside docker zork-bench image."""
from terransoul_brain_bridge import _extract_objects_from_obs as e, _spacy_nouns

cases = [
    (
        "forest_path",
        "This is a path winding through a dimly lit forest. The path "
        "heads north-south here. One particularly large tree with some "
        "low branches stands at the edge of the path.",
    ),
    (
        "north_house",
        "You are facing the north side of a white house. There is no "
        "door here, and all the windows are barred.",
    ),
    (
        "mailbox_leaflet",
        "West of House You are standing in an open field. There is a "
        "small mailbox here. The small mailbox contains: A leaflet",
    ),
    (
        "kitchen",
        "You are in the kitchen of the white house. A table seems to "
        "have been used recently for the preparation of food. A passage "
        "leads to the west and a dark staircase can be seen leading "
        "upward. A dark chimney leads down and to the east is a small "
        "window which is open.",
    ),
]
for label, obs in cases:
    print(f"{label}: extract={e(obs)} spacy={_spacy_nouns(obs)}")
