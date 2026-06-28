#!/usr/bin/env python3
"""
ARC-AGI-2 solver harness (standard ARC-AGI protocol).

Two arms:
  1. local   = gemma4:12b-it-qat via Ollama OpenAI-compat (/v1), $0
               (TerranSoul local actor)
  2. claude  = local Claude CLI: `claude -p "<prompt>" --model <model>`

Scoring: exact match of the full predicted grid vs ground truth.
  - pass@1: first attempt correct
  - pass@2: either of 2 attempts correct
  - If a task has >1 test input, ALL test outputs must be correct (ARC convention).

Robust parsing: strip prose/code fences; extract the grid of digits.
If unparseable -> counted WRONG (never correct).

Usage:
  python arc_harness.py --arm local  --data <dir> --out <dir> [--limit N] [--tasks f1,f2]
  python arc_harness.py --arm claude --data <dir> --out <dir> --model claude-haiku-4-5 --tasks-file sample.txt
"""
import argparse, glob, json, os, re, subprocess, sys, time, urllib.request

OLLAMA_URL = "http://127.0.0.1:11434/v1/chat/completions"          # OpenAI-compat (per task spec)
OLLAMA_NATIVE_URL = "http://127.0.0.1:11434/api/chat"              # native (lets us set think=False)
OLLAMA_MODEL = "gemma4:12b-it-qat"

# ----------------------------- grid formatting -----------------------------

def grid_to_text(g):
    return "\n".join("".join(str(c) for c in row) for row in g)

def build_prompt(task):
    """Standard ARC text prompt: render train pairs, then test input."""
    parts = []
    parts.append(
        "You are solving an ARC-AGI puzzle. Each grid is a rectangle of digits 0-9 "
        "(each digit is a color). You are given input/output example pairs. Infer the "
        "single transformation rule that maps every input to its output, then apply it "
        "to the final test input.\n"
    )
    for i, ex in enumerate(task["train"], 1):
        parts.append(f"Example {i} INPUT:\n{grid_to_text(ex['input'])}\n")
        parts.append(f"Example {i} OUTPUT:\n{grid_to_text(ex['output'])}\n")
    parts.append(f"TEST INPUT:\n{grid_to_text(task['_test_input'])}\n")
    parts.append(
        "Now output ONLY the predicted TEST OUTPUT grid. Rules for your answer:\n"
        "- Output nothing but the grid.\n"
        "- One row per line, each row is a string of digits 0-9 with no spaces or separators.\n"
        "- No explanation, no labels, no code fences, no extra text.\n"
        "Predicted TEST OUTPUT grid:"
    )
    return "\n".join(parts)

# ----------------------------- robust parsing ------------------------------

def parse_grid(text):
    """Extract a digit grid from model output. Returns list[list[int]] or None."""
    if not text:
        return None
    t = text.strip()
    # remove code fences
    t = re.sub(r"```[a-zA-Z0-9_]*", "", t).replace("```", "")
    lines = t.splitlines()

    # Strategy A: lines that are purely digits (optionally space/comma separated).
    # Collect maximal contiguous block of grid-like lines; prefer the LAST block
    # (models often restate the answer at the end).
    blocks = []
    cur = []
    for raw in lines:
        s = raw.strip()
        # Strip common row decorations: leading "Row N:", surrounding brackets/quotes/backticks,
        # and trailing commas so "[1, 2, 3]," and "`110`" still parse.
        s = re.sub(r"^\s*row\s*\d+\s*[:\-]\s*", "", s, flags=re.IGNORECASE)
        s = s.strip("`'\"[]() \t,")
        # A grid row is digits 0-9 optionally separated by spaces/commas.
        # Two formats: contiguous "110023" -> per-character cells; or
        # separated "1 1 0 0" / "1,1,0,0" -> per-token cells.
        cells = None
        if s and re.fullmatch(r"[0-9](?:[\s,]*[0-9])*", s):
            if re.fullmatch(r"[0-9]+", s):
                # contiguous run of digits -> each character is a cell (ARC default)
                cells = [int(c) for c in s]
            else:
                toks = [x for x in re.split(r"[\s,]+", s) if x != ""]
                if all(re.fullmatch(r"[0-9]", x) for x in toks) and len(toks) >= 1:
                    cells = [int(x) for x in toks]
        if cells is not None:
            cur.append(cells)
        else:
            if cur:
                blocks.append(cur)
                cur = []
    if cur:
        blocks.append(cur)

    if not blocks:
        return None
    # choose the block that forms a rectangle; prefer last such block, else last block trimmed
    candidates = []
    for b in blocks:
        widths = {len(r) for r in b}
        if len(widths) == 1 and len(b) >= 1:
            candidates.append(b)
    chosen = None
    if candidates:
        chosen = candidates[-1]
    else:
        # take last block, force-rectangle by majority width
        b = blocks[-1]
        from collections import Counter
        w = Counter(len(r) for r in b).most_common(1)[0][0]
        b = [r for r in b if len(r) == w]
        chosen = b if b else None
    return chosen

