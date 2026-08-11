#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scientific-loop.py -- does the bench actually run
    hypothesise -> experiment -> evaluate -> improve -> repeat ?

    usage: python scientific-loop.py <jobs-dir> [--cohort-file <path>] [--json <out>]

WHY THIS SCRIPT LOOKS THE WAY IT DOES
-------------------------------------
Three earlier designs for this measurement were built and then killed by an
adversarial critic who reproduced them against the raw artifacts. Their
post-mortems are load-bearing here, because this script is defined as much by
what it REFUSES to compute as by what it computes:

  KILLED 1 -- "verification-anchored cycle audit": paired shell commands by a
    hand-rolled `kernel()` (split on ';' and '&&') and scored outcomes with
    tool_result.is_error. 15.0% of kernels were syntactically impossible heads
    (`done`, `46,70p'`), only 2.6% of matched pairs were byte-identical, and
    is_error had ~16% recall / ~50% precision against actual failure text.
    ==> THIS SCRIPT DOES NO COMMAND MATCHING AND USES is_error FOR NOTHING.

  KILLED 2 -- "anchored prediction-outcome pairing": treated an assistant text
    block preceding a tool_use as a prediction. Measured: 89.7% of anchors sit
    in the RETROSPECTIVE clause of a "report the last result, then announce the
    next action" block. 13 positives in 251 trials, 1 survived hand-checking.
    ==> THIS SCRIPT NEVER INFERS A PREDICTION FROM STREAM POSITION.

  KILLED 3 -- "cue-regex over agent prose": the treatment instruction contains
    the literal strings the detector counts ("confirmed" x1, "refut*" x3,
    "ruled out" x2, "I expect" x1, "predict" x2, "discriminate" x2).
    ==> THIS SCRIPT STILL COUNTS THOSE CUES, BUT PRINTS THEM IN A SECTION
        LABELLED "PRIMED -- NOT EVIDENCE", NEXT TO THEIR COUNT IN THE PROMPT
        THAT PRODUCED THEM. A vocabulary delta is reported as contamination,
        never as a finding.

What is left is the part of the loop that leaves a MACHINE-CHECKABLE trace
outside the model's own prose: writes to the memory server (which return
integer memory ids and version counts), retrievals of those same integer ids by
later trials, and the paired attempt-1-vs-attempt-k structure that harbor
already produces because n_attempts > 1 runs sequentially against one brain.

Everything else -- hypothesis, evaluation, refutation -- lives in extended
thinking, and extended thinking is redacted in these artifacts. Section 1
measures the redaction rather than asserting it.

Every printed number carries its n. Section 9 states what cannot be concluded.
"""

import argparse
import glob
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

# --- Windows console guard. Same intent as the guard at the top of
# --- attempt-uplift.sh (`export PYTHONIOENCODING=utf-8 PYTHONUTF8=1`), but a
# --- shell export cannot help a process that is already running, so do it here
# --- too. All emitted text is ASCII anyway; this only protects against a
# --- transcript fragment leaking into an error message.
for _stream in ("stdout", "stderr"):
    try:
        getattr(sys, _stream).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

Z_ALPHA_2 = 1.959963985  # two-sided 0.05
Z_POWER = 0.841621234    # 80%

# The marker that separates the two instruction texts. Verified: the string
# "hypothes" appears 0 times in the old extra-instruction and in every task
# statement checked, and appears in the new one only inside the section header
# "## How to work: hypothesise -> experiment -> evaluate -> improve -> repeat".
COHORT_MARKER = "hypothes"

# Cue strings that the NEW instruction hands the agent verbatim. Counted only
# to be reported as contamination (section 8).
PRIMED_CUES = [
    "hypothes", "confirm", "refut", "ruled out",
    "i expect", "predict", "discriminat",
]

BRAIN_WRITE = ("brain_ingest_lesson", "brain_append")
BRAIN_READ = ("brain_search", "brain_get_entry", "brain_kg_neighbors")


# ----------------------------------------------------------------- utilities
def wilson(k, n, z=Z_ALPHA_2):
    """Wilson score interval; returns (lo, hi) or None when n == 0."""
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


def pct(k, n):
    if n == 0:
        return "n/a (n=0)"
    ci = wilson(k, n)
    return "%5.1f%% (%d/%d, 95%% CI %.1f-%.1f)" % (
        100.0 * k / n, k, n, 100.0 * ci[0], 100.0 * ci[1])


def median(xs):
    s = sorted(xs)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def quartiles(xs):
    s = sorted(xs)
    if not s:
        return None
    def q(f):
        i = f * (len(s) - 1)
        lo, hi = int(math.floor(i)), int(math.ceil(i))
        return s[lo] + (s[hi] - s[lo]) * (i - lo)
    return q(0.25), q(0.5), q(0.75)


def dist_line(name, xs, unit=""):
    if not xs:
        return "    %-34s n=0  UNAVAILABLE" % name
    q = quartiles(xs)
    return ("    %-34s n=%-4d min=%-8.4g p25=%-8.4g med=%-8.4g p75=%-8.4g max=%-8.4g%s"
            % (name, len(xs), min(xs), q[0], q[1], q[2], max(xs), (" " + unit) if unit else ""))


def sign_test(n_plus, n_minus):
    """Exact two-sided sign test. Ties must already be dropped."""
    n = n_plus + n_minus
    if n == 0:
        return None
    k = min(n_plus, n_minus)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / (2.0 ** n)
    return min(1.0, 2.0 * tail)


def mde_two_prop(p0, n_ctrl, n_treat):
    """Smallest p1 > p0 detectable at alpha=.05 two-sided, 80% power.
    Normal approximation. Returns absolute pp difference, or None."""
    if n_ctrl <= 0 or n_treat <= 0:
        return None
    best = None
    p = p0
    while p < 1.0:
        p += 0.001
        pbar = (p0 * n_ctrl + p * n_treat) / (n_ctrl + n_treat)
        se0 = math.sqrt(pbar * (1 - pbar) * (1.0 / n_ctrl + 1.0 / n_treat))
        se1 = math.sqrt(p0 * (1 - p0) / n_ctrl + p * (1 - p) / n_treat)
        if se1 == 0:
            continue
        if abs(p - p0) >= Z_ALPHA_2 * se0 + Z_POWER * se1:
            best = p - p0
            break
    return best


def iso_to_epoch(s):
    if not s:
        return None
    t = s.replace("Z", "+00:00")
    try:
        import datetime
        return datetime.datetime.fromisoformat(t).timestamp()
    except Exception:
        return None


def norm_task(name):
    """result.json says 'terminal-bench/bn-fit-modify'; the directory name says
    'bn-fit-modify'. Without this they become two different tasks and every
    matched cell and attempt group silently splits."""
    if not name:
        return None
    return name.split("/")[-1]


def jload(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return json.load(fh)
    except Exception:
        return None


def text_of(content):
    """tool_result / message content -> flat text, whatever shape it arrived in."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    out = []
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict):
                if isinstance(b.get("text"), str):
                    out.append(b["text"])
                elif b.get("content") is not None:
                    out.append(text_of(b["content"]))
            elif isinstance(b, str):
                out.append(b)
    elif isinstance(content, dict):
        return text_of(content.get("content"))
    return "\n".join(out)


