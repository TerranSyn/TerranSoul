#!/usr/bin/env python3
"""Real retrieval bench of **Khoj** (the self-hostable AI assistant w/ semantic
search) on the agentmemory 240-doc / 20-query fixture, retrieval-only.

Parity with the embedder sweep + Mem0/Letta/Cognee control: same fixture, same
per-doc text, same metric functions (imported from
../embedder-sweep/embedder_sweep.py), same embedder by default
(nomic-embed-text via Ollama, 768-d). We index each observation VERBATIM as ONE
Khoj entry keyed by its obs id (NO LLM rewrite), run Khoj semantic search for
top_k=20, and map the ranked entries back to obs ids.

HOW KHOJ SEARCH WORKS (from the 1.42.10 wheel, verbatim audit):
  * khoj/processor/embeddings.py :: EmbeddingsModel
      - default bi-encoder = "thenlper/gte-small" (SentenceTransformer, 384-d),
        normalize_embeddings=True for both query and docs.
      - OR an OpenAI-compatible inference endpoint (ApiType.OPENAI):
        get_openai_client(api_key, endpoint).embeddings.create(input, model).
        => Khoj DOES allow a local Ollama embedder via its /v1 endpoint.
  * khoj/search_type/text_search.py
      - compute_embeddings(): bi_encoder.encode(...) then util.normalize_embeddings.
      - query(): embed query, then EntryAdapters.search_with_embeddings(...)
        which on Postgres+pgvector orders by COSINE distance (top_k hardcoded 10).
      - rerank_and_sort_results()/cross_encoder_score(): OPTIONAL cross-encoder
        rerank with default "mixedbread-ai/mxbai-rerank-xsmall-v1". The
        /api/search endpoint defaults r=False (no rerank); rerank is applied in
        chat retrieval flows.

So Khoj's *default* semantic search is pure bi-encoder cosine top-k. We report
that as the headline (apples-to-apples with the nomic-vector control), and ALSO
record the cross-encoder-rerank variant + Khoj's shipped gte-small embedder as
secondaries, so the JSON captures Khoj's full shipped pipeline.

We exercise Khoj's REAL EmbeddingsModel class when it imports without a live
Postgres/Django DB; otherwise we fall back to a byte-faithful inline replica of
the exact same embed + normalize + cosine code path (documented below).

Control anchors (nomic pure-vector on THIS corpus, 768-d):
  embedder-sweep nomic : R@5 0.406 / R@10 0.558 / R@20 0.767
  Mem0  (nomic vector) : R@10 0.61    Cognee (nomic vector): R@10 0.608

Usage:
  python bench_khoj.py --smoke   # 2-doc + 1-query reproduce-first check
  python bench_khoj.py           # full 240-doc / 20-query run (nomic via Ollama)
"""
import sys, os, json, time, math, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

OLLAMA_V1 = "http://127.0.0.1:11434/v1"
NOMIC_MODEL = "nomic-embed-text"
KHOJ_DEFAULT_BIENCODER = "thenlper/gte-small"
KHOJ_DEFAULT_CROSSENCODER = "mixedbread-ai/mxbai-rerank-xsmall-v1"


# ── Khoj embedder (real class if it imports cleanly, else faithful replica) ───

def _ensure_django():
    """Minimal Django app-registry setup so Khoj's real model classes import.

    Khoj is a Django app; importing SearchModelConfig / EmbeddingsModel needs the
    app registry ready. The OpenAI embedding path does NOT touch the DB, so no
    Postgres is required -- only django.setup() with a dummy secret key.
    """
    import os as _os, django
    from django.apps import apps as _apps
    _os.environ.setdefault("KHOJ_DJANGO_SECRET_KEY", "bench")
    _os.environ.setdefault("DJANGO_SETTINGS_MODULE", "khoj.app.settings")
    _os.environ.setdefault("KHOJ_TELEMETRY_DISABLE", "1")
    if not _apps.ready:
        django.setup()


