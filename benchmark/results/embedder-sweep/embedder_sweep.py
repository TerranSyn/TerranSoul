#!/usr/bin/env python3
"""
TerranSoul embedder sweep — pure-vector retrieval head-to-head.

Measures several embedders on the SAME corpus to find the best one for
TerranSoul's vector/hybrid retrieval. Pure-vector isolates the embedder:
  L2-normalize embeddings -> cosine top-k -> recall@5/10/20, NDCG@10, MRR.

Metric formulas are copied EXACTLY from
  internal module  (recall/ndcg_at_k/mrr).

obs text (per task spec):
  title + " " + subtitle + " " + facts.join(" ") + " " + (narrative||"")

Two backends:
  - "ollama": pull via POST /api/pull, embed via POST /api/embed (batched).
  - "st"    : sentence-transformers local CPU encode (normalize handled here).

Usage:
  python embedder_sweep.py ollama  <model_tag>  [--name NAME] [--dim N]
  python embedder_sweep.py st      <hf_id>      [--name NAME] [--dim N]
  python embedder_sweep.py summarize          # build ranked summary.json from per-model files

Outputs (this dir):
  <name>.json         per-model metrics + per-query + meta
  summary.json        ranked table (sorted by R@10)
"""
import sys, os, json, time, math, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = r"internal module.json"
OLLAMA = "http://127.0.0.1:11434"

# ── Fixture / text construction ──────────────────────────────────────────────

def load_corpus():
    with open(FIXTURE, "r", encoding="utf-8") as f:
        d = json.load(f)
    obs = d["observations"]
    obs_ids, obs_texts = [], []
    for o in obs:
        title = o.get("title", "") or ""
        subtitle = o.get("subtitle", "") or ""
        facts = " ".join(o.get("facts", []) or [])
        narrative = o.get("narrative", "") or ""
        # EXACT spec: title+" "+subtitle+" "+facts.join(" ")+" "+(narrative||"")
        text = f"{title} {subtitle} {facts} {narrative}"
        obs_ids.append(o["id"])
        obs_texts.append(text)
    queries = d["queries"]
    q_texts = [q["query"] for q in queries]
    q_rel = [set(q["relevantObsIds"]) for q in queries]
    return obs_ids, obs_texts, q_texts, q_rel, len(obs), len(queries)

# ── IR metrics (mirror internal module exactly) ────────────────────────────

def recall(retrieved, relevant, k):
    if not relevant:
        return 1.0
    top = set(retrieved[:k])
    hits = sum(1 for r in relevant if r in top)
    return hits / len(relevant)

def ndcg_at_k(retrieved, relevant, k):
    actual = [(rid in relevant) for rid in retrieved[:k]]
    ideal_count = min(len(relevant), k)
    def dcg(rels):
        return sum((1.0 / math.log2(i + 2)) if r else 0.0 for i, r in enumerate(rels))
    idcg = dcg([True] * ideal_count)
    if idcg == 0.0:
        return 0.0
    return dcg(actual) / idcg

def mrr(retrieved, relevant):
    for i, rid in enumerate(retrieved):
        if rid in relevant:
            return 1.0 / (i + 1)
    return 0.0

def avg(xs):
    return sum(xs) / len(xs) if xs else 0.0

# ── Vector math ──────────────────────────────────────────────────────────────

def l2_normalize(vecs):
    out = []
    for v in vecs:
        n = math.sqrt(sum(x * x for x in v))
        out.append([x / n for x in v] if n > 0 else list(v))
    return out

def cosine_topk_obs_ids(qvec, obs_vecs, obs_ids, k=20):
    # vectors are L2-normalized -> dot == cosine
    scores = []
    for i, ov in enumerate(obs_vecs):
        s = 0.0
        for a, b in zip(qvec, ov):
            s += a * b
        scores.append((s, obs_ids[i]))
    scores.sort(key=lambda t: t[0], reverse=True)
    return [oid for _, oid in scores[:k]]

# ── Ollama backend ───────────────────────────────────────────────────────────

def http_post(path, payload, timeout=600):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def ollama_pull(model, timeout=1800):
    print(f"[pull] {model} ...", flush=True)
    data = json.dumps({"model": model, "stream": True}).encode("utf-8")
    req = urllib.request.Request(OLLAMA + "/api/pull", data=data,
                                 headers={"Content-Type": "application/json"})
    last = ""
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            st = ev.get("status", "")
            if "error" in ev:
                raise RuntimeError("pull error: " + ev["error"])
            if st != last:
                print(f"   [{time.time()-t0:6.1f}s] {st}", flush=True)
                last = st
            if st == "success":
                break
    print(f"[pull] {model} done in {time.time()-t0:.1f}s", flush=True)

