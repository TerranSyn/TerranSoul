#!/usr/bin/env python3
"""Real retrieval bench of **HippoRAG 2** (graph Personalized-PageRank) on the
agentmemory 240-doc / 20-query fixture.

Parity with the embedder sweep / Mem0 control:
  * same fixture, same per-doc text (title+subtitle+facts+narrative),
  * same metric functions (imported from ../embedder-sweep/embedder_sweep.py),
  * same embedder: nomic-embed-text via Ollama, 768-d.

HippoRAG indexes a corpus with OpenIE (NER + triple extraction by an LLM) to
build a knowledge graph, then retrieves passages via Personalized PageRank over
that KG seeded from query->fact links. retrieval_type = "graph PPR".

PLATFORM (Windows): HippoRAG defaults to **vLLM** for offline OpenIE, and vLLM
has NO Windows wheel. We therefore use HippoRAG's *online* OpenAI-compatible
path pointed at Ollama:
    llm_base_url       = http://127.0.0.1:11434/v1   (OpenIE + fact reranking)
    embedding_base_url = http://127.0.0.1:11434/v1   (nomic-embed-text, 768-d)
The unused vLLM offline module is import-stubbed so `import hipporag` succeeds.
EMBEDDER PARITY is preserved: HippoRAG encodes passages/entities/facts/queries
with nomic-embed-text (768-d) via Ollama's /v1/embeddings, exactly like the
sweep + Mem0. The OpenIE/rerank chat LLM only shapes the graph; it is not the
embedder, so parity on the retrieval embedding is intact.

DEDUP NOTE: the fixture is 48 distinct contents x 5 sessions = 240 obs, but only
48 *unique* passage texts. HippoRAG (like any passage store) dedupes by content
hash -> 48 passage nodes. Relevance in the fixture is defined at content level
(every relevant set is a union of complete 5-copy groups), so we expand each
ranked unique passage back to its 5 doc_ids before scoring -- this is exactly
what the pure-vector sweep does implicitly (5 identical vectors tie together).

Sanity anchor (nomic pure-vector on THIS corpus): R@5 0.406 / R@10 0.558.
A graph system MAY differ; R@10 < 0.2 would mean a wiring bug.

Usage:
  python bench_hipporag.py --smoke   # 1-doc + 1-query reproduce-first check
  python bench_hipporag.py           # full 240-doc / 20-query run
"""
import sys, os, json, time, argparse, shutil, types, warnings, logging
warnings.filterwarnings("ignore")
logging.getLogger().setLevel(logging.WARNING)

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

OLLAMA_V1 = "http://127.0.0.1:11434/v1"
EMB_MODEL = "nomic-embed-text"     # 768-d, identical to sweep + Mem0
# OpenIE + fact-rerank chat model. HippoRAG bakes llm_name into Windows dir/cache
# *file paths* verbatim, and ':' is illegal in Windows paths -- so we use a
# colon-free Ollama alias of gemma3:1b (created via `ollama cp gemma3:1b
# hipporagopenie`; Ollama resolves the bare name to :latest).
LLM_MODEL = "hipporagopenie"      # == gemma3:1b (colon-free alias)
os.environ.setdefault("OPENAI_API_KEY", "sk-ollama")  # any non-empty key; Ollama ignores it

SAVE_DIR = os.path.join(HERE, ".hipporag_store")
SMOKE_DIR = os.path.join(HERE, ".hipporag_smoke")


# ── vLLM import stub (offline path unused; no Windows wheel) ──────────────────
def _stub_vllm():
    m = types.ModuleType("vllm")

    class _Unavail:  # never instantiated in the online path
        def __init__(self, *a, **k):
            raise RuntimeError("vLLM offline unavailable on Windows; online path only")

    m.SamplingParams = _Unavail
    m.LLM = _Unavail
    sys.modules["vllm"] = m


_stub_vllm()

# IMPORTANT (Windows): hipporag.embedding_model.base defines a module-level
# multiprocessing.Manager() at *import* time. Under the Windows 'spawn' start
# method the Manager's server process re-imports the __main__ script as
# __mp_main__; if hipporag were imported at this module's top level the child
# would recurse into Manager() during bootstrap -> RuntimeError. So we import
# hipporag and install the embedder routing LAZILY, only in the real main
# process (inside _setup, called under the __main__ guard).
HippoRAG = None
BaseConfig = None


def _setup():
    """Import hipporag (heavy; spawns a Manager) and route nomic to the
    OpenAI-compatible embedding backend. Call only from the main process."""
    global HippoRAG, BaseConfig
    if HippoRAG is not None:
        return
    import hipporag.embedding_model as em
    import hipporag.HippoRAG  # ensure the SUBMODULE is imported
    from hipporag import HippoRAG as _HippoRAG
    from hipporag.utils.config_utils import BaseConfig as _BaseConfig

    # HippoRAG's OpenAIEmbeddingModel calls client.embeddings.create(model=name)
    # and L2-normalizes -> exactly the sweep's nomic pure-vector encoding when
    # pointed at Ollama's /v1/embeddings.
    _orig_sel = em._get_embedding_model_class

    def _sel(embedding_model_name="nvidia/NV-Embed-v2"):
        if "nomic" in embedding_model_name or "text-embedding" in embedding_model_name:
            return em.OpenAIEmbeddingModel
        return _orig_sel(embedding_model_name)

    em._get_embedding_model_class = _sel
    # NOTE: the package __init__ does `from .HippoRAG import HippoRAG`, so the
    # CLASS shadows the module attribute (`import hipporag.HippoRAG as HR` would
    # bind HR to the class!). HippoRAG.__init__ resolves the bare name
    # `_get_embedding_model_class` as a *module global*, so we must patch the
    # real module object obtained from sys.modules.
    _hippo_mod = sys.modules["hipporag.HippoRAG"]
    _hippo_mod._get_embedding_model_class = _sel
    HippoRAG = _HippoRAG
    BaseConfig = _BaseConfig


