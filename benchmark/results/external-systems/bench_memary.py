#!/usr/bin/env python3
"""Real retrieval bench of **Memary** (kingjulio8238/Memary — long-term agent
memory with a Neo4j knowledge graph) on the agentmemory 240-doc / 20-query
fixture.

Parity with the embedder sweep / Mem0 control: same fixture, same per-doc text
(title+subtitle+facts+narrative), same metric functions (imported from
../embedder-sweep/embedder_sweep.py), LLM + embeddings pinned to local Ollama
(triplet-extraction LLM = gemma3:1b — same as the Cognee/HippoRAG graph LLMs;
embedder = nomic-embed-text 768-d).

WHAT MEMARY ACTUALLY RETRIEVES (audited from memary/agent/base_agent.py):
Memary's local-knowledge retrieval is LlamaIndex's `KnowledgeGraphRAGRetriever`
(retriever_mode="keyword", synonym expansion) over a `Neo4jGraphStore`. Ingestion
is `KnowledgeGraphIndex.from_documents(..., max_triplets_per_chunk=N)`, which uses
the LLM to extract (subject -[predicate]-> object) triples and writes them to
Neo4j. At query time the retriever extracts key entities from the query, matches
them to graph nodes, traverses 1-2 hops, and returns ONE synthesized node whose
`metadata["kg_rel_map"]` is `{subject: [[predicate, object], ...]}`.

=> Memary returns ENTITIES + a relation subgraph, NOT ranked source passages, and
   carries NO doc_id. It is an agent-context retriever, not a passage ranker.
   (Verified live: query "What is the capital of France?" -> kg_rel_map
   {'Paris': [['IS_CAPITAL_OF','France'], ['SITS_ON','Seine river']]}.)

FAITHFUL doc-ranking adapter (the only way to score recall@k over the fixture):
We map the entities Memary surfaces for a query back to the source observations
whose text contains them, and rank docs by entity overlap. This uses EXACTLY the
signal Memary produces (its KG-retrieved entities) — no extra retriever is bolted
on. It is the entity analogue of the HippoRAG/Cognee "expand ranked unit -> its 5
doc_ids" step (the fixture is 48 distinct texts x5 sessions = 240 obs).

PLATFORM: Memary hard-requires a Neo4j graph DB. We run an ISOLATED Neo4j 5.26
container (bolt://localhost:7688, neo4j/memarybench) so we never touch other
running benches' graphs. Memary's synonym_expand fn hardcodes a langchain OpenAI
LLM; we port it verbatim to local Ollama (gemma3:1b) to keep everything local.

Sanity anchor (nomic pure-vector on THIS corpus): R@5 0.406 / R@10 0.558 /
R@20 0.767. Mem0/Letta/Cognee land on the nomic vector control (~R@10 0.61).
A keyword-KG agent memory is EXPECTED to score lower: keyword entity matching is
sparse vs dense vectors, and a 1B triplet-extraction LLM is noisy. That gap is the
honest finding, not a bug.

Usage:
  python bench_memary.py --smoke        # 2-doc + 1-query reproduce-first check
  python bench_memary.py --subset 12    # timed subset (12 unique texts)
  python bench_memary.py                # full 240-doc / 20-query run
"""
import os, sys, json, time, re, argparse
from typing import List

# ── Neo4j (isolated) + Ollama config ─────────────────────────────────────────
NEO4J_URL = os.environ.get("MEMARY_NEO4J_URL", "bolt://localhost:7688")
NEO4J_USER = "neo4j"
NEO4J_PW = os.environ.get("MEMARY_NEO4J_PW", "memarybench")
OLLAMA = "http://127.0.0.1:11434"
LLM_MODEL = "gemma3:1b"          # triplet-extraction + keyword/synonym LLM (parity w/ Cognee/HippoRAG)
EMB_MODEL = "nomic-embed-text"   # 768-d, parity w/ sweep + Mem0
MAX_TRIPLETS = 8                 # memary base_agent.write_back default

os.environ["NEO4J_URL"] = NEO4J_URL
os.environ["NEO4J_PW"] = NEO4J_PW
os.environ["NEO4J_USERNAME"] = NEO4J_USER

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "embedder-sweep")
sys.path.insert(0, SWEEP)
import embedder_sweep as es  # load_corpus, recall, ndcg_at_k, mrr, avg

from llama_index.core import (KnowledgeGraphIndex, Settings, StorageContext, Document)
from llama_index.core.retrievers import KnowledgeGraphRAGRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.graph_stores.neo4j import Neo4jGraphStore
from langchain_community.llms import Ollama as LCOllama
from langchain.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from memary.synonym_expand.output import Output