def ollama_embed_batch(model, texts, timeout=900):
    # /api/embed supports list input. Returns {"embeddings":[[...],...]}
    out = http_post("/api/embed", {"model": model, "input": texts}, timeout=timeout)
    embs = out.get("embeddings")
    if not embs:
        raise RuntimeError("no embeddings returned: " + json.dumps(out)[:300])
    return embs

def ollama_embed_all(model, texts, batch=16):
    res = []
    for i in range(0, len(texts), batch):
        chunk = texts[i:i+batch]
        res.extend(ollama_embed_batch(model, chunk))
        print(f"   embedded {min(i+batch,len(texts))}/{len(texts)}", flush=True)
    return res

# ── sentence-transformers backend ────────────────────────────────────────────

def st_embed_all(hf_id, obs_texts, q_texts):
    from sentence_transformers import SentenceTransformer
    print(f"[st] loading {hf_id} ...", flush=True)
    t0 = time.time()
    m = SentenceTransformer(hf_id, device="cpu")
    print(f"[st] loaded in {time.time()-t0:.1f}s", flush=True)
    t0 = time.time()
    ov = m.encode(obs_texts, batch_size=32, show_progress_bar=False,
                  normalize_embeddings=False, convert_to_numpy=True)
    qv = m.encode(q_texts, batch_size=32, show_progress_bar=False,
                  normalize_embeddings=False, convert_to_numpy=True)
    dt = time.time() - t0
    return ([list(map(float, r)) for r in ov],
            [list(map(float, r)) for r in qv], dt)

# ── Evaluation core ──────────────────────────────────────────────────────────

def evaluate(name, dim, source, obs_ids, obs_vecs, q_vecs, q_texts, q_rel, embed_secs):
    obs_n = l2_normalize(obs_vecs)
    q_n = l2_normalize(q_vecs)
    per_query = []
    r5 = r10 = r20 = nd = mr = 0.0
    for qi in range(len(q_texts)):
        retrieved = cosine_topk_obs_ids(q_n[qi], obs_n, obs_ids, k=20)
        rel = q_rel[qi]
        m = {
            "query": q_texts[qi],
            "recall_at_5": recall(retrieved, rel, 5),
            "recall_at_10": recall(retrieved, rel, 10),
            "recall_at_20": recall(retrieved, rel, 20),
            "ndcg_at_10": ndcg_at_k(retrieved, rel, 10),
            "mrr": mrr(retrieved, rel),
            "relevant_count": len(rel),
        }
        per_query.append(m)
    return {
        "embedder": name,
        "dim": dim,
        "source": source,
        "avg_recall_at_5": avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": avg([q["mrr"] for q in per_query]),
        "embed_seconds_total": round(embed_secs, 2),
        "embed_ms_per_text": round(embed_secs * 1000.0 / max(1, len(obs_ids) + len(q_texts)), 2),
        "n_obs": len(obs_ids),
        "n_queries": len(q_texts),
        "per_query": per_query,
    }

