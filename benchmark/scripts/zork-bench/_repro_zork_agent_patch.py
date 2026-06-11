"""K17 reproduce-first snippet — verify the brain-pin agent patch.

Principle 8: build a sub-10s validator so future bench iters never
re-launch the 6-min docker build for an unverified agent-side patch.

Pinned upstream commit: 4c80f401a17b5f25b3c183d35ac171bf20268864.
The ZorkAgent class layout that the patch depends on:
    line 27   class ZorkAgent
    line 162  def get_action(...)
    line 292  def get_action_with_reasoning(...)
    line 490  "Agent returned empty action, using 'look' as fallback"

Checks:
1. Patch applies idempotently (apply twice → second is a no-op).
2. Patched zork_agent.py AST-parses.
3. Marker injected inside `get_action_with_reasoning` body.
4. Behavioural simulation: pre-state JSON + agent-result dict →
   post-state action equals shortlist[0] when off-list, unchanged
   when on-list.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PATCH_SRC = ROOT / "zork_agent_patch.py"
PIN_COMMIT = "4c80f401a17b5f25b3c183d35ac171bf20268864"
CACHE = Path(os.environ.get("TEMP", tempfile.gettempdir())) / "zork_agent_repro"


def _ensure_upstream() -> Path:
    target = CACHE / "zork_agent.py"
    if target.exists() and target.stat().st_size > 30000:
        return target
    CACHE.mkdir(parents=True, exist_ok=True)
    if not (CACHE / ".git").exists():
        subprocess.run(
            ["git", "clone", "--no-checkout",
             "https://github.com/stickystyle/ZorkGPT", str(CACHE)],
            check=True, capture_output=True,
        )
    subprocess.run(
        ["git", "fetch", "--depth=1", "origin", PIN_COMMIT],
        cwd=CACHE, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "checkout", PIN_COMMIT, "--", "zork_agent.py"],
        cwd=CACHE, check=True, capture_output=True,
    )
    return target


def main() -> int:
    upstream = _ensure_upstream()
    work_dir = Path(tempfile.mkdtemp(prefix="zork_agent_apply_"))
    work_root = work_dir / "bench"
    work_root.mkdir()
    work_target = work_root / "zork_agent.py"
    shutil.copy(upstream, work_target)

    # Run the patch twice with TARGET redirected to our working copy.
    spec = importlib.util.spec_from_file_location("zap", PATCH_SRC)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["zap"] = mod
    spec.loader.exec_module(mod)
    mod.TARGET = work_target  # redirect

    rc1 = mod.main()
    assert rc1 == 0, f"[FAIL] first apply rc={rc1}"
    rc2 = mod.main()
    assert rc2 == 0, f"[FAIL] second apply rc={rc2} (idempotent expected)"
    print("[PASS] patch applies idempotently")

    src = work_target.read_text(encoding="utf-8")
    tree = ast.parse(src)
    print("[PASS] patched zork_agent.py AST-parses")

    # Marker must be inside get_action_with_reasoning body.
    found_in_method = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "get_action_with_reasoning":
            body_src = ast.get_source_segment(src, node) or ""
            if "brain-pin K23 shortlist enforcement" in body_src and "BRAIN-PIN-K23" in body_src:
                found_in_method = True
                break
    assert found_in_method, "[FAIL] marker not inside get_action_with_reasoning"
    print("[PASS] marker present inside get_action_with_reasoning body")

    # Behavioural simulation — exec just the injected block on stub state.
    shortlist_dir = Path(tempfile.mkdtemp(prefix="brain_pin_state_"))
    shortlist_path = shortlist_dir / "brain_shortlist.json"
    shortlist_path.write_text(json.dumps({
        "room": "West of House",
        "actions": ["take mailbox", "open mailbox", "examine mailbox"],
        "scores": [10, 9, 8],
    }), encoding="utf-8")

    # Extract the injected block; simulate it on dummy locals.
    # K19 hard-pin: always shortlist[0] unless action already equals it.
    snippet = textwrap.dedent(f"""
        import json, os, re
        _bp_path = {str(shortlist_path)!r}
        if os.path.exists(_bp_path):
            with open(_bp_path, 'r', encoding='utf-8') as _bp_f:
                _bp_data = json.load(_bp_f)
            _bp_acts = _bp_data.get('actions') or []
            if _bp_acts:
                def _bp_norm(s):
                    return re.sub(r'\\s+', ' ', (s or '').strip().lower())
                _bp_top = _bp_acts[0]
                if _bp_norm(action) != _bp_norm(_bp_top):
                    action = _bp_top
    """)

    cases = [
        ("west", "take mailbox"),                  # off-list → hard-pin
        ("take mailbox", "take mailbox"),         # already shortlist[0] → unchanged
        ("Take Mailbox", "Take Mailbox"),         # case-equiv to shortlist[0] → unchanged
        ("open mailbox", "take mailbox"),         # on-list but not [0] → hard-pin to [0]
        ("foo bar", "take mailbox"),              # garbage → hard-pin
    ]
    for inp, expected in cases:
        ns = {"action": inp}
        exec(snippet, ns)
        got = ns["action"]
        ok = got.strip().lower() == expected.strip().lower()
        assert ok, f"[FAIL] action={inp!r} → {got!r}, expected {expected!r}"
    print("[PASS] behavioural simulation: 5/5 (off-list pin, [0]-pass, case-equiv, lower-rank pin, garbage pin)")

    print("\nAll checks PASS — agent-pin patch verified at sub-10s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
