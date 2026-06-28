#!/usr/bin/env python3
"""Real retrieval bench of **Mem0** on the agentmemory 240-doc / 20-query fixture.

Parity with the embedder sweep: same fixture, same per-doc text, same metric
functions (imported from ../embedder-sweep/embedder_sweep.py), same embedder
(nomic-embed-text via Ollama, 768-d). We ingest each observation VERBATIM with
infer=False (no LLM rewrite) tagged with its obs id, then read the ranked
doc ids straight back from Mem0's vector search.

Sanity anchor (nomic pure-vector on THIS corpus): R@5 0.406 / R@10 0.558.
Mem0 over chroma+nomic should land near that; far below => a wiring bug.

Usage:
  python bench_mem0.py --smoke     # 1-doc + 1-query reproduce-first check
  python bench_mem0.py             # full 240-doc / 20-query run
"""
import sys, os, json, time, argparse, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

OLLAMA = "http://127.0.0.1:11434"
COLLECTION_DIR = os.path.join(HERE, ".mem0_chroma")


def build_memory():
    from mem0 import Memory
    # Fresh store each run for determinism.
    if os.path.isdir(COLLECTION_DIR):
        shutil.rmtree(COLLECTION_DIR, ignore_errors=True)
    config = {
        "vector_store": {
            "provider": "chroma",
            "config": {
                "collection_name": "bench",
                "path": COLLECTION_DIR,
            },
        },
        "embedder": {
            "provider": "ollama",
            "config": {
                "model": "nomic-embed-text",
                "embedding_dims": 768,
                "ollama_base_url": OLLAMA,
            },
        },
        # LLM present only so from_config() doesn't demand OPENAI_API_KEY; with
        # infer=False it is never called.
        "llm": {
            "provider": "ollama",
            "config": {"model": "gemma3:1b", "ollama_base_url": OLLAMA},
        },
    }
    return Memory.from_config(config)


def ranked_doc_ids(res):
    """Extract ranked doc_ids from a Mem0 search() result (version-tolerant)."""
    items = res["results"] if isinstance(res, dict) and "results" in res else res
    out = []
    for r in items:
        md = r.get("metadata") or {}
        did = md.get("doc_id")
        if did is not None:
            out.append(did)
    return out


def smoke():
    print("[smoke] building Mem0 ...", flush=True)
    m = build_memory()
    m.add("The capital of France is Paris.", user_id="bench", infer=False,
          metadata={"doc_id": "DOC_A"})
    m.add("Photosynthesis converts light into chemical energy in plants.",
          user_id="bench", infer=False, metadata={"doc_id": "DOC_B"})
    res = m.search("What is the capital of France?", filters={"user_id": "bench"}, limit=5)
    ids = ranked_doc_ids(res)
    print("[smoke] ranked doc_ids:", ids)
    assert ids and ids[0] == "DOC_A", f"expected DOC_A first, got {ids} (raw={json.dumps(res)[:400]})"
    print("[smoke] OK — top result is the relevant doc.")


def full():
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)
    m = build_memory()
    t0 = time.time()
    for i, (oid, text) in enumerate(zip(obs_ids, obs_texts)):
        m.add(text, user_id="bench", infer=False, metadata={"doc_id": oid})
        if (i + 1) % 40 == 0:
            print(f"  ingested {i+1}/{n_obs}", flush=True)
    ingest_s = time.time() - t0

    per_query = []
    for qi in range(n_q):
        res = m.search(q_texts[qi], filters={"user_id": "bench"}, limit=20)
        retrieved = ranked_doc_ids(res)
        rel = q_rel[qi]
        per_query.append({
            "query": q_texts[qi],
            "recall_at_5": es.recall(retrieved, rel, 5),
            "recall_at_10": es.recall(retrieved, rel, 10),
            "recall_at_20": es.recall(retrieved, rel, 20),
            "ndcg_at_10": es.ndcg_at_k(retrieved, rel, 10),
            "mrr": es.mrr(retrieved, rel),
            "relevant_count": len(rel),
            "retrieved_count": len(retrieved),
        })
    out = {
        "system": "Mem0",
        "embedder": "nomic-embed-text",
        "dim": 768,
        "source": "Mem0 (chroma vector store, infer=False verbatim ingest)",
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "n_obs": n_obs, "n_queries": n_q,
        "per_query": per_query,
    }
    op = os.path.join(HERE, "mem0.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: Mem0 (nomic-embed-text, chroma) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print(f"(anchor nomic pure-vector: R@5 0.406 / R@10 0.558)")
    print("wrote", op)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full()