def custom_synonym_expand_fn(keywords: str) -> List[str]:
    """Memary's synonym expansion (memary/synonym_expand/synonym.py) ported
    VERBATIM to local Ollama (gemma3:1b). Graceful fallback to no synonyms —
    the keyword KG retriever works fine without them."""
    try:
        llm = LCOllama(model=LLM_MODEL, base_url=OLLAMA, temperature=0)
        parser = JsonOutputParser(pydantic_object=Output)
        template = (
            "You are an expert synonym exapnding system. Find synonyms or words "
            "commonly used in place to reference the same word for every word in the list:\n\n"
            "Some examples are:\n"
            "- a synonym for Palantir may be Palantir technologies or Palantir technologies inc.\n"
            "- a synonym for Austin may be Austin texas\n\n"
            "Format: {format_instructions}\n\nText: {keywords}\n"
        )
        prompt = PromptTemplate(template=template, input_variables=["keywords"],
                                partial_variables={"format_instructions": parser.get_format_instructions()})
        chain = prompt | llm | parser
        result = chain.invoke({"keywords": keywords})
        out = []
        for category in result:
            for synonym in result[category]:
                out.append(str(synonym).capitalize())
        return out
    except Exception:
        return []


def configure(reset=True):
    Settings.llm = Ollama(model=LLM_MODEL, request_timeout=180.0, base_url=OLLAMA)
    Settings.embed_model = OllamaEmbedding(model_name=EMB_MODEL, base_url=OLLAMA)
    Settings.chunk_size = 512
    gs = Neo4jGraphStore(username=NEO4J_USER, password=NEO4J_PW, url=NEO4J_URL, database="neo4j")
    if reset:
        gs.query("MATCH (n) DETACH DELETE n")
    sc = StorageContext.from_defaults(graph_store=gs)
    return gs, sc


def build_kg(sc, pairs):
    docs = [Document(text=t, metadata={"doc_id": did}) for did, t in pairs]
    KnowledgeGraphIndex.from_documents(
        docs, storage_context=sc, max_triplets_per_chunk=MAX_TRIPLETS,
        include_embeddings=False,
    )


def make_retriever(sc):
    retr = KnowledgeGraphRAGRetriever(
        storage_context=sc, verbose=False, llm=Settings.llm,
        retriever_mode="keyword", synonym_expand_fn=custom_synonym_expand_fn,
    )
    return retr


_WORD = re.compile(r"[A-Za-z0-9]+")


def _norm_tokens(s):
    return [w.lower() for w in _WORD.findall(s or "")]


def entities_from_nodes(nodes):
    """Collect the entity surface forms Memary surfaced for the query: the
    kg_rel_map subjects + their connected objects (the retrieved subgraph)."""
    ents = []
    for n in nodes:
        md = getattr(n.node, "metadata", None) or {}
        rel_map = md.get("kg_rel_map") or {}
        for subj, rels in rel_map.items():
            ents.append(subj)
            for r in rels:
                # r == [predicate, object] (object is the next-hop entity)
                if isinstance(r, (list, tuple)) and len(r) >= 2:
                    ents.append(r[-1])
    # de-dup preserving order
    seen, out = set(), []
    for e in ents:
        k = (e or "").strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(e)
    return out


def build_entity_index(uniq):
    """For each unique text, the set of word-tokens it contains, so an entity
    'maps to' a doc iff every token of the entity surface appears in that doc."""
    doc_tokens = []
    for rep_id, text in uniq:
        doc_tokens.append((rep_id, set(_norm_tokens(text))))
    return doc_tokens


def rank_unique_docs(entities, doc_tokens):
    """Rank unique docs by how many retrieved entities they contain. An entity
    matches a doc iff all of the entity's tokens are present in the doc."""
    ent_tok = [(_norm_tokens(e)) for e in entities]
    ent_tok = [t for t in ent_tok if t]
    scores = []
    for rep_id, toks in doc_tokens:
        sc = 0
        for et in ent_tok:
            if all(w in toks for w in et):
                sc += 1
        scores.append((sc, rep_id))
    # keep only docs with >=1 entity match, best first; stable global order on ties
    ordered = sorted(
        [(s, i, rid) for i, (s, rid) in enumerate(scores)],
        key=lambda t: (-t[0], t[1]))
    return [rid for s, i, rid in ordered if s > 0]


