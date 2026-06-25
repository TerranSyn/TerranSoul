"""<1s offline repro (P8): drive the REAL zork_agent_patch.py INJECTION (the
frozen brain-pin decision tower) against MOCKED scenarios with NO infra, and
validate the ALREADY-APPLIED P1+P2 yield-gate.

Doctrine (rules/brain-driven-self-improvement.md, bench-agi-purity.md): the
brain must BIAS via score/context, NEVER OVERWRITE the LLM's clean action.
The `_bp_force_yield` block (zork_agent_patch.py around the
`# P1+P2 (doctrine: bias-not-force)` comment) reverts the belief-forcing pins
(force_high_confidence_pin_k33, force_vertical_cardinal_k67, force_take_*_k68/k63,
forced_taught) back to the LLM's own clean command (`_bp_action_raw`), appending
`_yield_llm` to the status. The brain's ranked shortlist still reaches the model
as context — it just no longer clobbers a good command.

This harness loads the genuine INJECTION string, dedents it, and `exec`s it
against a synthetic `brain_shortlist.json` + module namespace. Nothing is
re-implemented; the actual decision code from the patch runs. No game-specific
seed is introduced — scores follow the bridge's generic frontier formula
(untried exit == FRONTIER==6, router/replay promotion >= 8) and nouns are
synthetic.

Cases:
  K67 (v9b Forest-trap): LLM proposes horizontal cardinal `north`; brain top is
      `east` (compass, frontier score 6); an `up` exit exists. K67
      force_vertical_cardinal would rotate to `up`. With the yield-gate the
      served action MUST stay `north` (status ends `_yield_llm`).
  K33 (high-confidence pin): brain top `enter window` score 9 (>= 8) would
      absolute-pin. With the yield-gate the LLM's clean `examine egg` MUST
      survive (status ends `_yield_llm`).

Run:  python benchmark/scripts/zork-bench/_repro_override_yield.py
"""
import contextlib
import io
import json
import pathlib
import shutil
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import zork_agent_patch as zap  # READ-ONLY: we only consume zap.INJECTION

# The injection hard-codes this absolute container path. On Windows it resolves
# against the CWD drive root; we create and clean up the fixture dir.
SHORTLIST = pathlib.Path("/bench/game_files/brain_shortlist.json")
CREATED_BENCH_DIR = not pathlib.Path("/bench").exists()

# The INJECTION lives at a 12-space base indent (nested inside the agent
# method + an outer try). Strip exactly that prefix so it execs at module level.
INDENT = " " * 12
DEDENTED = "\n".join(
    line[len(INDENT):] if line.startswith(INDENT) else line
    for line in zap.INJECTION.split("\n")
)
CODE = compile(DEDENTED, "<real-injection>", "exec")

_seq = 0


def run_decision(llm_action: str, shortlist: dict, mod_state: dict | None = None):
    """Execute the genuine injected decision tower once.

    Returns (served_action, status, stderr). A fresh module namespace is used
    per call so the patch's per-room module-state (_bp_failed_exits etc.) does
    not leak between cases.
    """
    global _seq
    _seq += 1
    SHORTLIST.parent.mkdir(parents=True, exist_ok=True)
    SHORTLIST.write_text(json.dumps(shortlist), encoding="utf-8")
    name = f"_yield_agent_{_seq}"
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    ns = mod.__dict__
    ns["__name__"] = name
    ns["action"] = llm_action
    if mod_state:
        ns.update(mod_state)
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        exec(CODE, ns)
    stderr = err.getvalue()
    if "exception=" in stderr:
        raise RuntimeError(f"injection raised internally: {stderr.strip()}")
    if "[BRAIN-PIN-K49]" not in stderr:
        raise RuntimeError("injection did not reach its decision log — bad harness")
    return ns["action"], ns.get("_bp_status"), stderr.strip()


def main() -> int:
    failures = []

    # ----- Case K67: v9b Forest-trap (horizontal-vs-vertical cardinal) -----
    # LLM picks `north`; brain top `east` at frontier score 6; `up` exit exists.
    # Pre-yield this fired force_vertical_cardinal_k67 (action -> `up`), trapping
    # the actor in the Forest cycle. The yield-gate must keep `north`.
    sl_forest = {
        "room": "forest",
        "forced": "",
        "observation_nouns": ["tree", "path", "branches"],
        "fixed_nouns": [],
        "actions": ["east", "south", "up", "north"],
        "scores": [6, 6, 6, 6],   # all untried exits at FRONTIER == 6
    }
    act, status, _ = run_decision("north", sl_forest)
    print(f"K67 Forest-trap: llm='north' -> action={act!r} status={status}")
    if act != "north":
        failures.append(
            f"K67: brain OVERWROTE the LLM. served={act!r} status={status} "
            f"(expected served 'north'; force_vertical_cardinal_k67 should have "
            f"been reverted by the _bp_force_yield gate)."
        )
    elif not (status or "").endswith("_yield_llm"):
        failures.append(
            f"K67: action survived but status={status!r} does not end in "
            f"'_yield_llm' — the K67 pin did not actually fire/yield, so the "
            f"regression signal is not being exercised."
        )

    # ----- Case K33: high-confidence absolute pin (top_score >= 8) -----
    # Brain top `enter window` score 9 would absolute-pin. The LLM's clean
    # `examine egg` (a visible noun) must survive the yield-gate.
    sl_pin = {
        "room": "behind house",
        "forced": "",
        "observation_nouns": ["egg", "window", "house"],
        "fixed_nouns": [],
        "actions": ["enter window", "down", "east", "examine egg"],
        "scores": [9, 6, 6, 5],   # top promoted to 9 (>= 8 -> K33)
    }
    act2, status2, _ = run_decision("examine egg", sl_pin)
    print(f"K33 high-conf pin: llm='examine egg' -> action={act2!r} status={status2}")
    if act2 != "examine egg":
        failures.append(
            f"K33: brain OVERWROTE the LLM. served={act2!r} status={status2} "
            f"(expected served 'examine egg'; force_high_confidence_pin_k33 "
            f"should have been reverted by the _bp_force_yield gate)."
        )
    elif not (status2 or "").endswith("_yield_llm"):
        failures.append(
            f"K33: action survived but status={status2!r} does not end in "
            f"'_yield_llm' — the K33 pin did not fire/yield, so the regression "
            f"signal is not being exercised."
        )

    if failures:
        print("\nREPRO RED — yield-gate did NOT honor the LLM:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nREPRO GREEN: 2/2 — the P1+P2 _bp_force_yield gate reverts both "
          "force_vertical_cardinal_k67 and force_high_confidence_pin_k33 back "
          "to the LLM's clean action (status *_yield_llm). Bias preserved, "
          "overwrite removed.")
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        if CREATED_BENCH_DIR:
            shutil.rmtree("/bench", ignore_errors=True)
    sys.exit(rc)
