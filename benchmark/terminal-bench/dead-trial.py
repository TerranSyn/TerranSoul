#!/usr/bin/env python3
"""Is a trial a CORPSE — a trial that never ran — rather than a failed attempt?

⛔ WHY THIS EXISTS. Measured 2026-08-09: the OAuth credential was revoked
mid-session and the next TWENTY trials each produced `steps: 2`,
`total_completion_tokens: 0`, `total_cost_usd: 0.0` and a trajectory reading
"API Error: 401 OAuth access token has been revoked" — while harbor wrote an
ordinary trial and the verifier scored it 0 of 2. Nothing in the batch driver
distinguished *the agent could not authenticate* from *the agent tried and
failed*, so it spent its whole budget on corpses and roughly ninety minutes of
conclusions were drawn over them and had to be withdrawn.

Zero completion tokens is the reliable tell: a genuine attempt that scores 0
still emits thousands. Sampled 12 real trajectories across the cohort — every
one carries `final_metrics.total_completion_tokens`, live values ranged
3,224..81,713, and the only zeros in 510 trial dirs were the 20 known corpses.

WHY A MODULE AND NOT A HEREDOC. This predicate started life inline in
`iterate-until-change.sh`, where it could not be tested without running a real
trial (~30 min, real money). A guard whose whole job is preventing a repeat of
a costly incident is exactly the thing that must be pinned by a cheap test. It
also now has a second caller, and `attempt_feedback_text`'s `reached_bench_material`
already sets the precedent of sharing one implementation with `integrity-scan.py`
rather than restating it — "a second copy would drift, and the two disagreeing is
how a contaminated trial gets scored as clean".

CLI:  python dead-trial.py <trajectory.json>
      exit 0 = DEAD (abort the batch), exit 1 = live or undecidable.
"""

import json
import sys

__all__ = ["is_dead_trial", "dead_trial_reason"]


def dead_trial_reason(path):
    """Return a short reason string if the trial never ran, else None.

    FAILS OPEN on anything it cannot read. An unparseable or missing trajectory
    is *undecidable*, not dead — and the cost asymmetry is stark in that
    direction: wrongly continuing costs one more trial, wrongly aborting strands
    a sweep that a human then has to notice and restart. The 2026-08-09 incident
    produced perfectly well-formed JSON, so fail-open loses nothing against the
    failure this was built for.
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict):
        return None

    metrics = doc.get("final_metrics")
    # Distinguish "reported zero" from "did not report". Every real trajectory
    # carries final_metrics; treating a MISSING block as zero would abort on a
    # schema change rather than on a dead credential.
    if isinstance(metrics, dict) and "total_completion_tokens" in metrics:
        tokens = metrics.get("total_completion_tokens") or 0
        if tokens == 0:
            return "0 completion tokens — the agent produced no work"

    blob = json.dumps(doc)
    if "401" in blob and "revoked" in blob.lower():
        return "trajectory reports a revoked credential (401)"
    return None


def is_dead_trial(path):
    """True when the trial never ran. See :func:`dead_trial_reason`."""
    return dead_trial_reason(path) is not None


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[-2], file=sys.stderr)
        raise SystemExit(2)
    reason = dead_trial_reason(sys.argv[1])
    if reason:
        print(reason)
        raise SystemExit(0)
    raise SystemExit(1)
