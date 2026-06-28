#!/usr/bin/env python3
"""Real retrieval bench of **A-MEM** (Agentic Memory, arXiv:2502.12110,
agiresearch/A-mem; PyPI `a-mem` 0.2.6 = the `agentic_memory` package) on the
agentmemory 240-doc / 20-query fixture.

Parity with the embedder sweep + Mem0/Letta/Cognee controls: same fixture, same
per-doc text, same metric functions (imported from
../embedder-sweep/embedder_sweep.py), same embedder (nomic-embed-text via Ollama,
768-d). We ingest each observation VERBATIM as the note `content` keyed by its
obs id (we do NOT pre-rewrite the text), run A-MEM's FULL native pipeline, then
read the ranked obs ids straight back from A-MEM's `search()` (ChromaDB vector
search), mapping result `id` -> obs id (we set id = obs id at ingest).

WHAT A-MEM ACTUALLY DOES (and why this is NOT just the nomic vector control):
A-MEM is "agentic" — `add_note` runs an LLM ("note construction") to extract
keywords + a one-sentence context + tags, then a memory-EVOLUTION LLM step links
the note to its nearest neighbours and may rewrite neighbours' tags/context. The
ChromaDB retriever then embeds an ENHANCED document
    content + " context: <ctx>" + " keywords: <kw,...>" + " tags: <tag,...>"
(retrievers.py::add_document), NOT the raw content. So A-MEM's retrieval is
pure-vector cosine, but over LLM-augmented documents — the augmentation is the
system's contribution and is exactly what makes its score diverge from the
plain nomic-on-raw-text anchor.

PARITY PINS (no OpenAI key anywhere):
  * Embedder -> nomic-embed-text via Ollama, 768-d. A-MEM's ChromaRetriever
    hard-codes a SentenceTransformer EF, so we subclass it to use chroma's
    OllamaEmbeddingFunction and swap it in (memory_system.ChromaRetriever).
  * LLM (note construction + evolution) -> a LOCAL Ollama model via litellm
    (ollama_chat/<model>), default gemma3:1b for speed (480-odd JSON calls).

Sanity anchor (nomic pure-vector on THIS corpus): R@5 0.406 / R@10 0.558 /
R@20 0.767 / NDCG@10 0.847 / MRR 0.917.  Mem0/Letta/Cognee clean nomic-vector
control: R@10 ~= 0.558-0.61.

Usage:
  python bench_amem.py --smoke          # 2-doc + 1-query reproduce-first check
  python bench_amem.py --subset 40      # timed subset run
  python bench_amem.py                  # full 240-doc / 20-query run
"""
import sys, os, json, time, argparse, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

OLLAMA = "http://127.0.0.1:11434"
# litellm reads OLLAMA_API_BASE for the ollama_chat/* provider.
os.environ.setdefault("OLLAMA_API_BASE", OLLAMA)

EMB_MODEL = "nomic-embed-text"
EMB_DIM = 768
LLM_BACKEND = "ollama"
LLM_MODEL = os.environ.get("AMEM_LLM_MODEL", "gemma3:1b")
STORE_DIR = os.path.join(HERE, ".amem_chroma")

import chromadb
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction
import agentic_memory.memory_system as ams
import agentic_memory.retrievers as amr


class OllamaChromaRetriever(amr.ChromaRetriever):
    """A-MEM ChromaRetriever pinned to nomic-embed-text via Ollama (768-d).

    Identical to the upstream retriever in every respect (same enhanced-document
    construction in add_document / update_document, same search) EXCEPT the
    embedding function, which we swap from the default SentenceTransformer
    (all-MiniLM-L6-v2) to chroma's OllamaEmbeddingFunction so every system in the
    head-to-head shares the SAME embedder."""

    def __init__(self, collection_name: str = "memories",
                 model_name: str = None, persist_directory: str = "./chroma_db"):
        self.persist_directory = persist_directory
        self.client = chromadb.PersistentClient(path=persist_directory)
        self.embedding_function = OllamaEmbeddingFunction(
            url=OLLAMA, model_name=EMB_MODEL)
        self.collection = self.client.get_or_create_collection(
            name=collection_name, embedding_function=self.embedding_function)


# Patch the symbol AgenticMemorySystem.__init__ reads when it builds its retriever.
ams.ChromaRetriever = OllamaChromaRetriever