def grids_equal(a, b):
    if a is None or b is None:
        return False
    if len(a) != len(b):
        return False
    for ra, rb in zip(a, b):
        if len(ra) != len(rb) or any(x != y for x, y in zip(ra, rb)):
            return False
    return True

# ----------------------------- model callers -------------------------------

# gemma4:12b-it-qat is a *thinking* model. With thinking enabled it never stops
# reasoning to emit an answer — on every ARC task it exhausts the entire token
# budget inside the chain-of-thought and returns empty `content` (verified: even
# the smallest 10x10 task hit `done_reason: length` at 15,430 thinking tokens with
# content len 0 after 259s). The OpenAI-compat /v1 endpoint cannot disable thinking,
# so we call the same Ollama server's native /api/chat with `"think": false` to force
# a direct, parseable grid answer (14s, clean grid). Same model, same server, same
# host:port the task specifies — only the thinking toggle differs. We still let the
# model write reasoning in the visible answer if it chooses; we parse the final grid.

def call_ollama(prompt, temperature):
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": False,            # critical: this model loops forever with thinking on
        "options": {
            "temperature": temperature,
            "num_predict": 4096,
        },
    }).encode()
    req = urllib.request.Request(OLLAMA_NATIVE_URL, data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.loads(r.read().decode())
    msg = d.get("message", {})
    content = msg.get("content") or ""
    if not content.strip():
        content = msg.get("thinking") or ""
    usage = {
        "prompt_tokens": d.get("prompt_eval_count", 0),
        "completion_tokens": d.get("eval_count", 0),
    }
    return content, usage

def call_claude(prompt, model):
    # Non-interactive print mode with JSON output so we capture real per-call cost.
    # temperature isn't exposed via CLI; attempt variety comes from the caller's
    # nudge appended to attempt 2.
    # --strict-mcp-config + --setting-sources "" strip per-invocation agent overhead
    # (MCP server startup, project CLAUDE.md/skills/plugins loading). Without them a
    # single call took 5+ minutes of pure overhead in this environment; with them the
    # only cost is the model's own reasoning. Keeps the reference a clean model call.
    p = subprocess.run(
        ["claude", "-p", prompt, "--model", model,
         "--strict-mcp-config", "--setting-sources", "",
         "--output-format", "json"],
        capture_output=True, text=True, timeout=900,
    )
    out_raw = p.stdout or ""
    text, usage = out_raw, {}
    try:
        j = json.loads(out_raw)
        text = j.get("result") or ""
        usage = {
            "cost_usd": j.get("total_cost_usd", 0.0),
            "duration_ms": j.get("duration_ms", 0),
            "usage": j.get("usage", {}),
        }
    except Exception:
        if p.returncode != 0 and not out_raw.strip():
            text = p.stderr or ""
    return text, usage

# ----------------------------- main loop -----------------------------------

def solve_task(task_id, task, arm, model, n_attempts=2):
    """Return dict with per-test predictions and correctness for pass@1/pass@2."""
    tests = task["test"]
    # For each test input we make n_attempts; task counts solved at attempt k if
    # ALL test inputs are correct using attempt index k.
    attempts_correct = [True] * n_attempts  # attempts_correct[k] = all tests solved at attempt k
    per_test = []
    raw_log = []
    usage_tot = {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}

    for ti, test in enumerate(tests):
        gt = test["output"]
        t_task = {"train": task["train"], "_test_input": test["input"]}
        base_prompt = build_prompt(t_task)
        test_rec = {"test_index": ti, "gt_dims": [len(gt), len(gt[0])], "attempts": []}
        for k in range(n_attempts):
            if arm == "local":
                temp = 0.0 if k == 0 else 0.6
                prompt = base_prompt
                content, usage = call_ollama(prompt, temp)
                usage_tot["prompt_tokens"] += usage.get("prompt_tokens", 0)
                usage_tot["completion_tokens"] += usage.get("completion_tokens", 0)
            else:
                # claude CLI: vary attempt 2 slightly to get a distinct second try
                prompt = base_prompt if k == 0 else (
                    base_prompt + "\n\n(Reconsider carefully and give your best single answer.)")
                content, usage = call_claude(prompt, model)
                usage_tot["cost_usd"] += usage.get("cost_usd", 0.0)
            pred = parse_grid(content)
            ok = grids_equal(pred, gt)
            if not ok:
                attempts_correct[k] = False
            test_rec["attempts"].append({
                "attempt": k,
                "correct": ok,
                "pred_dims": ([len(pred), len(pred[0])] if pred else None),
                "parsed": pred is not None,
            })
            raw_log.append({"test_index": ti, "attempt": k,
                            "raw_tail": content[-400:] if content else ""})
        per_test.append(test_rec)

    pass1 = attempts_correct[0]
    pass2 = any(attempts_correct[:2])
    return {
        "task_id": task_id,
        "n_tests": len(tests),
        "pass1": pass1,
        "pass2": pass2,
        "per_test": per_test,
        "usage": usage_tot,
    }, raw_log

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", choices=["local", "claude"], required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tasks", default="")          # comma list of task ids
    ap.add_argument("--tasks-file", default="")     # file w/ one task id per line
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.data, "*.json")))
    id_to_file = {os.path.splitext(os.path.basename(f))[0]: f for f in files}

    if args.tasks_file:
        ids = [l.strip() for l in open(args.tasks_file) if l.strip()]
    elif args.tasks:
        ids = [x.strip() for x in args.tasks.split(",") if x.strip()]
    else:
        ids = sorted(id_to_file.keys())
    if args.limit:
        ids = ids[:args.limit]

    os.makedirs(args.out, exist_ok=True)
    tag = args.arm if args.arm == "local" else f"claude_{args.model}"
    results_path = os.path.join(args.out, f"results_{tag}.jsonl")
    raw_path = os.path.join(args.out, f"raw_{tag}.jsonl")

    # resume support: skip already-done task ids
    done = set()
    if os.path.exists(results_path):
        for line in open(results_path):
            try:
                done.add(json.loads(line)["task_id"])
            except Exception:
                pass

    n_solved1 = n_solved2 = n = 0
    # recount from existing
    existing = []
    if os.path.exists(results_path):
        for line in open(results_path):
            try:
                existing.append(json.loads(line))
            except Exception:
                pass
    cost_tot = 0.0
    for r in existing:
        n += 1
        n_solved1 += 1 if r["pass1"] else 0
        n_solved2 += 1 if r["pass2"] else 0
        cost_tot += (r.get("usage") or {}).get("cost_usd", 0.0)

    rf = open(results_path, "a")
    rawf = open(raw_path, "a")
    t0 = time.time()
    for i, tid in enumerate(ids):
        if tid in done:
            continue
        task = json.load(open(id_to_file[tid]))
        try:
            rec, raw = solve_task(tid, task, args.arm, args.model)
        except Exception as e:
            rec = {"task_id": tid, "n_tests": len(task["test"]), "pass1": False,
                   "pass2": False, "error": str(e), "per_test": [], "usage": {}}
            raw = [{"error": str(e)}]
        rf.write(json.dumps(rec) + "\n"); rf.flush()
        for rr in raw:
            rr["task_id"] = tid
            rawf.write(json.dumps(rr) + "\n")
        rawf.flush()
        n += 1
        n_solved1 += 1 if rec["pass1"] else 0
        n_solved2 += 1 if rec["pass2"] else 0
        cost_tot += (rec.get("usage") or {}).get("cost_usd", 0.0)
        el = time.time() - t0
        print(f"[{tag}] {n}/{len(ids)} {tid} "
              f"pass1={rec['pass1']} pass2={rec['pass2']} "
              f"| running p1={n_solved1}/{n} p2={n_solved2}/{n} "
              f"| cost=${cost_tot:.2f} | {el:.0f}s", flush=True)

    rf.close(); rawf.close()
    summary = {
        "arm": args.arm,
        "model": OLLAMA_MODEL if args.arm == "local" else args.model,
        "n_tasks": n,
        "n_solved_pass1": n_solved1,
        "n_solved_pass2": n_solved2,
        "pass1": round(n_solved1 / n, 4) if n else 0.0,
        "pass2": round(n_solved2 / n, 4) if n else 0.0,
        "cost_usd": round(cost_tot, 4),
    }
    print("SUMMARY:", json.dumps(summary))
    with open(os.path.join(args.out, f"summary_{tag}.json"), "w") as f:
        json.dump(summary, f, indent=2)

if __name__ == "__main__":
    main()
