#!/usr/bin/env python3
"""Real retrieval bench of **Graphify** (Graphify-Labs) on the agentmemory
240-doc / 20-query fixture — same corpus, same fixture loader, same metric
functions as bench_mem0.py / the GraphRAG bench (see
../rag_graphrag_bench.json), so the number sits honestly in the same table.

Graphify is designed for codebases (deterministic tree-sitter AST parsing);
this fixture is prose "observations", not code, so we exercise Graphify's
*doc* path (semantic LLM extraction over Markdown files) via its native
Ollama backend (same local model family TerranSoul itself runs), not its
--code-only AST path. Each observation is written as its own obs_<id>.md
file so Graphify's file-level `src=` citations map straight back to obs ids.

Retrieval = `graphify query "<question>"` (default BFS traversal over
graph.json); the NODE lines' `src=<file>` fields, deduped in first-seen
(BFS) order, are the ranked candidate list — this is the closest analogue to
GraphRAG's local-search "ranked sources" this session could construct from
Graphify's actual CLI surface.

Usage:
  python bench_graphify.py --smoke     # 2-doc synthetic reproduce-first check
  python bench_graphify.py             # full 240-doc / 20-query run
"""
import sys, os, json, time, argparse, re, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

CORPUS_DIR = os.path.join(HERE, ".graphify_corpus")
MODEL = "gemma4:12b-it-qat"  # only gemma4 family resident on this host (no e2b tag pulled)
NODE_RE = re.compile(r"^NODE .* \[src=([^\s\]]+)")


def run_graphify(args, cwd=None, timeout=None):
    cmd = [sys.executable, "-m", "graphify"] + args
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return r


def build_corpus(obs_ids, obs_texts):
    if os.path.isdir(CORPUS_DIR):
        shutil.rmtree(CORPUS_DIR, ignore_errors=True)
    os.makedirs(CORPUS_DIR, exist_ok=True)
    for oid, text in zip(obs_ids, obs_texts):
        # Fixture ids already carry an "obs_" prefix (e.g. "obs_ses_000_00") —
        # use the id verbatim as the filename so src=<file> maps back 1:1.
        with open(os.path.join(CORPUS_DIR, f"{oid}.md"), "w", encoding="utf-8") as f:
            f.write(text)


def obs_id_from_src(src):
    base = os.path.basename(src)
    if base.endswith(".md"):
        return base[:-len(".md")]
    return None


def ranked_obs_ids(query_text, graph_path, budget=8000):
    r = run_graphify(
        ["query", query_text, "--graph", graph_path, "--budget", str(budget)],
        timeout=60,
    )
    out, err = r.stdout, r.stderr
    ranked, seen = [], set()
    for line in out.splitlines():
        m = NODE_RE.match(line.strip())
        if not m:
            continue
        oid = obs_id_from_src(m.group(1))
        if oid and oid not in seen:
            seen.add(oid)
            ranked.append(oid)
    return ranked, out, err


def smoke():
    print("[smoke] building 2-doc corpus ...", flush=True)
    build_corpus(["DOC_A", "DOC_B"], [
        "Sarah is planning a trip to Paris in June. She wants to visit the Eiffel Tower and the Louvre museum.",
        "Photosynthesis converts light into chemical energy in plants using chlorophyll.",
    ])
    r = run_graphify(
        ["extract", CORPUS_DIR, "--backend", "ollama", "--model", MODEL, "--max-concurrency", "1", "--api-timeout", "120"],
        timeout=180,
    )
    print(r.stdout, r.stderr)
    assert r.returncode == 0, f"extract failed: {r.returncode}"
    graph_path = os.path.join(CORPUS_DIR, "graphify-out", "graph.json")
    ranked, out, err = ranked_obs_ids("Who is planning a trip to Paris?", graph_path)
    print("[smoke] ranked obs ids:", ranked)
    print("[smoke] raw query output:\n", out)
    assert ranked and ranked[0] == "DOC_A", f"expected DOC_A first, got {ranked}"
    print("[smoke] OK — top result is the relevant doc.")