def run_model(backend, model, name, dim_override, query_prefix="", doc_prefix="", truncate_dim=None):
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = load_corpus()
    print(f"corpus: {n_obs} obs, {n_q} queries", flush=True)
    # Many retrieval embedders REQUIRE task-specific prompt prefixes (asymmetric
    # query vs document). Apply them to the embedding inputs only; the original
    # q_texts are kept for per-query labels. Empty prefixes => symmetric/no-prefix.
    if query_prefix or doc_prefix:
        print(f"prefixes: query={query_prefix!r}  doc={doc_prefix!r}", flush=True)
    obs_texts_emb = [doc_prefix + t for t in obs_texts]
    q_texts_emb = [query_prefix + t for t in q_texts]
    if backend == "ollama":
        ollama_pull(model)
        t0 = time.time()
        obs_vecs = ollama_embed_all(model, obs_texts_emb)
        q_vecs = ollama_embed_all(model, q_texts_emb)
        dt = time.time() - t0
        dim = len(obs_vecs[0])
        source = "Ollama"
    elif backend == "st":
        obs_vecs, q_vecs, dt = st_embed_all(model, obs_texts_emb, q_texts_emb)
        dim = len(obs_vecs[0])
        source = "ST"
    else:
        raise SystemExit("backend must be ollama|st")
    # Matryoshka (MRL) truncation: keep the leading N dims, then re-normalize
    # (evaluate() normalizes). EmbeddingGemma / nomic / Qwen3 support this.
    if truncate_dim and truncate_dim < len(obs_vecs[0]):
        obs_vecs = [v[:truncate_dim] for v in obs_vecs]
        q_vecs = [v[:truncate_dim] for v in q_vecs]
        dim = truncate_dim
    if dim_override:
        dim = dim_override
    res = evaluate(name, dim, source, obs_ids, obs_vecs, q_vecs, q_texts, q_rel, dt)
    res["query_prefix"] = query_prefix
    res["doc_prefix"] = doc_prefix
    res["truncate_dim"] = truncate_dim
    res["model_tag"] = model
    out_path = os.path.join(HERE, f"{name}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    print("\n=== RESULT:", name, "===")
    print(f"dim={res['dim']} source={res['source']}")
    print(f"R@5 ={res['avg_recall_at_5']:.4f}")
    print(f"R@10={res['avg_recall_at_10']:.4f}")
    print(f"R@20={res['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={res['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={res['avg_mrr']:.4f}")
    print(f"embed: {res['embed_seconds_total']}s total, {res['embed_ms_per_text']}ms/text")
    print("wrote", out_path)
    return res

def summarize():
    rows = []
    for fn in os.listdir(HERE):
        if fn.endswith(".json") and fn not in ("summary.json",):
            with open(os.path.join(HERE, fn), "r", encoding="utf-8") as f:
                try:
                    d = json.load(f)
                except Exception:
                    continue
            if "avg_recall_at_10" in d:
                rows.append({
                    "embedder": d["embedder"],
                    "model_tag": d.get("model_tag", ""),
                    "dim": d["dim"],
                    "source": d["source"],
                    "R@5": round(d["avg_recall_at_5"], 4),
                    "R@10": round(d["avg_recall_at_10"], 4),
                    "R@20": round(d["avg_recall_at_20"], 4),
                    "NDCG@10": round(d["avg_ndcg_at_10"], 4),
                    "MRR": round(d["avg_mrr"], 4),
                    "embed_ms_per_text": d.get("embed_ms_per_text"),
                })
    rows.sort(key=lambda r: r["R@10"], reverse=True)
    summary = {
        "metric": "pure-vector retrieval (L2-normalize -> cosine top-k); averaged over 20 queries",
        "formulas_source": "internal module",
        "corpus": "memory_quality_fixture.json (240 obs, 20 queries; ~48 distinct contents x5 sessions)",
        "lexical_baseline_cited": {"R@5": 0.45, "R@10": 0.67, "R@20": 0.80,
                                    "note": "TerranSoul lexical keyword baseline, embedder-independent (provided)"},
        "ranked_by": "R@10",
        "rows": rows,
    }
    out = os.path.join(HERE, "summary.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print("\n=== RANKED (by R@10) ===")
    hdr = f"{'embedder':<34}{'dim':>5}{'R@5':>8}{'R@10':>8}{'R@20':>8}{'NDCG@10':>9}{'MRR':>8}{'src':>8}"
    print(hdr)
    for r in rows:
        print(f"{r['embedder']:<34}{r['dim']:>5}{r['R@5']:>8.3f}{r['R@10']:>8.3f}{r['R@20']:>8.3f}{r['NDCG@10']:>9.3f}{r['MRR']:>8.3f}{r['source']:>8}")
    print(f"\n{'LEXICAL baseline (cited)':<34}{'-':>5}{0.45:>8.3f}{0.67:>8.3f}{0.80:>8.3f}{'-':>9}{'-':>8}{'lex':>8}")
    print("wrote", out)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "summarize":
        summarize(); sys.exit(0)
    backend = cmd
    model = sys.argv[2]
    name = model.replace("/", "_").replace(":", "_")
    dim_override = None
    query_prefix = ""
    doc_prefix = ""
    truncate_dim = None
    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == "--name":
            name = sys.argv[i+1]; i += 2
        elif sys.argv[i] == "--dim":
            dim_override = int(sys.argv[i+1]); i += 2
        elif sys.argv[i] == "--query-prefix":
            query_prefix = sys.argv[i+1]; i += 2
        elif sys.argv[i] == "--doc-prefix":
            doc_prefix = sys.argv[i+1]; i += 2
        elif sys.argv[i] == "--truncate-dim":
            truncate_dim = int(sys.argv[i+1]); i += 2
        else:
            i += 1
    run_model(backend, model, name, dim_override, query_prefix, doc_prefix, truncate_dim)
