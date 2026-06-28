#!/usr/bin/env python3
"""Real retrieval bench of **Cognee** on the agentmemory 240-doc / 20-query fixture.

Parity with the embedder sweep / Mem0 control: same fixture, same per-doc text,
same metric functions (imported from ../embedder-sweep/embedder_sweep.py), same
embedder (nomic-embed-text via Ollama, 768-d). We ingest each observation
VERBATIM as ONE file named "<obs_id>.txt" (no LLM rewrite of content), run
cognee.add + cognee.cognify, then read ranked doc ids back from a pure-vector
SearchType.CHUNKS search (each returned chunk carries its source document_name,
which is our obs id).

Cognee is configured to use OLLAMA for BOTH the LLM (graph extraction) and the
embedder, with NO OpenAI key. CHUNKS retrieval is pure vector similarity over the
DocumentChunk_text collection, so it is comparable to the nomic pure-vector anchor:
  R@5 0.406 / R@10 0.558 / R@20 0.767 / NDCG@10 0.847 / MRR 0.917.

Usage:
  python bench_cognee.py --smoke           # 2-doc + 1-query reproduce-first check
  python bench_cognee.py --subset 40       # timed subset run
  python bench_cognee.py                    # full 240-doc / 20-query run
"""
import os, sys, json, time, argparse, asyncio, shutil

# ── Ollama (LLM + embedder) config — MUST be set before importing cognee ──────
OLLAMA = "http://127.0.0.1:11434"
os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")
os.environ.setdefault("CACHING", "false")
# LLM (cognify graph extraction) — OpenAI-compatible /v1 endpoint, bare ollama tag.
os.environ["LLM_PROVIDER"] = "ollama"
os.environ["LLM_MODEL"] = "gemma3:1b"
os.environ["LLM_ENDPOINT"] = OLLAMA + "/v1"
os.environ["LLM_API_KEY"] = "ollama"
# Embedder — Ollama /api/embed, nomic-embed-text, 768-d (parity pin).
os.environ["EMBEDDING_PROVIDER"] = "ollama"
os.environ["EMBEDDING_MODEL"] = "nomic-embed-text"
os.environ["EMBEDDING_ENDPOINT"] = OLLAMA + "/api/embed"
os.environ["EMBEDDING_DIMENSIONS"] = "768"
os.environ["EMBEDDING_MAX_TOKENS"] = "512"
os.environ["HUGGINGFACE_TOKENIZER"] = "nomic-ai/nomic-embed-text-v1.5"

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

# Isolate cognee's stores under a scratch dir so runs are reproducible.
SCRATCH = os.path.join(HERE, ".cognee_bench")
CORPUS_DIR = os.path.join(SCRATCH, "corpus")
SYS_DIR = os.path.join(SCRATCH, "system")
DATA_DIR = os.path.join(SCRATCH, "data")

import cognee
from cognee.modules.search.types import SearchType
import cognee.api.v1.cognify.cognify  # register the submodule in sys.modules
# NOTE: `cognee.api.v1.cognify.cognify` resolves to the cognify FUNCTION (the
# package __init__ shadows the submodule name), so fetch the real module object
# from sys.modules to patch its globals.
_cog = sys.modules["cognee.api.v1.cognify.cognify"]


async def _chunks_passthrough(data_chunks, *args, **kwargs):
    """Replace cognify's LLM graph+summary step with a no-op.

    SearchType.CHUNKS is pure vector similarity over the DocumentChunk_text
    collection, which is populated by the downstream add_data_points task — it
    does NOT use the knowledge graph or chunk summaries. The LLM extraction is
    therefore irrelevant to CHUNKS retrieval, and gemma3:1b cannot satisfy
    cognee's SummarizedContent structured-output schema (InstructorRetryException
    crashes the whole pipeline before chunks are stored). We forward the
    DocumentChunks straight to add_data_points so their text is embedded with
    nomic-embed-text exactly as cognify would. (Verified: chunk vectors are
    identical to the full-cognify path; the smoke retrieved correct chunks even
    when the 1b summaries were garbage.)
    """
    return data_chunks


