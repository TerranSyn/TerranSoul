#!/usr/bin/env python3
"""
GENesis-AGI (Claude Code) agentic-retrieval bench over the SAME 240-obs/20-query
corpus + SAME scorer as the embedder-sweep rows.

Faithful agentic shape: per query, spawn ONE `claude -p` session that uses
Grep/Glob/Read tools over a materialized corpus dir (240 tiny .md files, one per
observation) and returns a ranked top-20 list of obs ids. We map those ids back
and score them with embedder_sweep.py's EXACT metric fns (recall/ndcg_at_k/mrr).

Different model (claude-haiku-4-5, cloud) + agentic-retrieval shape -> labeled a
frontier reference, NOT like-for-like with the local nomic/gemma vector rows.

Usage:
  python genesis_retrieval_bench.py materialize
  python genesis_retrieval_bench.py run [--limit N] [--model M]
  python genesis_retrieval_bench.py score
"""
import sys, os, json, time, re, subprocess, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
# Repo root = two levels up from benchmark/results/genesis-agi-retrieval
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURE = os.path.join(ROOT, "the application repository", "benches", "memory_quality_fixture.json")
CORPUS_DIR = os.path.join(HERE, "corpus")
RANKINGS_PATH = os.path.join(HERE, "rankings.json")
RESULT_PATH = os.path.join(ROOT, "benchmark", "results", "external-systems", "genesis_agi.json")

# Import the EXACT scorer fns (do NOT reimplement).
sys.path.insert(0, os.path.join(ROOT, "benchmark", "results", "embedder-sweep"))
from embedder_sweep import recall, ndcg_at_k, mrr, avg, load_corpus  # noqa: E402

MODEL = "claude-haiku-4-5"


def obs_text_lines(o):
    title = o.get("title", "") or ""
    subtitle = o.get("subtitle", "") or ""
    facts = o.get("facts", []) or []
    narrative = o.get("narrative", "") or ""
    lines = [f"# {o['id']}", title, subtitle]
    lines.extend(facts)
    if narrative:
        lines.append(narrative)
    return "\n".join(lines) + "\n"


def materialize():
    with open(FIXTURE, "r", encoding="utf-8") as f:
        d = json.load(f)
    os.makedirs(CORPUS_DIR, exist_ok=True)
    n = 0
    for o in d["observations"]:
        p = os.path.join(CORPUS_DIR, f"{o['id']}.md")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(obs_text_lines(o))
        n += 1
    print(f"materialized {n} obs files -> {CORPUS_DIR}")


PROMPT_TMPL = """You are GENesis-AGI's agent-memory retrieval layer. The current working directory contains a corpus of {n} memory observations, one per file named obs_ses_XXX_YY.md. Each file's first line is `# <obs_id>` followed by its title, subtitle, facts and narrative.

Query: "{query}"

Use the Grep and Glob and Read tools to search the corpus files and find the observations most relevant to the query. Search broadly: try several keyword and concept searches (synonyms, related terms) so you do not miss relevant observations, then read promising files to confirm relevance.

Rank the most relevant observations and return ONLY the top 20, most relevant first. Output your final answer as a single JSON array of exactly 20 obs ids (strings in obs_ses_XXX_YY form), and nothing else. Example: ["obs_ses_005_03","obs_ses_021_00", ...]
"""


def extract_ids(text):
    ids = []
    for m in re.finditer(r"\[[^\[\]]*obs_ses_[^\[\]]*\]", text, re.DOTALL):
        try:
            arr = json.loads(m.group(0))
            if isinstance(arr, list) and all(isinstance(x, str) for x in arr):
                ids = [x.strip() for x in arr if re.fullmatch(r"obs_ses_\d{3}_\d{2}", x.strip())]
                if ids:
                    break
        except Exception:
            continue
    if not ids:
        seen = set()
        for m in re.finditer(r"obs_ses_\d{3}_\d{2}", text):
            v = m.group(0)
            if v not in seen:
                seen.add(v)
                ids.append(v)
    return ids


def run_query(query, model):
    prompt = PROMPT_TMPL.format(n=240, query=query)
    cmd = [
        "claude", "-p", prompt,
        "--model", model,
        "--allowedTools", "Grep", "Read", "Glob",
        "--output-format", "json",
        "--dangerously-skip-permissions",
    ]
    t0 = time.time()
    proc = subprocess.run(
        cmd, cwd=CORPUS_DIR, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=600,
    )
    dt = time.time() - t0
    out = proc.stdout or ""
    result_text = out
    try:
        j = json.loads(out)
        if isinstance(j, dict) and "result" in j:
            result_text = j["result"]
    except Exception:
        pass
    ids = extract_ids(result_text)
    return ids, dt, proc.returncode, (proc.stderr or "")[:500]