def build(save_dir):
    if os.path.isdir(save_dir):
        shutil.rmtree(save_dir, ignore_errors=True)
    cfg = BaseConfig()
    cfg.llm_name = LLM_MODEL
    cfg.llm_base_url = OLLAMA_V1
    cfg.embedding_model_name = EMB_MODEL
    cfg.embedding_base_url = OLLAMA_V1
    cfg.openie_mode = "online"
    cfg.save_dir = save_dir
    cfg.embedding_batch_size = 16
    cfg.embedding_return_as_normalized = True
    cfg.force_index_from_scratch = True
    cfg.force_openie_from_scratch = True
    cfg.save_openie = True
    return HippoRAG(global_config=cfg)


def ranked_doc_ids_from_texts(ranked_texts, text_to_docids, seen=None):
    """Expand HippoRAG's ranked UNIQUE passage texts to doc_ids (5 copies each)."""
    out = []
    for t in ranked_texts:
        key = t.strip()
        dids = text_to_docids.get(key) or text_to_docids.get(t)
        if dids:
            out.extend(dids)
    return out


def smoke():
    _setup()
    print("[smoke] building HippoRAG ...", flush=True)
    hr = build(SMOKE_DIR)
    docs = ["The capital of France is Paris.",
            "Photosynthesis converts light into chemical energy in plants."]
    t2d = {"The capital of France is Paris.": ["DOC_A"],
           "Photosynthesis converts light into chemical energy in plants.": ["DOC_B"]}
    print("[smoke] indexing 2 docs (OpenIE via gemma3:1b) ...", flush=True)
    hr.index(docs)
    sols = hr.retrieve(["What is the capital of France?"], num_to_retrieve=5)
    ranked_texts = list(sols[0].docs)
    ids = ranked_doc_ids_from_texts(ranked_texts, t2d)
    print("[smoke] ranked texts:", ranked_texts)
    print("[smoke] ranked doc_ids:", ids)
    assert ids and ids[0] == "DOC_A", f"expected DOC_A first, got {ids}"
    print("[smoke] OK -- top result is the relevant doc.")


def full():
    _setup()
    from collections import defaultdict
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    text_to_docids = defaultdict(list)
    for oid, t in zip(obs_ids, obs_texts):
        text_to_docids[t.strip()].append(oid)
    n_unique = len(text_to_docids)
    print(f"corpus: {n_obs} obs, {n_q} queries, {n_unique} unique passage texts", flush=True)

    hr = build(SAVE_DIR)
    t0 = time.time()
    print("indexing (OpenIE + KG build) ...", flush=True)
    hr.index(list(obs_texts))   # HippoRAG dedupes to n_unique passage nodes
    ingest_s = time.time() - t0
    print(f"index done in {ingest_s:.1f}s", flush=True)

    # Retrieve all ranked unique passages, then expand to doc_ids and truncate.
    t1 = time.time()
    sols = hr.retrieve(list(q_texts), num_to_retrieve=n_unique)
    retr_s = time.time() - t1

    per_query = []
    unmapped = 0
    for qi in range(n_q):
        ranked_texts = list(sols[qi].docs)
        retrieved = ranked_doc_ids_from_texts(ranked_texts, text_to_docids)
        if len(retrieved) < 20:
            unmapped += 1
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
            "unique_passages_ranked": len(ranked_texts),
        })

    out = {
        "system": "HippoRAG 2",
        "embedder": "nomic-embed-text",
        "dim": 768,
        "retrieval_type": "graph PPR (Personalized PageRank over OpenIE KG)",
        "openie_llm": LLM_MODEL,
        "source": "HippoRAG 2.0.0a4, online OpenAI-compat path on Ollama (vLLM has no Windows wheel)",
        "parity_note": ("nomic-embed-text 768-d via Ollama /v1/embeddings for passages/"
                        "entities/facts/queries -> embedder parity preserved; ranked unique "
                        "passages expanded to their 5 doc_ids (content-level relevance)."),
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "retrieve_seconds": round(retr_s, 1),
        "n_obs": n_obs, "n_queries": n_q, "n_unique_passages": n_unique,
        "queries_with_lt20_mapped": unmapped,
        "per_query": per_query,
    }
    op = os.path.join(HERE, "hipporag.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: HippoRAG 2 (nomic-embed-text, graph PPR) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print(f"(anchor nomic pure-vector: R@5 0.406 / R@10 0.558 / R@20 0.767)")
    print("wrote", op)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full()
