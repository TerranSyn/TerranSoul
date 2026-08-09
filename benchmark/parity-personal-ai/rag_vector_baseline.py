"""Out-of-the-box vector-RAG baseline on the agentmemory bench corpus.

Runs LangChain's default retriever (OllamaEmbeddings `nomic-embed-text` + an
InMemoryVectorStore, top-k cosine) over the SAME corpus (240 observations /
20 queries) and the SAME recall@k formula as internal module:
    recall@k = |relevant ∩ top_k| / |relevant|

This is the plain vector retrieval that LangChain / LlamaIndex / Haystack / RAGFlow
all ship by default (they wrap the same embedder), so the number represents their
default-retrieval floor. GraphRAG's graph/community retrieval is a different
paradigm (it doesn't return document-ranked obs IDs) and isn't on this metric.

Falls back to calling Ollama's /api/embeddings directly (identical computation)
if langchain isn't importable.
"""
import json, sys, math, urllib.request

FIX = "internal module.json"
OUT = "benchmark/results/rag_vector_baseline.json"
OLLAMA = "http://127.0.0.1:11434"
EMB = "nomic-embed-text"

def obs_text(o):
    parts = [o.get("title", ""), o.get("subtitle", "")] + (o.get("facts") or [])
    if o.get("narrative"):
        parts.append(o["narrative"])
    return " ".join(p for p in parts if p)

def recall(ranked_ids, relevant, k):
    if not relevant:
        return 1.0
    top = set(ranked_ids[:k])
    return sum(1 for r in relevant if r in top) / len(relevant)

def cos(a, b):
    s = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)); nb = math.sqrt(sum(y * y for y in b))
    return s / (na * nb + 1e-9)

def direct_embed(text):
    req = urllib.request.Request(OLLAMA + "/api/embeddings",
        data=json.dumps({"model": EMB, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["embedding"]

def main():
    fx = json.load(open(FIX, encoding="utf-8"))
    obs, queries = fx["observations"], fx["queries"]
    ids = [o["id"] for o in obs]
    texts = [obs_text(o) for o in obs]

    via = "langchain"
    try:
        from langchain_ollama import OllamaEmbeddings
        emb = OllamaEmbeddings(model=EMB)
        sys.stderr.write("embedding %d observations via LangChain OllamaEmbeddings...\n" % len(obs))
        ovecs = emb.embed_documents(texts)
        embed_q = emb.embed_query
    except Exception as e:
        via = "direct-ollama"
        sys.stderr.write("langchain unavailable (%s); direct ollama embeddings (identical)\n" % e)
        ovecs = [direct_embed(t) for t in texts]
        embed_q = direct_embed

    r5 = r10 = r20 = 0.0
    for q in queries:
        qv = embed_q(q["query"])
        order = sorted(range(len(obs)), key=lambda i: cos(qv, ovecs[i]), reverse=True)
        ranked = [ids[i] for i in order]
        rel = set(q.get("relevantObsIds") or [])
        r5 += recall(ranked, rel, 5); r10 += recall(ranked, rel, 10); r20 += recall(ranked, rel, 20)
    n = len(queries)
    out = {
        "system": "vector RAG (LangChain default, nomic-embed-text)",
        "via": via, "embedder": EMB, "observations": len(obs), "queries": n,
        "avg_recall_at_5": r5 / n, "avg_recall_at_10": r10 / n, "avg_recall_at_20": r20 / n,
        "note": "Plain vector top-k retrieval (LangChain OllamaEmbeddings + InMemoryVectorStore default). Same recall formula + corpus as internal module. Represents the default vector retrieval shared by LangChain/LlamaIndex/Haystack/RAGFlow; GraphRAG's graph retrieval is a different paradigm not on this metric.",
    }
    print(json.dumps(out, indent=2))
    json.dump(out, open(OUT, "w"), indent=2)

main()
