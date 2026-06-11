"""K28b banner-strip repro."""
from terransoul_brain_bridge import _spacy_nouns, _extract_objects_from_obs as e

ZORK_HEADER = (
    "ZORK I: The Great Underground Empire\n"
    "Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.\n"
    "ZORK is a registered trademark of Infocom, Inc.\n"
    "Revision 88 / Serial number 840726\n\n"
    "West of House\n"
    "You are standing in an open field west of a white house, with a "
    "boarded front door. There is a small mailbox here."
)
FOREST_PATH = (
    "Forest Path\nThis is a path winding through a dimly lit forest. "
    "The path heads north-south here. One particularly large tree with "
    "some low branches stands at the edge of the path."
)
print("zork_header spacy:", _spacy_nouns(ZORK_HEADER))
print("zork_header extract:", e(ZORK_HEADER))
print("forest_path spacy:", _spacy_nouns(FOREST_PATH))
print("forest_path extract:", e(FOREST_PATH))
