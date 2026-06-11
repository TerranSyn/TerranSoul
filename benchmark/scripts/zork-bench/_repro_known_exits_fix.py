"""K29 fix repro: known_exits is populated from brain MAP_EDGE memories.

Stubs the MCP client so the planner sees one MAP_EDGE for north.
After fix: 'north' must be in visited_dirs -> NOT get FRONTIER_BONUS.
"""
import os, sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if THIS_DIR not in sys.path:
    sys.path.insert(0, THIS_DIR)

# Minimal stubs to import the bridge module without docker.
class _StubMCP:
    def __init__(self, edges):
        self.edges = edges
    def tool(self, name, args):
        if name == "brain_list_recent" and args.get("tag", "").startswith("loc_"):
            return {"hits": [
                {"content": f"MAP_EDGE from='{src}' via='{d}' to='{dst}'"}
                for (src, d, dst) in self.edges
            ]}
        if name == "brain_search":
            return {"hits": []}
        return {"hits": []}

# Import the module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "ts_bridge", os.path.join(THIS_DIR, "terransoul_brain_bridge.py")
)
mod = importlib.util.module_from_spec(spec)
sys.modules["ts_bridge"] = mod  # required for @dataclass introspection
try:
    spec.loader.exec_module(mod)
except Exception as e:
    print(f"IMPORT_FAIL: {e}")
    sys.exit(1)

# Find the planner class and the bonuses helper
candidates = [c for c in vars(mod).values()
              if isinstance(c, type) and hasattr(c, "brain_suggest_action")]
if not candidates:
    print("FAIL: no class with brain_suggest_action")
    sys.exit(1)
Planner = candidates[0]
print(f"Planner class: {Planner.__name__}")

# Build a minimal instance
p = Planner.__new__(Planner)
p.mcp = _StubMCP(edges=[("Forest Path", "north", "Clearing")])
p.calls = []
p.memory_manager = None
p._current_observation = (
    "Forest Path\nThis is a path winding through a dimly lit forest.\n"
    "There is a tree here. The path leads north and south."
)
p._recent_top_picks = []
# Helper / private attrs used by brain_suggest_action — leave defaulted via class

# Stub the affordance + bonuses helpers to be deterministic
p._get_affordances = lambda: [
    ("examine", 6, "examine: gather info"),
    ("take", 10, "take: try acquire"),
    ("climb", 8, "climb: vertical traversal"),
]
p._get_planner_bonuses = lambda: {"frontier": 10, "visited": 1, "meta": 2}

import io
import contextlib
err = io.StringIO()
try:
    with contextlib.redirect_stderr(err):
        out = p.brain_suggest_action("Forest Path", p._current_observation)
except Exception as e:
    print(f"CALL_FAIL: {type(e).__name__}: {e}")
    sys.exit(1)

stderr_text = err.getvalue()
# Extract PLANNER-DEBUG line
import re
m = re.search(r"\[PLANNER-DEBUG-K23\][^\n]+", stderr_text)
if not m:
    print("FAIL: no PLANNER-DEBUG line")
    print("STDERR:", stderr_text[:1000])
    sys.exit(1)
line = m.group(0)
print(line[:500])

# Find score for 'north' in scored20
m2 = re.search(r"\('north',\s*(-?\d+),", line)
if not m2:
    print("FAIL: 'north' not in scored20")
    sys.exit(1)
north_score = int(m2.group(1))
print(f"north score = {north_score}")

if north_score >= 10:
    print("BUG STILL PRESENT: north got FRONTIER_BONUS even with MAP_EDGE.")
    sys.exit(2)
else:
    print(f"FIX VERIFIED: north score < frontier ({north_score}); visited.")