def smoke():
    print("[smoke] configuring memary KG (ollama llm+embed, isolated neo4j) ...", flush=True)
    gs, sc = configure(reset=True)
    pairs = [
        ("DOC_A", "The capital of France is Paris. Paris sits on the Seine river."),
        ("DOC_B", "Photosynthesis converts light into chemical energy in green plants."),
    ]
    t0 = time.time()
    build_kg(sc, pairs)
    print(f"[smoke] KG built {time.time()-t0:.1f}s", flush=True)
    retr = make_retriever(sc)
    nodes = retr.retrieve("What is the capital of France?")
    ents = entities_from_nodes(nodes)
    print("[smoke] retrieved entities:", ents)
    doc_tokens = build_entity_index([(d, t) for d, t in pairs])
    ranked = rank_unique_docs(ents, doc_tokens)
    print("[smoke] ranked doc_ids:", ranked)
    assert ranked and ranked[0] == "DOC_A", f"expected DOC_A first, got {ranked}; ents={ents}"
    print("[smoke] OK — Memary's KG entities map to the relevant doc.")


def full(limit=None):
    obs_ids, obs_texts, q_texts, q_rel, n_obs, n_q = es.load_corpus()
    # dedup identical texts (48 distinct x5 sessions = 240 obs); expand back later.
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
    print(f"corpus: {n_obs} obs, {n_q} queries, {len(uniq)} unique texts to ingest", flush=True)

    gs, sc = configure(reset=True)
    t0 = time.time()
    # Build KG one doc at a time (progress + isolates a bad-extraction doc).
    for i, (rep_id, text) in enumerate(uniq):
        build_kg(sc, [(rep_id, text)])
        if (i + 1) % 10 == 0:
            print(f"  KG-ingested {i+1}/{len(uniq)} ({time.time()-t0:.0f}s)", flush=True)
    ingest_s = time.time() - t0
    print(f"  KG build done ({ingest_s:.0f}s)", flush=True)

    doc_tokens = build_entity_index(uniq)
    retr = make_retriever(sc)

    per_query = []
    t1 = time.time()
    for qi in range(n_q):
        nodes = retr.retrieve(q_texts[qi])
        ents = entities_from_nodes(nodes)
        ranked_reps = rank_unique_docs(ents, doc_tokens)
        # expand each ranked unique text to its obs_ids (global order), truncate 20+
        retrieved, seen = [], set()
        for rep in ranked_reps:
            for oid in rep_to_ids.get(rep, [rep]):
                if oid not in seen:
                    seen.add(oid)
                    retrieved.append(oid)
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
            "entities_retrieved": len(ents),
        })
    retr_s = time.time() - t1

    out = {
        "system": "Memary",
        "embedder": "nomic-embed-text",
        "dim": 768,
        "retrieval_type": "knowledge graph (LlamaIndex KnowledgeGraphRAGRetriever, keyword mode + synonym expansion, over Neo4j)",
        "graph_llm": LLM_MODEL,
        "source": ("Memary 0.1.3 (kingjulio8238/Memary): KnowledgeGraphIndex triplet "
                   "extraction via gemma3:1b -> Neo4j 5.26; KnowledgeGraphRAGRetriever "
                   "keyword retrieval returns a kg_rel_map subgraph of entities/relations. "
                   "Synonym-expand fn ported from langchain-OpenAI to local Ollama."),
        "doc_mapping_note": ("Memary returns ENTITIES + a relation subgraph, not ranked "
                             "passages and no doc_id. We rank source obs by overlap with the "
                             "entities Memary surfaces per query (entity matches a doc iff all "
                             "its tokens appear in the doc), then expand each unique text to its "
                             "5 obs_ids (48 distinct x5 = 240). Uses only Memary's own KG signal."),
        "avg_recall_at_5": es.avg([q["recall_at_5"] for q in per_query]),
        "avg_recall_at_10": es.avg([q["recall_at_10"] for q in per_query]),
        "avg_recall_at_20": es.avg([q["recall_at_20"] for q in per_query]),
        "avg_ndcg_at_10": es.avg([q["ndcg_at_10"] for q in per_query]),
        "avg_mrr": es.avg([q["mrr"] for q in per_query]),
        "ingest_seconds": round(ingest_s, 1),
        "retrieve_seconds": round(retr_s, 1),
        "n_obs": n_obs, "n_queries": n_q, "n_unique_ingested": len(uniq),
        "subset": bool(limit),
        "per_query": per_query,
    }
    op = os.path.join(HERE, "memary.json")
    with open(op, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== RESULT: Memary (knowledge graph, keyword KG retrieval) ===")
    print(f"R@5 ={out['avg_recall_at_5']:.4f}")
    print(f"R@10={out['avg_recall_at_10']:.4f}")
    print(f"R@20={out['avg_recall_at_20']:.4f}")
    print(f"NDCG@10={out['avg_ndcg_at_10']:.4f}")
    print(f"MRR ={out['avg_mrr']:.4f}")
    print("(anchor nomic pure-vector: R@5 0.406 / R@10 0.558 / R@20 0.767; Mem0/Letta/Cognee control R@10 ~0.61)")
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