# ------------------------------------------------------------------ scanning
def scan_prompt(trial_dir):
    """Cohort + wall-clock budget, read from the prompt the agent actually got.
    This is per-TRIAL ground truth and does not depend on the temp instruction
    snapshots (2 of 9 are already deleted from %TEMP%)."""
    out = {"cohort": None, "budget_min": None, "prompt_chars": None,
           "instr_cues": None}
    files = glob.glob(os.path.join(trial_dir, "agent", "sessions", "projects", "*", "*.jsonl"))
    if not files:
        return out
    prompt = None
    try:
        with open(files[0], encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") != "user":
                    continue
                s = text_of((o.get("message") or {}).get("content"))
                if "Your time budget" in s:
                    prompt = s
                    break
    except Exception:
        return out
    if prompt is None:
        return out
    i = prompt.find("Your time budget")
    instr = prompt[i:]
    out["prompt_chars"] = len(prompt)
    out["cohort"] = "NEW" if COHORT_MARKER in instr.lower() else "OLD"
    m = re.search(r"(\d+)\s*\*{0,2}\s*minutes", instr)
    if m:
        out["budget_min"] = int(m.group(1))
    low = instr.lower()
    out["instr_cues"] = {c: low.count(c) for c in PRIMED_CUES}
    return out


def scan_transcript(path):
    """One pass over agent/claude-code.txt.

    Tolerant of the live sweep: a truncated final line, a half-flushed record
    or an unparseable fragment is counted and skipped, never raised."""
    r = {
        "lines": 0, "bad_lines": 0,
        "tool_calls": Counter(),
        "n_tool_calls": 0,
        "thinking_blocks": 0, "thinking_nonempty": 0,
        "thinking_tokens": 0, "thinking_token_events": 0,
        "assistant_text_blocks": 0, "assistant_text_chars": 0,
        "agent_cues": Counter(),
        "writes": [],          # dicts: kind, memory_id, version_count, chars
        "read_ids": [],        # memory ids returned by any brain read
        "has_result_event": False,
        "num_turns": None,
    }
    ids = {}
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except Exception:
        return None
    with fh:
        for line in fh:
            r["lines"] += 1
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                r["bad_lines"] += 1
                continue
            if not isinstance(o, dict):
                r["bad_lines"] += 1
                continue
            t = o.get("type")
            if t == "system" and o.get("subtype") == "thinking_tokens":
                r["thinking_token_events"] += 1
                d = o.get("estimated_tokens_delta")
                if isinstance(d, (int, float)):
                    r["thinking_tokens"] += d
            elif t == "assistant":
                for b in (o.get("message") or {}).get("content", []) or []:
                    if not isinstance(b, dict):
                        continue
                    bt = b.get("type")
                    if bt == "thinking":
                        r["thinking_blocks"] += 1
                        if (b.get("thinking") or "").strip():
                            r["thinking_nonempty"] += 1
                    elif bt == "text":
                        s = b.get("text") or ""
                        r["assistant_text_blocks"] += 1
                        r["assistant_text_chars"] += len(s)
                        low = s.lower()
                        for c in PRIMED_CUES:
                            n = low.count(c)
                            if n:
                                r["agent_cues"][c] += n
                    elif bt == "tool_use":
                        name = b.get("name") or "?"
                        short = name.split("__")[-1]
                        ids[b.get("id")] = short
                        r["tool_calls"][short] += 1
                        r["n_tool_calls"] += 1
                        if short in BRAIN_WRITE:
                            inp = b.get("input") or {}
                            body = ""
                            for k in ("content", "addition", "text"):
                                if isinstance(inp.get(k), str):
                                    body = inp[k]
                                    break
                            low = body.lower()
                            for c in PRIMED_CUES:
                                n = low.count(c)
                                if n:
                                    r["agent_cues"][c] += n
                            r["writes"].append({
                                "kind": short,
                                "target_id": inp.get("id") if isinstance(inp.get("id"), int) else None,
                                "memory_id": None,
                                "version_count": None,
                                "chars": len(body),
                                "tool_use_id": b.get("id"),
                            })
            elif t == "user":
                c = (o.get("message") or {}).get("content")
                if not isinstance(c, list):
                    continue
                for b in c:
                    if not isinstance(b, dict) or b.get("type") != "tool_result":
                        continue
                    name = ids.get(b.get("tool_use_id"))
                    if not name:
                        continue
                    body = text_of(b.get("content"))
                    if name in BRAIN_WRITE:
                        mid = re.search(r'"memory_id"\s*:\s*(\d+)', body)
                        vc = re.search(r'"version_count"\s*:\s*(\d+)', body)
                        for w in r["writes"]:
                            if w["tool_use_id"] == b.get("tool_use_id"):
                                if mid:
                                    w["memory_id"] = int(mid.group(1))
                                if vc:
                                    w["version_count"] = int(vc.group(1))
                    elif name in BRAIN_READ:
                        for m in re.finditer(r'"id"\s*:\s*(\d+)', body):
                            r["read_ids"].append(int(m.group(1)))
            elif t == "result":
                r["has_result_event"] = True
                if isinstance(o.get("num_turns"), int):
                    r["num_turns"] = o["num_turns"]
    return r


def load_trials(jobs_dir, cohort_jobs):
    trials = []
    job_meta = {}
    for cj in glob.glob(os.path.join(jobs_dir, "*", "config.json")):
        c = jload(cj)
        if not c:
            continue
        ags = c.get("agents") or [{}]
        job_meta[os.path.basename(os.path.dirname(cj))] = {
            "model": ags[0].get("model_name"),
            "n_attempts": c.get("n_attempts"),
        }
    for tdir in sorted(glob.glob(os.path.join(jobs_dir, "*", "*__*"))):
        if not os.path.isdir(tdir):
            continue
        job = os.path.basename(os.path.dirname(tdir))
        tr = {
            "dir": tdir, "job": job, "name": os.path.basename(tdir),
            "task": None, "reward": None, "model": None,
            "start": None, "agent_sec": None, "out_tokens": None,
            "exception": None, "transcript": None,
        }
        rj = jload(os.path.join(tdir, "result.json"))
        if rj:
            tr["task"] = norm_task(rj.get("task_name"))
            vr = rj.get("verifier_result") or {}
            rew = (vr.get("rewards") or {}).get("reward")
            tr["reward"] = rew
            tr["model"] = (((rj.get("config") or {}).get("agent")) or {}).get("model_name")
            ae = rj.get("agent_execution") or {}
            tr["start"] = iso_to_epoch(ae.get("started_at"))
            fin = iso_to_epoch(ae.get("finished_at"))
            if tr["start"] and fin:
                tr["agent_sec"] = fin - tr["start"]
            ar = rj.get("agent_result") or {}
            tr["out_tokens"] = ar.get("n_output_tokens")
            tr["exception"] = rj.get("exception_info")
        if tr["task"] is None:
            tr["task"] = norm_task(tr["name"].rsplit("__", 1)[0])
        if tr["model"] is None:
            tr["model"] = (job_meta.get(job) or {}).get("model")
        tr["n_attempts_cfg"] = (job_meta.get(job) or {}).get("n_attempts")
        if tr["reward"] is None:
            rp = os.path.join(tdir, "verifier", "reward.txt")
            if os.path.exists(rp):
                try:
                    with open(rp, encoding="utf-8", errors="replace") as fh:
                        tr["reward"] = float(fh.read().strip())
                except Exception:
                    pass
        tr.update(scan_prompt(tdir))
        tp = os.path.join(tdir, "agent", "claude-code.txt")
        if os.path.exists(tp):
            tr["transcript"] = scan_transcript(tp)
        # cohort resolution: per-trial prompt is ground truth; the cohort file
        # is a job-level fallback for trials whose session log never got written.
        tr["cohort_file"] = ("OLD" if job in cohort_jobs else
                             ("NEW" if cohort_jobs else None))
        if tr.get("cohort") is None:
            tr["cohort"] = tr["cohort_file"]
            tr["cohort_src"] = "cohort-file" if tr["cohort"] else "unknown"
        else:
            tr["cohort_src"] = "prompt"
        trials.append(tr)
    return trials


# ------------------------------------------------------------------ sections
def sec(title):
    print("")
    print("=" * 78)
    print(title)
    print("=" * 78)


def section0(trials, jobs_dir, cohort_jobs, cohort_path):
    sec("SECTION 0  CORPUS CENSUS  (dir: %s)" % jobs_dir)
    jobs = sorted(set(t["job"] for t in trials))
    print("  job dirs                          %d" % len(jobs))
    print("  trial dirs                        %d" % len(trials))
    have = [t for t in trials if t["transcript"]]
    print("  with agent/claude-code.txt        %d  (%d have none -- in-flight or crashed pre-agent)"
          % (len(have), len(trials) - len(have)))
    bad = sum(t["transcript"]["bad_lines"] for t in have)
    lines = sum(t["transcript"]["lines"] for t in have)
    print("  transcript lines / unparseable    %d / %d  (%.4f%% -- live sweep is writing these)"
          % (lines, bad, 100.0 * bad / lines if lines else 0.0))
    scored = [t for t in trials if t["reward"] is not None]
    print("  with a reward (complete)          %d" % len(scored))
    print("  in flight / no reward             %d   <-- EXCLUDED from every outcome number below"
          % (len(trials) - len(scored)))
    na = Counter(t.get("n_attempts_cfg") for t in trials)
    print("  n_attempts configured             %s" % dict(na))
    import datetime as _dt
    print("  SNAPSHOT read at                  %s" % _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("                                     ^ if the sweep is live, this directory grows while")
    print("                                       the script runs. Two runs minutes apart will not")
    print("                                       agree, and that is the data moving, not a bug.")
    models = Counter(t["model"] for t in trials if t["model"])
    print("  model(s)                          %s" % dict(models))
    tasks = Counter(t["task"] for t in trials)
    print("  distinct tasks                    %d" % len(tasks))
    print("  trials per task                   med=%s  max=%s   <-- PSEUDOREPLICATION: the"
          % (median(list(tasks.values())), max(tasks.values()) if tasks else 0))
    print("                                     effective independent n is the TASK count,")
    print("                                     not the trial count, and all trials share ONE brain.")
    if cohort_path:
        missing = [j for j in cohort_jobs if j not in set(jobs)]
        print("  cohort file                       %s (%d job dirs listed, %d not present here)"
              % (cohort_path, len(cohort_jobs), len(missing)))
    else:
        print("  cohort file                       NOT GIVEN -- cohort taken from each trial's own prompt only")
    src = Counter(t["cohort_src"] for t in trials)
    print("  cohort resolved from              %s" % dict(src))
    dis = [t for t in trials if t["cohort_src"] == "prompt" and t["cohort_file"]
           and t["cohort"] != t["cohort_file"]]
    print("  cohort-file vs prompt disagreements %d %s"
          % (len(dis), "" if not dis else "<-- INTEGRITY FAILURE, investigate before reading on"))
    for t in dis[:5]:
        print("      %s  file=%s prompt=%s" % (t["name"], t["cohort_file"], t["cohort"]))


def cohort_split(trials):
    g = defaultdict(list)
    for t in trials:
        g[t["cohort"] or "UNKNOWN"].append(t)
    return g


def section1(trials):
    sec("SECTION 1  ARTIFACT CEILING -- what the transcripts physically do not contain")
    have = [t for t in trials if t["transcript"]]
    tb = sum(t["transcript"]["thinking_blocks"] for t in have)
    ne = sum(t["transcript"]["thinking_nonempty"] for t in have)
    print("  thinking blocks in corpus         %d" % tb)
    print("  with non-empty text               %d  (%.1f%%)"
          % (ne, 100.0 * ne / tb if tb else 0.0))
    print("  -> Extended thinking is REDACTED. Steps 1 (hypothesis) and 3 (evaluate) of the")
    print("     owner's loop happen there. No instrument in this file can read them.")
    tt = [t["transcript"]["thinking_tokens"] for t in have if t["transcript"]["thinking_token_events"]]
    print("")
    print("  What IS recorded is the VOLUME of that hidden reasoning, via")
    print("  system/thinking_tokens.estimated_tokens_delta:")
    print(dist_line("hidden thinking tokens / trial", tt))
    per = []
    for t in have:
        x = t["transcript"]
        if x["n_tool_calls"] and x["thinking_token_events"]:
            per.append(x["thinking_tokens"] / x["n_tool_calls"])
    print(dist_line("hidden thinking tok / tool call", per))
    print("  NOTE: volume is not content. A trial with 20k hidden tokens may have run twenty")
    print("        cycles or one long ramble. This number bounds nothing about the loop.")


def section2(trials):
    sec("SECTION 2  COHORTS -- reported SEPARATELY, never pooled or averaged")
    g = cohort_split(trials)
    for name in ("OLD", "NEW", "UNKNOWN"):
        ts = g.get(name)
        if not ts:
            continue
        scored = [t for t in ts if t["reward"] is not None]
        tasks = sorted(set(t["task"] for t in ts))
        buds = Counter(t["budget_min"] for t in ts)
        print("")
        print("  COHORT %s  (%s instruction)" % (name, "pre-loop" if name == "OLD" else "loop-guidance" if name == "NEW" else "?"))
        print("    trials                          %d   (scored %d, in-flight %d)"
              % (len(ts), len(scored), len(ts) - len(scored)))
        print("    distinct tasks                  %d   %s" % (len(tasks), tasks if len(tasks) <= 8 else ""))
        print("    jobs                            %d" % len(set(t["job"] for t in ts)))
        print("    wall-clock budget (minutes)     %s" % ", ".join(
            "%s:%d" % ("unknown" if k is None else k, v)
            for k, v in sorted(buds.items(), key=lambda kv: (kv[0] is None, kv[0]))))
        if len([b for b in buds if b is not None]) > 1:
            print("      ^ THIS ARM IS NOT ONE CONDITION. Budget varies inside it, and budget is the")
            print("        direct determinant of trial length. Cohort comparisons are licensed only")
            print("        inside the matched cells in section 3.")
        if scored:
            k = sum(1 for t in scored if (t["reward"] or 0) >= 1.0)
            print("    reward == 1.0                   %s" % pct(k, len(scored)))
            if k == len(scored):
                print("      ^ AT CEILING. An improvement in this arm is arithmetically undetectable.")


def section3(trials):
    sec("SECTION 3  MATCHED-CELL INVENTORY AND POWER -- the only licensed A/B")
    cells = defaultdict(lambda: defaultdict(list))
    for t in trials:
        if t["cohort"] not in ("OLD", "NEW"):
            continue
        cells[(t["model"], t["task"], t["budget_min"])][t["cohort"]].append(t)
    def n_scored(xs):
        return sum(1 for t in xs if t["reward"] is not None)
    matched = {k: v for k, v in cells.items()
               if n_scored(v.get("OLD", [])) and n_scored(v.get("NEW", []))}
    print("  cells (model x task x budget)     %d" % len(cells))
    print("  cells with SCORED trials in BOTH cohorts  %d" % len(matched))
    if not matched:
        print("")
        print("  UNAVAILABLE: no (model, task, budget) cell is present in both cohorts in this")
        print("  directory, so NO cohort contrast can be computed here without also changing")
        print("  the task and/or the time budget. Not estimated, not proxied -- absent.")
        return
    print("")
    print("  %-34s %-8s %-18s %-18s" % ("cell (task @ budget-min)", "model", "OLD n / pass", "NEW n / pass"))
    n_ctrl_tot = n_treat_tot = 0
    for (model, task, bud), arms in sorted(matched.items(), key=lambda kv: str(kv[0])):
        o, n = arms["OLD"], arms["NEW"]
        os_ = [t for t in o if t["reward"] is not None]
        ns_ = [t for t in n if t["reward"] is not None]
        n_ctrl_tot += len(os_)
        n_treat_tot += len(ns_)
        print("  %-34s %-8s %-18s %-18s" % (
            "%s @ %s" % (task.split("/")[-1], bud),
            (model or "?").replace("claude-", ""),
            "%d / %d" % (len(os_), sum(1 for t in os_ if (t["reward"] or 0) >= 1)),
            "%d / %d" % (len(ns_), sum(1 for t in ns_ if (t["reward"] or 0) >= 1))))
    print("")
    print("  matched scored trials             OLD n=%d   NEW n=%d" % (n_ctrl_tot, n_treat_tot))
    for p0 in (0.5, 0.8):
        m = mde_two_prop(p0, n_ctrl_tot, n_treat_tot)
        label = "a %d%% baseline rate" % int(p0 * 100)
        print("  MDE at alpha=.05 / power=.80 vs %-22s %s"
              % (label, ("+%.1f pp" % (100 * m)) if m else "NOT REACHABLE at any effect size"))
    print("  ^ Read that as the honest verdict on this contrast, not as a target.")


def section4(trials):
    sec("SECTION 4  SIGNAL W -- memory-WRITE behaviour  [DIRECT: tool calls, not prose]")
    print("  Step 4 of the loop ('improve ... write it to memory now') is the only step that")
    print("  leaves a receipt: a brain_ingest_lesson / brain_append tool call whose result")
    print("  carries an integer memory_id. Presence of the call is structural. What the")
    print("  lesson SAYS is agent prose and is not scored here.")
    g = cohort_split(trials)
    for name in ("OLD", "NEW"):
        ts = [t for t in g.get(name, []) if t["transcript"]]
        if not ts:
            continue
        print("")
        print("  COHORT %s   trials with transcript n=%d" % (name, len(ts)))
        nw = [len(t["transcript"]["writes"]) for t in ts]
        print(dist_line("brain writes per trial", nw))
        any_w = sum(1 for t in ts if t["transcript"]["writes"])
        print("    trials writing >=1              %s" % pct(any_w, len(ts)))
        ing = sum(t["transcript"]["tool_calls"].get("brain_ingest_lesson", 0) for t in ts)
        app = sum(t["transcript"]["tool_calls"].get("brain_append", 0) for t in ts)
        srch = sum(t["transcript"]["tool_calls"].get("brain_search", 0) for t in ts)
        print("    ingest_lesson / append / search  %d / %d / %d  (calls, n=%d trials)"
              % (ing, app, srch, len(ts)))
        chars = [w["chars"] for t in ts for w in t["transcript"]["writes"] if w["chars"]]
        print(dist_line("write payload chars", chars))
        vcs = [w["version_count"] for t in ts for w in t["transcript"]["writes"]
               if w["version_count"] is not None]
        print(dist_line("version_count after append", vcs))
        if vcs:
            print("      ^ an entry on version k has been revised k-1 times across runs. The artifact")
            print("        CANNOT say whether a revision corrected the entry or merely re-confirmed it;")
            print("        distinguishing those requires reading the prose, which section 8 disqualifies.")
        # write-on-failure: the behaviour the instruction explicitly targets
        sc = [t for t in ts if t["reward"] is not None]
        fails = [t for t in sc if (t["reward"] or 0) < 1.0]
        passes = [t for t in sc if (t["reward"] or 0) >= 1.0]
        print("    write rate | FAILED trials      %s" % pct(
            sum(1 for t in fails if t["transcript"]["writes"]), len(fails)))
        print("    write rate | PASSED trials      %s" % pct(
            sum(1 for t in passes if t["transcript"]["writes"]), len(passes)))
        if not fails:
            print("      ^ UNAVAILABLE as a contrast in this cohort: zero failed trials on disk.")


def section5(trials):
    sec("SECTION 5  SIGNAL P -- memory PROPAGATION  [DIRECT: integer id matching]")
    print("  A lesson written in trial A is 'used' only if a LATER trial's brain read returns")
    print("  that same integer memory id. No text similarity, no keywords, no model prose:")
    print("  the id is minted by the memory server and echoed back by the retriever.")
    writes = []   # (mid, start, task, cohort, trial)
    reads = defaultdict(list)
    for t in trials:
        x = t["transcript"]
        if not x or t["start"] is None:
            continue
        for w in x["writes"]:
            mid = w["memory_id"] or w["target_id"]
            if mid:
                writes.append((mid, t["start"], t["task"], t["cohort"], t["name"]))
        for mid in set(x["read_ids"]):
            reads[mid].append((t["start"], t["task"], t["cohort"], t["name"]))
    skipped = sum(1 for t in trials if t["transcript"] and t["start"] is None)
    print("")
    print("  writes with a resolved memory id  %d   (trials skipped for missing start time: %d)"
          % (len(writes), skipped))
    print("  distinct ids returned by reads    %d" % len(reads))
    if not writes:
        print("  UNAVAILABLE: no write in this directory returned a memory id.")
        return
    prop = same = cross = 0
    lags = []
    order = sorted(set(t["start"] for t in trials if t["start"] is not None))
    for mid, st, task, coh, nm in writes:
        hits = [h for h in reads.get(mid, []) if h[0] > st]
        if not hits:
            continue
        prop += 1
        if any(h[1] == task for h in hits):
            same += 1
        if any(h[1] != task for h in hits):
            cross += 1
        first = min(h[0] for h in hits)
        lags.append(sum(1 for s in order if st < s <= first))
    print("  writes later retrieved            %s" % pct(prop, len(writes)))
    print("    ... by a trial of the SAME task %s" % pct(same, len(writes)))
    print("    ... by a trial of a DIFFERENT task %s" % pct(cross, len(writes)))
    print(dist_line("trials elapsed before first reuse", lags))
    # inheritance seen from the reader's side
    reader = [t for t in trials if t["transcript"] and t["start"] is not None
              and t["transcript"]["tool_calls"].get("brain_search")]
    written_by_time = sorted((w[1], w[0]) for w in writes)
    inh = 0
    for t in reader:
        prior = set(mid for (s, mid) in written_by_time if s < t["start"])
        if prior & set(t["transcript"]["read_ids"]):
            inh += 1
    print("  searching trials that received >=1 id written earlier IN THIS CORPUS")
    print("                                    %s" % pct(inh, len(reader)))
    print("  NOTE: an id written BEFORE this corpus began (a pre-seeded brain entry, or a")
    print("        lesson from an earlier campaign) is invisible to this count. Every")
    print("        propagation number here is a LOWER BOUND on reuse, not a usefulness rate.")


def report_attempt_contrast(groups):
    """attempt 1 vs attempts 2..k over a dict of ordered attempt lists."""
    a1 = [v[0] for v in groups.values()]
    ak = [t for v in groups.values() for t in v[1:]]

    def rate(xs):
        s = [t for t in xs if t["reward"] is not None]
        return sum(1 for t in s if (t["reward"] or 0) >= 1.0), len(s)

    k1, n1 = rate(a1)
    kk, nk = rate(ak)
    print("      pass rate attempt 1           %s" % pct(k1, n1))
    print("      pass rate attempts 2..k       %s" % pct(kk, nk))
    plus = minus = tie = 0
    for v in groups.values():
        f = v[0]
        rest = [t for t in v[1:] if t["reward"] is not None]
        if f["reward"] is None or not rest:
            continue
        later = sum(1 for t in rest if (t["reward"] or 0) >= 1.0) / len(rest)
        first = 1.0 if (f["reward"] or 0) >= 1.0 else 0.0
        if later > first:
            plus += 1
        elif later < first:
            minus += 1
        else:
            tie += 1
    p = sign_test(plus, minus)
    print("      paired sign test over groups  later>first=%d, later<first=%d, tied=%d  ->  %s"
          % (plus, minus, tie,
             ("p=%.4f" % p) if p is not None else "UNAVAILABLE (0 informative groups)"))
    if tie and not (plus or minus):
        print("        ^ every group is tied; at a ceiling pass rate this test cannot move.")
    print(dist_line("  attempt 1  tool calls",
                    [t["transcript"]["n_tool_calls"] for t in a1 if t["transcript"]]))
    print(dist_line("  attempts 2..k  tool calls",
                    [t["transcript"]["n_tool_calls"] for t in ak if t["transcript"]]))
    print(dist_line("  attempt 1  agent seconds",
                    [t["agent_sec"] for t in a1 if t["agent_sec"]]))
    print(dist_line("  attempts 2..k  agent seconds",
                    [t["agent_sec"] for t in ak if t["agent_sec"]]))
    print(dist_line("  attempt 1  hidden think tokens",
                    [t["transcript"]["thinking_tokens"] for t in a1
                     if t["transcript"] and t["transcript"]["thinking_token_events"]]))
    print(dist_line("  attempts 2..k  hidden think tok",
                    [t["transcript"]["thinking_tokens"] for t in ak
                     if t["transcript"] and t["transcript"]["thinking_token_events"]]))
    mech_n = mech_k = 0
    for v in groups.values():
        for i, t in enumerate(v):
            if i == 0 or not t["transcript"]:
                continue
            earlier = set()
            for prev in v[:i]:
                if prev["transcript"]:
                    for w in prev["transcript"]["writes"]:
                        mid = w["memory_id"] or w["target_id"]
                        if mid:
                            earlier.add(mid)
            if not earlier:
                continue
            mech_n += 1
            if earlier & set(t["transcript"]["read_ids"]):
                mech_k += 1
    print("      MECHANISM: later attempts that had an earlier same-task id available")
    print("                 AND actually retrieved it  %s" % pct(mech_k, mech_n))
    if mech_n == 0:
        print("                 UNAVAILABLE: no earlier attempt in any group produced an id.")


def section6(trials):
    sec("SECTION 6  SIGNAL R -- CROSS-ATTEMPT REPEAT  [the paired design; strongest available]")
    print("  harbor runs n_attempts of the same task SEQUENTIALLY against ONE brain. Attempt 1")
    print("  cannot read a lesson about this task that does not exist yet; attempts 2..k can.")
    print("  Model, task, budget, dataset and harness are held fixed within a group, so this")
    print("  contrast is immune to the budget and task-identity confounds in section 3.")
    print("  It measures step 5 (repeat) ACROSS RUNS. It does not measure steps 1-3.")
    # corpus-wide first appearance of each task, and corpus-wide write timeline,
    # so the control leg can be checked for contamination instead of assumed clean.
    first_seen = {}
    for t in trials:
        if t["start"] is None:
            continue
        if t["task"] not in first_seen or t["start"] < first_seen[t["task"]]:
            first_seen[t["task"]] = t["start"]
    writes_time = []
    for t in trials:
        x = t["transcript"]
        if not x or t["start"] is None:
            continue
        for w in x["writes"]:
            mid = w["memory_id"] or w["target_id"]
            if mid:
                writes_time.append((t["start"], mid))
    writes_time.sort()

    g = cohort_split(trials)
    for name in ("OLD", "NEW"):
        ts = [t for t in g.get(name, []) if t["start"] is not None]
        if not ts:
            continue
        groups = defaultdict(list)
        for t in ts:
            groups[(t["job"], t["task"])].append(t)
        for k in groups:
            groups[k].sort(key=lambda t: t["start"])
        sizes = [len(v) for v in groups.values()]
        multi = {k: v for k, v in groups.items() if len(v) > 1}
        print("")
        print("  COHORT %s   attempt-groups (job x task) n=%d, of which >1 attempt n=%d"
              % (name, len(groups), len(multi)))
        print(dist_line("attempts per group", sizes))
        if not multi:
            print("    UNAVAILABLE: no group has 2+ ordered attempts yet.")
            continue
        # --- data quality: trials that never ran
        dead = [t for t in ts if t["transcript"] and t["transcript"]["n_tool_calls"] == 0]
        print("    trials with ZERO tool calls     %s  (harness/agent aborts; they are kept in"
              % pct(len(dead), len([t for t in ts if t["transcript"]])))
        print("                                     the distributions below and pull the minima to 0)")
        # --- control contamination: is attempt 1 really lesson-free?
        clean = {k: v for k, v in multi.items()
                 if abs(v[0]["start"] - first_seen.get(k[1], -1)) < 1e-6}
        print("    groups whose attempt 1 is the CORPUS-FIRST run of that task")
        print("                                    %s" % pct(len(clean), len(multi)))
        print("      ^ only in those groups is attempt 1 a genuine no-lesson control. In the")
        print("        rest, an earlier job already ran the task and wrote to the same brain.")
        a1_all = [v[0] for v in multi.values()]
        cont = tot = 0
        for t in a1_all:
            if not t["transcript"]:
                continue
            prior = set(mid for (s, mid) in writes_time if s < t["start"])
            if not prior:
                continue
            tot += 1
            if prior & set(t["transcript"]["read_ids"]):
                cont += 1
        print("    attempt-1 trials that retrieved an id written EARLIER in this corpus")
        print("                                    %s  <-- CONTROL LEAKAGE" % pct(cont, tot))
        for label, subset in (("ALL GROUPS", multi), ("UNCONTAMINATED GROUPS ONLY", clean)):
            print("")
            print("    --- %s  (groups n=%d) ---" % (label, len(subset)))
            if not subset:
                print("        UNAVAILABLE: no group in this stratum.")
                continue
            report_attempt_contrast(subset)


def section7(trials):
    sec("SECTION 7  EFFORT PROFILE, reported per cohort and per budget stratum")
    print("  Stratified because budget varies inside a cohort (section 2). Pooled effort")
    print("  numbers across budgets are not printed, deliberately.")
    g = cohort_split(trials)
    for name in ("OLD", "NEW"):
        ts = [t for t in g.get(name, []) if t["transcript"]]
        if not ts:
            continue
        print("")
        print("  COHORT %s" % name)
        by = defaultdict(list)
        for t in ts:
            by[t["budget_min"]].append(t)
        for bud in sorted(by, key=lambda b: (b is None, b)):
            v = by[bud]
            tasks = sorted(set(x["task"].split("/")[-1] for x in v))
            print("    budget=%s min   trials n=%d  tasks=%d %s"
                  % (bud, len(v), len(tasks), tasks if len(tasks) <= 4 else ""))
            print(dist_line("      tool calls", [x["transcript"]["n_tool_calls"] for x in v]))
            print(dist_line("      Bash calls",
                            [x["transcript"]["tool_calls"].get("Bash", 0) for x in v]))
            print(dist_line("      agent seconds", [x["agent_sec"] for x in v if x["agent_sec"]]))
            print(dist_line("      assistant text chars",
                            [x["transcript"]["assistant_text_chars"] for x in v]))


def section8(trials):
    sec("SECTION 8  PRIMED INSTRUMENTS -- REPORTED, NOT EVIDENCE")
    print("  The NEW instruction contains the exact words a cue detector would count. Any")
    print("  vocabulary shift between cohorts is therefore expected on priming alone and")
    print("  cannot separate 'reasoned differently' from 'repeated the prompt's words'.")
    print("  The counts are printed so that nobody has to rediscover this.")
    g = cohort_split(trials)
    print("")
    print("  cue occurrences IN THE INSTRUCTION the agent received (one representative trial/cohort):")
    hdr = "  %-8s" % "cohort" + "".join("%-12s" % c[:11] for c in PRIMED_CUES)
    print(hdr)
    for name in ("OLD", "NEW"):
        rep = None
        for t in g.get(name, []):
            if t.get("instr_cues"):
                rep = t
                break
        if not rep:
            print("  %-8s (no prompt captured)" % name)
            continue
        print("  %-8s" % name + "".join("%-12d" % rep["instr_cues"].get(c, 0) for c in PRIMED_CUES))
    print("")
    print("  cue occurrences in AGENT-AUTHORED text (assistant text + memory-write payloads),")
    print("  MEAN per trial:")
    print(hdr)
    for name in ("OLD", "NEW"):
        ts = [t for t in g.get(name, []) if t["transcript"]]
        if not ts:
            continue
        cells = []
        for c in PRIMED_CUES:
            tot = sum(t["transcript"]["agent_cues"].get(c, 0) for t in ts)
            cells.append("%-12s" % ("%.2f" % (tot / float(len(ts)))))
        print("  %-8s" % name + "".join(cells))
    for name in ("OLD", "NEW"):
        ts = [t for t in g.get(name, []) if t["transcript"]]
        if ts:
            print("    (%s: n=%d trials with a transcript)" % (name, len(ts)))
    print("")
    print("  DO NOT PUBLISH A DELTA FROM THIS TABLE AS A LOOP RESULT.")


def section9(trials):
    sec("SECTION 9  WHAT THIS MEASUREMENT CANNOT ESTABLISH")
    have = [t for t in trials if t["transcript"]]
    tb = sum(t["transcript"]["thinking_blocks"] for t in have)
    ne = sum(t["transcript"]["thinking_nonempty"] for t in have)
    g = cohort_split(trials)
    n_old = len(g.get("OLD", []))
    n_new = len(g.get("NEW", []))
    tasks_old = len(set(t["task"] for t in g.get("OLD", [])))
    tasks_new = len(set(t["task"] for t in g.get("NEW", [])))
    print("""
  1. IT CANNOT SEE A HYPOTHESIS OR AN EVALUATION. %d of %d thinking blocks carry text.
     Steps 1 and 3 of 'hypothesise -> experiment -> evaluate -> improve -> repeat' occur
     in redacted extended thinking. Nothing in this file observes them, and no number
     printed above should be described as measuring them.

  2. IT CANNOT ATTRIBUTE ANYTHING TO THE INSTRUCTION. The instruction change is
     confounded with task identity (OLD covers %d tasks, NEW covers %d in this dir) and
     with the wall-clock budget, which varies WITHIN a single arm. Section 3 restricts
     the contrast to matched cells and prints the MDE; where that MDE is unreachable,
     the correct report is 'not determinable', not a point estimate. A directory with
     zero NEW trials supports no instruction claim at all.

  3. IT CANNOT USE THE AGENT'S OWN WORDS. The new instruction supplies 'confirmed',
     'refuted', 'ruled out', 'I expect', 'predict' and 'discriminate' verbatim, so a
     cue-frequency delta is a priming artefact by construction (section 8).

  4. IT CANNOT TELL A CORRECTION FROM A RE-CONFIRMATION. version_count rises whether
     an append fixed the entry or merely recorded that it worked a fifth time. Telling
     those apart needs the prose, which point 3 disqualifies.

  5. IT CANNOT TREAT TRIALS AS INDEPENDENT. All trials share one brain and one
     time-ordered stream; %d OLD / %d NEW trials collapse to far fewer independent
     units. Every CI above is computed over trials and is therefore OPTIMISTIC.

  6. IT CANNOT MEASURE 'ONE CHANGE AT A TIME' OR 'A DISCRIMINATING EXPERIMENT'. Both
     require knowing what the agent expected before it acted. Earlier attempts to infer
     that from command structure and from pre-tool narration were built, tested against
     the raw artifacts, and failed: 89.7%% of pre-tool 'predictions' were retrospective
     reports of a result already in hand. Those approaches are deliberately absent.

  7. WHAT IT CAN ESTABLISH is narrower and mechanical: how often the system writes to
     memory, how often a written id comes back to a later run, and whether a second
     attempt at the same task behaves differently from the first. That is step 4 and
     step 5 with a receipt. Steps 1-3 remain unobserved in this corpus.
""" % (ne, tb, tasks_old, tasks_new, n_old, n_new))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("jobs_dir")
    ap.add_argument("--cohort-file", default=None,
                    help="file listing job dirs that ran under the OLD instruction")
    ap.add_argument("--json", default=None, help="also dump the per-trial table as JSON")
    a = ap.parse_args()

    if not os.path.isdir(a.jobs_dir):
        print("no such directory: %s" % a.jobs_dir)
        return 2

    cohort_jobs = set()
    if a.cohort_file:
        if not os.path.exists(a.cohort_file):
            print("cohort file not found: %s" % a.cohort_file)
            return 2
        with open(a.cohort_file, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    cohort_jobs.add(os.path.basename(line.rstrip("/\\")))

    trials = load_trials(a.jobs_dir, cohort_jobs)
    if not trials:
        print("no trial directories (<job>/<task>__<suffix>) under %s" % a.jobs_dir)
        return 1

    print("scientific-loop.py  --  loop-behaviour audit over harbor trial artifacts")
    print("cohorts are NEVER pooled; every number carries its n; section 9 lists the limits")

    section0(trials, a.jobs_dir, cohort_jobs, a.cohort_file)
    section1(trials)
    section2(trials)
    section3(trials)
    section4(trials)
    section5(trials)
    section6(trials)
    section7(trials)
    section8(trials)
    section9(trials)

    if a.json:
        rows = []
        for t in trials:
            x = t["transcript"]
            rows.append({
                "job": t["job"], "trial": t["name"], "task": t["task"],
                "cohort": t["cohort"], "cohort_src": t["cohort_src"],
                "budget_min": t["budget_min"], "model": t["model"],
                "reward": t["reward"], "start": t["start"],
                "agent_sec": t["agent_sec"],
                "tool_calls": x["n_tool_calls"] if x else None,
                "thinking_tokens": x["thinking_tokens"] if x else None,
                "writes": [{k: w[k] for k in ("kind", "memory_id", "target_id",
                                              "version_count", "chars")}
                           for w in x["writes"]] if x else None,
                "read_ids": sorted(set(x["read_ids"])) if x else None,
                "bad_lines": x["bad_lines"] if x else None,
            })
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1)
        print("\nper-trial table written to %s (n=%d)" % (a.json, len(rows)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