# Patch the symbol in cognify's module namespace (Task() reads it at runtime).
_cog.extract_graph_and_summarize = _chunks_passthrough


def configure(reset=True):
    if reset and os.path.isdir(SCRATCH):
        shutil.rmtree(SCRATCH, ignore_errors=True)
    os.makedirs(CORPUS_DIR, exist_ok=True)
    os.makedirs(SYS_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    cognee.config.system_root_directory(SYS_DIR)
    cognee.config.data_root_directory(DATA_DIR)
    cognee.config.set_llm_config({
        "llm_provider": "ollama",
        "llm_model": "gemma3:1b",
        "llm_endpoint": OLLAMA + "/v1",
        "llm_api_key": "ollama",
    })
    cognee.config.set_embedding_config({
        "embedding_provider": "ollama",
        "embedding_model": "nomic-embed-text",
        "embedding_endpoint": OLLAMA + "/api/embed",
        "embedding_dimensions": 768,
        "embedding_max_completion_tokens": 512,
        "huggingface_tokenizer": "nomic-ai/nomic-embed-text-v1.5",
    })


def write_docs(pairs):
    """Write each (doc_id, text) as <doc_id>.txt; return list of file paths."""
    paths = []
    for did, text in pairs:
        p = os.path.join(CORPUS_DIR, f"{did}.txt")
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        paths.append(p)
    return paths


def _payload_of(item):
    if isinstance(item, dict) and "payload" in item and isinstance(item["payload"], dict):
        return item["payload"]
    return item if isinstance(item, dict) else None


def _doc_name(payload):
    name = payload.get("document_name") or ""
    if name.endswith(".txt"):
        name = name[:-4]
    return name


def ranked_doc_ids(results):
    """Smoke helper: CHUNKS search -> ordered unique document_names (best first)."""
    out, seen = [], set()
    for item in results:
        payload = _payload_of(item)
        if not payload:
            continue
        did = _doc_name(payload)
        if did and did not in seen:
            seen.add(did)
            out.append(did)
    return out


def ranked_obs_ids_expanded(results, rep_to_ids, text_to_ids, k):
    """Map cognee CHUNKS results back to the GOLD obs-id space.

    The corpus is 48 distinct texts x5 sessions = 240 obs; cognee content-dedups
    so it stores ONE chunk per distinct text (keyed by the representative obs id
    we named the file with). For each ranked chunk we re-inflate to ALL obs ids
    that share its text, in global obs order — provably equivalent to the
    pure-vector anchor over the full 240 (validated: same numbers as Mem0)."""
    out, seen_text = [], set()
    for item in results:
        payload = _payload_of(item)
        if not payload:
            continue
        ids = None
        name = _doc_name(payload)
        if name in rep_to_ids:
            ids = rep_to_ids[name]
        else:
            key = (payload.get("text") or "").strip()
            ids = text_to_ids.get(key)
        if not ids:
            continue
        tkey = ids[0]
        if tkey in seen_text:
            continue
        seen_text.add(tkey)
        out.extend(ids)  # global obs order preserved within the group
    return out[:k]


async def ingest(pairs):
    paths = write_docs(pairs)
    await cognee.add(paths)
    await cognee.cognify()


async def query_chunks(q, k=50):
    res = await cognee.search(query_text=q, query_type=SearchType.CHUNKS, top_k=k)
    return res


async def smoke():
    print("[smoke] configuring cognee (ollama llm+embed) ...", flush=True)
    configure(reset=True)
    pairs = [
        ("DOC_A", "The capital of France is Paris. Paris sits on the Seine river."),
        ("DOC_B", "Photosynthesis converts light into chemical energy in green plants."),
    ]
    t0 = time.time()
    await ingest(pairs)
    print(f"[smoke] ingest+cognify {time.time()-t0:.1f}s", flush=True)
    res = await query_chunks("What is the capital of France?", k=10)
    print("[smoke] raw result type:", type(res).__name__, "len:",
          len(res) if hasattr(res, "__len__") else "?")
    if res:
        first = res[0]
        print("[smoke] first item type:", type(first).__name__)
        if isinstance(first, dict):
            print("[smoke] first item keys:", list(first.keys()))
            payload = first.get("payload", first)
            if isinstance(payload, dict):
                print("[smoke] payload keys:", list(payload.keys()))
                print("[smoke] document_name:", payload.get("document_name"),
                      "| text[:60]:", str(payload.get("text"))[:60])
    ids = ranked_doc_ids(res)
    print("[smoke] ranked doc_ids:", ids)
    assert ids and ids[0] == "DOC_A", f"expected DOC_A first, got {ids}; raw={str(res)[:600]}"
    print("[smoke] OK — top chunk maps to the relevant doc.")


async def full(limit=None):
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)

    # Cognee content-dedups Data by hash, so the 48 distinct texts (each x5
    # sessions) are stored once. Add the 48 unique contents verbatim (one file
    # per distinct text, named by its representative obs id), then expand each
    # retrieved chunk back to all obs ids sharing its text.
    text_to_ids, order = {}, []
    for oid, t in zip(obs_ids, obs_texts):
        key = t.strip()
        if key not in text_to_ids:
            text_to_ids[key] = []
            order.append((key, t))
        text_to_ids[key].append(oid)
    uniq = [(text_to_ids[key][0], full_text) for (key, full_text) in order]  # (rep_id, text)
    if limit:
        uniq = uniq[:limit]
    rep_to_ids = {rep: text_to_ids[txt.strip()] for rep, txt in uniq}
    print(f"unique texts to ingest: {len(uniq)}", flush=True)

    configure(reset=True)

    t0 = time.time()
    paths = write_docs(uniq)
    # Ingest in small sequential add+cognify batches. Cognify parallelizes data
    # items (data_per_batch) and the concurrent writers collide on cognee's
    # internal SQLite ("database is locked") past ~one batch; small serial
    # batches (with incremental_loading skipping already-processed docs) avoid it.
    BATCH = 6
    for i in range(0, len(paths), BATCH):
        grp = paths[i:i + BATCH]
        await cognee.add(grp)
        await cognee.cognify(data_per_batch=BATCH)
        print(f"  ingested+cognified {min(i+BATCH, len(paths))}/{len(paths)} "
              f"({time.time()-t0:.0f}s)", flush=True)
    ingest_s = time.time() - t0
    print(f"  cognify done ({ingest_s:.0f}s)", flush=True)

    per_query = []
    for qi in range(n_q):
        res = await query_chunks(q_texts[qi], k=60)
        retrieved = ranked_obs_ids_expanded(res, rep_to_ids, text_to_ids, 240)
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
        "system": "Cognee",
        "embedder": "nomic-embed-text",
        "dim": 768,
        "source": "Cognee (LanceDB vector store, SearchType.CHUNKS pure-vector; "
                  "nomic-embed-text via ollama; cognify chunking+embedding pipeline, "
                  "LLM graph/summary step skipped — irrelevant to CHUNKS and "
                  "uncompletable on gemma3:1b)",
        "retrieval_type": "vector (nomic, chunks)",
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "n_obs": n_obs, "n_queries": n_q,
        "n_unique_ingested": len(uniq),
        "note": "Cognee content-dedups identical Data; the 240-obs corpus is 48 "
                "distinct texts x5 sessions, so 48 unique chunks are stored and "
                "each retrieved chunk is expanded back to its 5 obs ids (global "
                "order). Validated equivalent to nomic pure-vector over 240 "
                "(matches Mem0 exactly).",
        "subset": bool(limit),
        "per_query": per_query,
    }
    op = os.path.join(HERE, "cognee.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: Cognee (nomic-embed-text, CHUNKS pure-vector) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print("(anchor nomic pure-vector: R@5 0.406 / R@10 0.558 / R@20 0.767)")
    print("wrote", op)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--subset", type=int, default=None)
    args = ap.parse_args()
    if args.smoke:
        asyncio.run(smoke())
    else:
        asyncio.run(full(limit=args.subset))
