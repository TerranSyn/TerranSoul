"""Sub-10s repro: exit extraction returns [] when obs has no direction tokens.

Bug scenario: agent enters West of House (obs has 'west' token), then on
turn 1 issues `examine mailbox`. The new obs is "Small mailbox. The
mailbox is closed." — NO direction tokens. `_extract_exits_from_obs`
returns [] → planner shortlist contains zero movement options →
agent stuck in object-manipulation loop forever → score 0.

Run: python benchmark/scripts/zork-bench/_repro_exit_cache_bug.py
"""
from __future__ import annotations
import importlib.util as _il
import sys, pathlib

mod_path = pathlib.Path(__file__).with_name("terransoul_brain_bridge.py")
spec = _il.spec_from_file_location("ts_bridge", mod_path)
mod = _il.module_from_spec(spec)
sys.modules["ts_bridge"] = mod
spec.loader.exec_module(mod)

initial_obs = (
    "West of House\n"
    "You are standing in an open field west of a white house, with a boarded\n"
    "front door.\n"
    "There is a small mailbox here.\n"
)
mailbox_obs = "Small mailbox.\nThe mailbox is closed.\n"

exits_initial = mod._extract_exits_from_obs(initial_obs)
exits_mailbox = mod._extract_exits_from_obs(mailbox_obs)
print(f"initial obs exits = {exits_initial}")
print(f"mailbox obs exits = {exits_mailbox}")
assert "west" in exits_initial, "FAIL: should detect 'west' in initial obs"
assert exits_mailbox == [], "FAIL: expected [] from mailbox-only obs"
print("BUG CONFIRMED: mailbox obs returns [] — planner has zero movement options at West House.")