def _make_khoj_openai_embedder(model=NOMIC_MODEL, endpoint=OLLAMA_V1):
    """Return (embed_docs, embed_query, used_real_class:bool).

    Uses Khoj's real EmbeddingsModel (OpenAI endpoint type) after a minimal
    django.setup(). If that ever fails, fall back to the exact same OpenAI-client
    call Khoj's embed_with_openai uses.
    """
    try:
        _ensure_django()
        from khoj.processor.embeddings import EmbeddingsModel
        from khoj.database.models import SearchModelConfig

        em = EmbeddingsModel(
            model_name=model,
            embeddings_inference_endpoint=endpoint,
            embeddings_inference_endpoint_api_key="ollama",
            embeddings_inference_endpoint_type=SearchModelConfig.ApiType.OPENAI,
        )
        return (lambda docs: em.embed_documents(docs),
                lambda q: em.embed_query(q),
                True)
    except Exception as e:
        print(f"[khoj] real EmbeddingsModel unavailable ({type(e).__name__}: "
              f"{str(e)[:120]}); using faithful inline OpenAI-endpoint replica "
              f"(same code path as embed_with_openai).", flush=True)
        from openai import OpenAI
        client = OpenAI(base_url=endpoint, api_key="ollama")

        def embed_docs(docs):
            # mirrors EmbeddingsModel.embed_with_openai (chunked at 1000)
            out = []
            for i in range(0, len(docs), 1000):
                resp = client.embeddings.create(
                    input=docs[i:i + 1000], model=model, encoding_format="float")
                out += [d.embedding for d in resp.data]
            return out

        def embed_query(q):
            resp = client.embeddings.create(
                input=[q], model=model, encoding_format="float")
            return resp.data[0].embedding

        return embed_docs, embed_query, False


def _make_khoj_local_embedder(model=KHOJ_DEFAULT_BIENCODER):
    """Khoj's shipped LOCAL bi-encoder: SentenceTransformer w/ normalize=True.

    This is byte-identical to EmbeddingsModel(LOCAL).embed_documents/embed_query
    (normalize_embeddings=True for both)."""
    from sentence_transformers import SentenceTransformer
    st = SentenceTransformer(model)
    embed_docs = lambda docs: st.encode(docs, normalize_embeddings=True, show_progress_bar=False).tolist()
    embed_query = lambda q: st.encode([q], normalize_embeddings=True, show_progress_bar=False)[0].tolist()
    return embed_docs, embed_query


# ── Khoj retrieval: normalize + cosine top-k (text_search.compute_embeddings) ──

def cosine_topk(qvec, doc_vecs, doc_ids, k=20):
    # L2-normalize (Khoj util.normalize_embeddings) -> dot == cosine.
    qn = es.l2_normalize([qvec])[0]
    dn = es.l2_normalize(doc_vecs)
    return es.cosine_topk_obs_ids(qn, dn, doc_ids, k=k)


def _cross_encoder():
    from sentence_transformers import CrossEncoder
    from torch import nn
    ce = CrossEncoder(model_name=KHOJ_DEFAULT_CROSSENCODER)
    def rerank(query, ranked_ids, id2text, k=20):
        # Khoj cross_encoder_score: predict sigmoid scores over candidate pool,
        # sort by cross score (text_search.sort_results).
        cand = ranked_ids[:k]
        pairs = [[query, id2text[i]] for i in cand]
        scores = ce.predict(pairs, activation_fct=nn.Sigmoid())
        order = sorted(range(len(cand)), key=lambda j: -float(scores[j]))
        return [cand[j] for j in order]
    return rerank


def _score(retrieved, rel):
    return {
        "recall_at_5": es.recall(retrieved, rel, 5),
        "recall_at_10": es.recall(retrieved, rel, 10),
        "recall_at_20": es.recall(retrieved, rel, 20),
        "ndcg_at_10": es.ndcg_at_k(retrieved, rel, 10),
        "mrr": es.mrr(retrieved, rel),
    }


def _aggregate(per_query):
    return {
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
    }


def smoke():
    print("[smoke] building Khoj nomic/Ollama embedder ...", flush=True)
    embed_docs, embed_query, real = _make_khoj_openai_embedder()
    print(f"[smoke] used_real_khoj_class={real}", flush=True)
    ids = ["DOC_A", "DOC_B"]
    texts = ["The capital of France is Paris.",
             "Photosynthesis converts light into chemical energy in plants."]
    dvecs = embed_docs(texts)
    qv = embed_query("What is the capital of France?")
    ranked = cosine_topk(qv, dvecs, ids, k=2)
    print("[smoke] ranked doc_ids:", ranked, flush=True)
    assert ranked and ranked[0] == "DOC_A", f"expected DOC_A first, got {ranked}"
    print("[smoke] OK - top result is the relevant doc.")