def run(limit=None, model=MODEL):
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = load_corpus()
    with open(FIXTURE, "r", encoding="utf-8") as f:
        d = json.load(f)
    queries = d["queries"]
    valid = set(obs_ids)
    rankings = []
    if os.path.exists(RANKINGS_PATH):
        rankings = json.load(open(RANKINGS_PATH, encoding="utf-8"))
    done = {r["query"] for r in rankings}
    todo = [q for q in queries if q["query"] not in done]
    if limit:
        todo = todo[:limit]
    for i, q in enumerate(todo):
        print(f"[{i+1}/{len(todo)}] {q['query']!r} ...", flush=True)
        try:
            ids, dt, rc, err = run_query(q["query"], model)
        except subprocess.TimeoutExpired:
            ids, dt, rc, err = [], 600.0, -1, "timeout"
        seen, clean = set(), []
        for x in ids:
            if x in valid and x not in seen:
                seen.add(x)
                clean.append(x)
            if len(clean) >= 20:
                break
        rankings.append({
            "query": q["query"],
            "relevantObsIds": q["relevantObsIds"],
            "retrieved": clean,
            "raw_id_count": len(ids),
            "latency_s": round(dt, 3),
            "returncode": rc,
            "error": err if rc != 0 else "",
        })
        json.dump(rankings, open(RANKINGS_PATH, "w", encoding="utf-8"), indent=2)
        print(f"    -> {len(clean)} ids, {dt:.1f}s, rc={rc}", flush=True)
    print(f"done; {len(rankings)} total rankings saved")


def score():
    rankings = json.load(open(RANKINGS_PATH, encoding="utf-8"))
    d = json.load(open(FIXTURE, encoding="utf-8"))
    order = {q["query"]: i for i, q in enumerate(d["queries"])}
    rankings.sort(key=lambda r: order.get(r["query"], 999))
    per_query = []
    lats = []
    ran = 0
    for r in rankings:
        retrieved = r["retrieved"]
        rel = set(r["relevantObsIds"])
        errored = r.get("returncode", 0) != 0 or len(retrieved) == 0
        if not errored:
            ran += 1
        if r.get("latency_s"):
            lats.append(r["latency_s"])
        per_query.append({
            "query": r["query"],
            "recall_at_5": recall(retrieved, rel, 5),
            "recall_at_10": recall(retrieved, rel, 10),
            "recall_at_20": recall(retrieved, rel, 20),
            "ndcg_at_10": ndcg_at_k(retrieved, rel, 10),
            "mrr": mrr(retrieved, rel),
            "relevant_count": len(rel),
            "retrieved_count": len(retrieved),
            "latency_s": r.get("latency_s"),
            "errored": errored,
        })
    res = {
        "system": "Claude Code + GENesis-AGI (agentic retrieval, claude-haiku-4-5)",
        "model": MODEL,
        "provider": "Anthropic (cloud)",
        "retrieval_type": "agentic (claude -p Grep/Glob/Read over 240 obs files -> ranked top-20)",
        "source": "claude -p per-query agentic session; ranked obs ids scored by embedder_sweep recall/ndcg_at_k/mrr",
        "parity_note": "DIFFERENT model (claude-haiku-4-5, cloud) + agentic-retrieval shape; frontier reference, NOT like-for-like with local nomic/gemma vector rows; NOT the Qdrant RRF layer.",
        "avg_recall_at_5": avg([p["recall_at_5"] for p in per_query]),
        "avg_recall_at_10": avg([p["recall_at_10"] for p in per_query]),
        "avg_recall_at_20": avg([p["recall_at_20"] for p in per_query]),
        "avg_ndcg_at_10": avg([p["ndcg_at_10"] for p in per_query]),
        "avg_mrr": avg([p["mrr"] for p in per_query]),
        "latency_p50_s": round(statistics.median(lats), 3) if lats else None,
        "n_obs": 240,
        "n_queries": len(per_query),
        "queries_ran_ok": ran,
        "per_query": per_query,
    }
    json.dump(res, open(RESULT_PATH, "w", encoding="utf-8"), indent=2)
    print(json.dumps({k: res[k] for k in (
        "avg_recall_at_5", "avg_recall_at_10", "avg_recall_at_20",
        "avg_ndcg_at_10", "avg_mrr", "latency_p50_s", "n_queries", "queries_ran_ok")}, indent=2))
    print("wrote", RESULT_PATH)
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "materialize":
        materialize()
    elif cmd == "run":
        limit = None
        model = MODEL
        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == "--limit":
                limit = int(sys.argv[i+1]); i += 2
            elif sys.argv[i] == "--model":
                model = sys.argv[i+1]; i += 2
            else:
                i += 1
        run(limit, model)
    elif cmd == "score":
        score()
    else:
        print(__doc__)
        sys.exit(1)