def build_memory(reset=True):
    if reset and os.path.isdir(STORE_DIR):
        shutil.rmtree(STORE_DIR, ignore_errors=True)
    os.makedirs(STORE_DIR, exist_ok=True)
    mem = ams.AgenticMemorySystem(
        model_name=EMB_MODEL,          # passed through to our Ollama retriever
        llm_backend=LLM_BACKEND,
        llm_model=LLM_MODEL,
        storage_path=STORE_DIR,
    )
    # Hard assert we really swapped the embedder (no silent fallback to MiniLM).
    assert isinstance(mem.retriever, OllamaChromaRetriever), "embedder not pinned"
    return mem


def ranked_doc_ids(results):
    """A-MEM search() -> ordered list of result ids (== obs ids we ingested)."""
    return [r["id"] for r in results if r.get("id") is not None]


def smoke():
    print(f"[smoke] building A-MEM (emb={EMB_MODEL} llm={LLM_MODEL}) ...", flush=True)
    mem = build_memory(reset=True)
    print("[smoke] retriever:", type(mem.retriever).__name__,
          "| ef:", type(mem.retriever.embedding_function).__name__, flush=True)
    t0 = time.time()
    mem.add_note("The capital of France is Paris. Paris sits on the Seine river.", id="DOC_A")
    mem.add_note("Photosynthesis converts light into chemical energy in green plants.", id="DOC_B")
    print(f"[smoke] ingest+analyze+evolve {time.time()-t0:.1f}s", flush=True)
    res = mem.search("What is the capital of France?", k=5)
    ids = ranked_doc_ids(res)
    print("[smoke] ranked ids:", ids)
    assert ids and ids[0] == "DOC_A", f"expected DOC_A first, got {ids} (raw={json.dumps(res)[:400]})"
    print("[smoke] OK - top result maps to the relevant doc.")


def full(limit=None):
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    if limit:
        obs_ids, obs_texts = obs_ids[:limit], obs_texts[:limit]
        n_obs = len(obs_ids)
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)
    mem = build_memory(reset=True)
    print("retriever:", type(mem.retriever).__name__,
          "| ef:", type(mem.retriever.embedding_function).__name__, flush=True)

    t0 = time.time()
    for i, (oid, text) in enumerate(zip(obs_ids, obs_texts)):
        # Verbatim content, keyed by obs id. keywords/context/tags left to A-MEM's
        # own LLM note-construction + evolution (the genuine A-MEM pipeline).
        mem.add_note(text, id=oid)
        if (i + 1) % 20 == 0:
            print(f"  ingested {i+1}/{n_obs} ({time.time()-t0:.0f}s, evo_cnt={mem.evo_cnt})", flush=True)
    ingest_s = time.time() - t0
    print(f"  ingest done ({ingest_s:.0f}s, count={mem.retriever.count()}, evo_cnt={mem.evo_cnt})", flush=True)

    per_query = []
    for qi in range(n_q):
        res = mem.search(q_texts[qi], k=20)
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
        "system": "A-MEM",
        "embedder": EMB_MODEL,
        "dim": EMB_DIM,
        "llm": f"ollama/{LLM_MODEL}",
        "source": "A-MEM (agentic_memory, arXiv:2502.12110; ChromaDB vector search "
                  "over LLM-ENHANCED documents = content+context+keywords+tags; "
                  "note construction + memory evolution via local Ollama LLM; "
                  "embedder pinned to nomic-embed-text via Ollama, 768-d; verbatim "
                  "content ingest keyed by obs id)",
        "retrieval_type": "vector (nomic, over LLM-augmented A-MEM notes)",
        "retrieval_mode_audit": "A-MEM ChromaRetriever.add_document embeds "
                  "enhanced_document = content + ' context:'+ctx + ' keywords:'+kw "
                  "+ ' tags:'+tags (LLM-generated); search() is a pure ChromaDB "
                  "cosine query over those enhanced docs. The LLM augmentation + "
                  "evolution links are A-MEM's contribution vs the raw-text anchor.",
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "evolutions": mem.evo_cnt,
        "n_obs": n_obs, "n_queries": n_q,
        "subset": bool(limit),
        "per_query": per_query,
    }
    op = os.path.join(HERE, "amem.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: A-MEM (nomic-embed-text, LLM-augmented notes) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print("(anchor nomic pure-vector: R@5 0.406 / R@10 0.558 / R@20 0.767; "
          "Mem0/Letta/Cognee control R@10 ~0.558-0.61)")
    print("wrote", op)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--subset", type=int, default=None)
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full(limit=args.subset)
