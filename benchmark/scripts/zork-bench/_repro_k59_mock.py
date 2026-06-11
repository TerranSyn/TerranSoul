"""K59 mock repro — bypasses spacy, directly tests the filter logic.

Verifies that 3-letter nouns ('egg') pass the new `len(t) < 3` filter
in `_spacy_nouns`. Independent of whether spacy is installed.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# Patch sys.modules to provide a fake spacy that returns deterministic tokens.
import types

class _FakeTok:
    def __init__(self, text: str, pos: str = "NOUN") -> None:
        self.text = text
        self.pos_ = pos


class _FakeDoc(list):
    pass


class _FakeNlp:
    def __call__(self, text: str) -> _FakeDoc:
        # Tokenise on whitespace, mark every alpha token NOUN.
        out: list[_FakeTok] = []
        for raw in text.split():
            t = raw.strip(".,;:'\"()")
            if t.isalpha():
                out.append(_FakeTok(t, "NOUN"))
            else:
                out.append(_FakeTok(t, "OTHER"))
        return _FakeDoc(out)


fake_spacy = types.ModuleType("spacy")
fake_spacy.load = lambda name: _FakeNlp()  # type: ignore[attr-defined]
sys.modules["spacy"] = fake_spacy

# Now import the bridge — it'll lazy-load fake spacy on first call.
import terransoul_brain_bridge as bridge  # noqa: E402

bridge._SPACY_NLP = None  # force re-load via fake

UP_A_TREE_OBS = (
    "Up a Tree. "
    "You are about 10 feet above the ground nestled among some large branches. "
    "The nearest branch above you is above your reach. "
    "Beside you on the branch is a small bird's nest. "
    "In the bird's nest is a large egg encrusted with "
    "precious jewels, apparently scavenged by a childish songbird."
)

objs = bridge._extract_objects_from_obs(UP_A_TREE_OBS)
print(f"objs = {objs}")
required = ["egg"]
missing = [n for n in required if n not in objs]
assert not missing, f"missing {missing} from {objs}"
print("[PASS] K59 — 'egg' (3-letter) extracted by spacy fallback")