def full():
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)
    build_corpus(obs_ids, obs_texts)

    t0 = time.time()
    r = run_graphify(
        ["extract", CORPUS_DIR, "--backend", "ollama", "--model", MODEL,
         "--max-concurrency", "1", "--api-timeout", "300", "--no-cluster"],
        timeout=1800,
    )
    index_s = time.time() - t0
    print("=== extract stdout ===\n", r.stdout)
    print("=== extract stderr ===\n", r.stderr)
    if r.returncode != 0:
        raise SystemExit(f"graphify extract failed with code {r.returncode}")

    graph_path = os.path.join(CORPUS_DIR, "graphify-out", "graph.json")
    with open(graph_path, "r", encoding="utf-8") as f:
        graph = json.load(f)
    n_nodes = len(graph.get("nodes", []))
    n_edges = len(graph.get("edges", []))
    print(f"graph.json: {n_nodes} nodes, {n_edges} edges (indexed in {index_s:.1f}s)")

    per_query = []
    query_log_lines = []
    for qi in range(n_q):
        qt = q_texts[qi]
        t1 = time.time()
        ranked, out, err = ranked_obs_ids(qt, graph_path)
        elapsed = time.time() - t1
        rel = q_rel[qi]
        r5, r10, r20 = es.recall(ranked, rel, 5), es.recall(ranked, rel, 10), es.recall(ranked, rel, 20)
        per_query.append({
            "query": qt,
            "recall_at_5": r5, "recall_at_10": r10, "recall_at_20": r20,
            "ndcg_at_10": es.ndcg_at_k(ranked, rel, 10),
            "mrr": es.mrr(ranked, rel),
            "relevant_count": len(rel),
            "retrieved_count": len(ranked),
            "elapsed_s": round(elapsed, 2),
        })
        short_q = qt[:40].replace("\n", " ")
        query_log_lines.append(f"Q{qi:02d} {short_q!r} n_ret={len(ranked)} r5={r5:.3f} r10={r10:.3f} r20={r20:.3f} ({elapsed:.1f}s)")
        print(query_log_lines[-1], flush=True)

    out_json = {
        "framework": "Graphify (Graphify-Labs)",
        "method": f"doc semantic extraction via ollama/{MODEL} (BFS traversal query, default budget=8000)",
        "backend_model": MODEL,
        "observations": n_obs,
        "queries": n_q,
        "graph_nodes": n_nodes,
        "graph_edges": n_edges,
        "index_seconds": round(index_s, 1),
        "recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "mrr": es.avg([q["mrr"] for q in per_query]),
        "via": (
            f"graphify (PyPI graphifyy) `extract <dir> --backend ollama --model {MODEL} "
            "--max-concurrency 1 --no-cluster` over the 240 observations written as one "
            "obs_<id>.md file each (doc semantic-LLM path, NOT --code-only — this fixture "
            "is prose, not source code). Retrieval = `graphify query \"<question>\"` "
            "(default BFS traversal, budget=8000); NODE lines' src=<file> fields, deduped "
            "in first-seen BFS order, are the ranked candidate list. "
            "recall@k = |relevantObsIds ∩ top-k| / |relevantObsIds| averaged over 20 queries "
            "(empty relevant => 1.0)."
        ),
        "per_query": per_query,
        "evidence": " | ".join(query_log_lines),
    }
    op = os.path.join(os.path.dirname(HERE), "rag_graphify_bench.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out_json, f, indent=2)
    print("\n=== RESULT: Graphify (doc semantic path, ollama/" + MODEL + ") ===")
    print(f"R@5 ={out_json['recall_at_5']:.4f}")
    print(f"R@10={out_json['recall_at_10']:.4f}")
    print(f"R@20={out_json['recall_at_20']:.4f}")
    print(f"NDCG@10={out_json['ndcg_at_10']:.4f}")
    print(f"MRR ={out_json['mrr']:.4f}")
    print(f"graph: {n_nodes} nodes / {n_edges} edges, indexed in {index_s:.1f}s")
    print("wrote", op)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full()