def run_variant(name, embed_docs, embed_query, obs_ids, obs_texts, q_texts,
                q_rel, n_q, rerank=None):
    t0 = time.time()
    dvecs = embed_docs(list(obs_texts))
    ingest_s = time.time() - t0
    id2text = dict(zip(obs_ids, obs_texts))
    per_query = []
    for qi in range(n_q):
        qv = embed_query(q_texts[qi])
        retrieved = cosine_topk(qv, dvecs, obs_ids, k=20)
        if rerank is not None:
            retrieved = rerank(q_texts[qi], retrieved, id2text, k=20)
        m = _score(retrieved, q_rel[qi])
        m["query"] = q_texts[qi]
        m["relevant_count"] = len(q_rel[qi])
        m["retrieved_count"] = len(retrieved)
        per_query.append(m)
    agg = _aggregate(per_query)
    agg["ingest_seconds"] = round(ingest_s, 1)
    agg["per_query"] = per_query
    print(f"[{name}] R@5={agg['avg_recall_at_5']:.4f} "
          f"R@10={agg['avg_recall_at_10']:.4f} "
          f"R@20={agg['avg_recall_at_20']:.4f} "
          f"NDCG@10={agg['avg_ndcg_at_10']:.4f} "
          f"MRR={agg['avg_mrr']:.4f}", flush=True)
    return agg


def full():
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)

    # ── PRIMARY: Khoj default semantic search = bi-encoder cosine, nomic/Ollama ─
    embed_docs, embed_query, real = _make_khoj_openai_embedder()
    print(f"used_real_khoj_class={real}", flush=True)
    primary = run_variant("nomic-bi-encoder", embed_docs, embed_query,
                          obs_ids, obs_texts, q_texts, q_rel, n_q)

    secondaries = {}

    # ── SECONDARY A: nomic bi-encoder + Khoj cross-encoder rerank (chat flow) ──
    try:
        rr = _cross_encoder()
        secondaries["nomic_plus_mxbai_rerank"] = run_variant(
            "nomic+mxbai-rerank", embed_docs, embed_query, obs_ids, obs_texts,
            q_texts, q_rel, n_q, rerank=rr)
    except Exception as e:
        secondaries["nomic_plus_mxbai_rerank"] = {"error": f"{type(e).__name__}: {e}"}
        print("[nomic+rerank] skipped:", e, flush=True)

    # ── SECONDARY B: Khoj's SHIPPED default embedder gte-small (LOCAL ST) ──────
    try:
        ed2, eq2 = _make_khoj_local_embedder()
        secondaries["gte_small_default"] = run_variant(
            "gte-small-default", ed2, eq2, obs_ids, obs_texts, q_texts, q_rel, n_q)
    except Exception as e:
        secondaries["gte_small_default"] = {"error": f"{type(e).__name__}: {e}"}
        print("[gte-small] skipped:", e, flush=True)

    out = {
        "system": "Khoj",
        "khoj_version": _khoj_version(),
        "embedder": "nomic-embed-text",
        "dim": 768,
        "retrieval_type": "vector (bi-encoder cosine, nomic via Ollama /v1)",
        "retrieval_mode_audit": (
            "Khoj default /api/search is pure bi-encoder cosine top-k "
            "(text_search.query + EntryAdapters.search_with_embeddings, pgvector "
            "cosine). Cross-encoder rerank (mxbai-rerank-xsmall-v1) is optional "
            "and used in chat retrieval; reported as secondary. Headline uses "
            "nomic-embed-text via Khoj's OpenAI-compat embedding endpoint for "
            "apples-to-apples parity with the nomic-vector control."),
        "used_real_khoj_embeddingsmodel": real,
        "source": (
            "Khoj 1.42.10 semantic search: EmbeddingsModel(OpenAI endpoint -> "
            "Ollama /v1, nomic-embed-text 768-d) + normalize + cosine top-k "
            "(text_search.compute_embeddings/query), verbatim 1-entry-per-obs."),
        "avg_recall_at_5": primary["avg_recall_at_5"],
        "avg_recall_at_10": primary["avg_recall_at_10"],
        "avg_recall_at_20": primary["avg_recall_at_20"],
        "avg_ndcg_at_10": primary["avg_ndcg_at_10"],
        "avg_mrr": primary["avg_mrr"],
        "ingest_seconds": primary["ingest_seconds"],
        "n_obs": n_obs, "n_queries": n_q,
        "per_query": primary["per_query"],
        "secondaries": {
            k: {kk: vv for kk, vv in v.items() if kk != "per_query"}
            for k, v in secondaries.items()
        },
    }
    op = os.path.join(HERE, "khoj.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: Khoj (nomic-embed-text via Ollama, bi-encoder cosine) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print("(control nomic vector: Mem0 R@10 0.61 / Cognee 0.608 / sweep 0.558)")
    print("wrote", op)


def _khoj_version():
    try:
        import importlib.metadata as _m
        return _m.version("khoj")
    except Exception:
        return "unknown"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        smoke()
    else:
        full()
