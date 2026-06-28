#!/usr/bin/env python3
"""Real retrieval bench of **Letta** (formerly MemGPT) on the agentmemory
240-doc / 20-query fixture.

Parity with the embedder sweep + Mem0 control: same fixture, same per-doc text,
same metric functions (imported from ../embedder-sweep/embedder_sweep.py), same
embedder (nomic-embed-text via Ollama, 768-d). We ingest each observation
VERBATIM as ONE archival passage tagged with its obs id (NO LLM rewrite), then
read the ranked doc ids straight back from each retrieved passage's tags.

Retrieval is Letta archival search. AUDIT FINDING: on the Postgres+pgvector
backend this is PURE VECTOR (cosine) -- the hybrid FTS+RRF path only runs on the
Turbopuffer backend. Verified: search relevance metadata (rrf/fts/vector_rank) is
null, and build_passage_query orders solely by embedding.cosine_distance().

Sanity anchor (nomic pure-vector on THIS corpus): R@5 0.406 / R@10 0.558.
Mem0 (clean nomic vector control): R@5 0.41 / R@10 0.61 / R@20 0.74.

Server: a Letta 0.16.8 server at http://localhost:8283 (password "bench"),
backed by Postgres+pgvector, Ollama at 127.0.0.1:11434.

EMBEDDING ENDPOINT FIX: Letta registers the Ollama embedding handle with an
OpenAI-compat endpoint WITHOUT the /v1 suffix, so the OpenAI client posts to
{base}/embeddings -> Ollama 404. We pass an explicit embedding_config whose
endpoint is http://127.0.0.1:11434/v1 so the call lands on /v1/embeddings.

Usage:
  python bench_letta.py --smoke     # 1-doc + 1-query reproduce-first check
  python bench_letta.py             # full 240-doc / 20-query run
"""
import sys, os, json, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

from letta_client import Letta

LETTA_URL = "http://localhost:8283"
LETTA_TOKEN = os.environ.get("LETTA_SERVER_PASSWORD", "bench")
OLLAMA_V1 = "http://127.0.0.1:11434/v1"

# Explicit embedding_config pinned to nomic-embed-text @ Ollama, 768-d, /v1 path.
EMB_CONFIG = {
    "embedding_endpoint_type": "openai",
    "embedding_endpoint": OLLAMA_V1,
    "embedding_model": "nomic-embed-text:latest",
    "embedding_dim": 768,
    "embedding_chunk_size": 2048,   # > longest doc (~130 tok) => one passage / doc
    "batch_size": 32,
    "handle": "ollama/nomic-embed-text:latest",
}
# Chat model is never exercised by archival retrieval; pin any valid handle.
CHAT_MODEL = "ollama/gemma4:e2b-it-qat"


def client():
    return Letta(base_url=LETTA_URL, api_key=LETTA_TOKEN)


def make_agent(c, name):
    return c.agents.create(model=CHAT_MODEL, embedding_config=EMB_CONFIG, name=name)


def ranked_doc_ids(res):
    """Extract ranked doc_ids from a Letta PassageSearchResponse.

    Each result carries the tags we set at ingest; the first tag is the doc_id.
    """
    items = getattr(res, "results", None)
    if items is None:
        items = res if isinstance(res, list) else getattr(res, "data", []) or []
    out = []
    for r in items:
        tags = getattr(r, "tags", None)
        if tags is None and isinstance(r, dict):
            tags = r.get("tags")
        if tags:
            out.append(tags[0])
    return out


def smoke():
    print("[smoke] connecting + creating agent ...", flush=True)
    c = client()
    a = make_agent(c, f"bench_letta_smoke_{int(time.time())}")
    print("[smoke] agent:", a.id, "emb:", a.embedding_config.embedding_endpoint)
    try:
        c.agents.passages.create(agent_id=a.id, text="The capital of France is Paris.", tags=["DOC_A"])
        c.agents.passages.create(
            agent_id=a.id,
            text="Photosynthesis converts light into chemical energy in plants.",
            tags=["DOC_B"],
        )
        res = c.agents.passages.search(agent_id=a.id, query="What is the capital of France?", top_k=5)
        ids = ranked_doc_ids(res)
        print("[smoke] ranked doc_ids:", ids)
        assert ids and ids[0] == "DOC_A", f"expected DOC_A first, got {ids}"
        print("[smoke] OK - top result is the relevant doc.")
    finally:
        try:
            c.agents.delete(a.id)
        except Exception as e:
            print("[smoke] cleanup warn:", e)


def full():
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)
    c = client()
    a = make_agent(c, f"bench_letta_{int(time.time())}")
    print("agent:", a.id, "emb endpoint:", a.embedding_config.embedding_endpoint, flush=True)
    try:
        t0 = time.time()
        for i, (oid, text) in enumerate(zip(obs_ids, obs_texts)):
            c.agents.passages.create(agent_id=a.id, text=text, tags=[oid])
            if (i + 1) % 40 == 0:
                print(f"  ingested {i+1}/{n_obs} ({time.time()-t0:.1f}s)", flush=True)
        ingest_s = time.time() - t0

        per_query = []
        for qi in range(n_q):
            res = c.agents.passages.search(agent_id=a.id, query=q_texts[qi], top_k=20)
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
    finally:
        try:
            c.agents.delete(a.id)
            print("deleted agent", a.id)
        except Exception as e:
            print("cleanup warn:", e)

    out = {
        "system": "Letta",
        "embedder": "nomic-embed-text",
        "dim": 768,
        # AUDIT: despite the task's "hybrid" expectation, Letta 0.16.8 archival
        # search on the Postgres+pgvector backend is PURE VECTOR. Verified two
        # ways: (1) the search response's relevance metadata (rrf_score /
        # fts_rank / vector_rank) is null on every result; (2) the server's
        # build_passage_query (agent_manager_helper.py) orders solely by
        # `embedding.cosine_distance(query).asc()` -- no tsvector / ts_rank /
        # RRF. The hybrid (FTS+vector RRF) path is reachable only on the
        # Turbopuffer backend, not Postgres. Hence this lands EXACTLY on the
        # nomic pure-vector control (Mem0), as expected for identical embeddings.
        "retrieval_type": "vector (nomic, pgvector cosine)",
        "retrieval_mode_audit": "Postgres archival search is semantic-only; FTS/RRF metadata null and build_passage_query orders by cosine_distance only (hybrid is Turbopuffer-only in 0.16.8)",
        "source": "Letta 0.16.8 archival memory (Postgres+pgvector, pure cosine vector search, verbatim 1-passage-per-doc ingest, tags=doc_id)",
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "n_obs": n_obs, "n_queries": n_q,
        "per_query": per_query,
    }
    op = os.path.join(HERE, "letta.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: Letta (nomic-embed-text, pgvector cosine) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print("(anchor nomic pure-vector: R@5 0.406 / R@10 0.558; Mem0 control R@10 0.61)")
    print("wrote", op)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full()
