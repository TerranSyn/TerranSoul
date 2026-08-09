#!/usr/bin/env python3
"""obsidian-wiki AGENTIC-GREP retrieval bench on the **LOCAL gemma4:12b-it-qat**
model (ollama), over the SAME 240-obs/20-query corpus + SAME scorer as the
embedder-sweep / GENesis-AGI / OpenJarvis / Hermes comparison rows.

WHY LOCAL gemma, not `claude -p`:  the comparison table's other rows
(OpenJarvis, Hermes, the parity rows) all run the LOCAL gemma4:12b-it-qat.
The earlier obsidian-wiki agentic attempt used `claude -p` (a cloud frontier
model), which would unfairly inflate obsidian-wiki's recall versus the
local-model rows.  This driver reproduces obsidian-wiki's *grep-then-LLM*
mechanism faithfully but on the SAME local model the other rows use, so the
number is apples-to-apples.

obsidian-wiki ships NO programmatic ranked retrieval; its real "engine" is an
LLM coding agent that READS .skills/wiki-query/SKILL.md and executes it by hand
with Grep/Read over a plain-markdown Obsidian vault.  We reproduce exactly that
modality, split into the two faithful steps the SKILL describes:

  1. GREP step (obsidian-wiki's ripgrep Index/Content pass): REAL ripgrep over
     the materialized 240-page vault for the query's key terms -> candidate page
     ids + a matched snippet per page.  Pure keyword grep -- NO synonym/concept
     seeding, NO embeddings -- exactly obsidian-wiki's keyword mechanism (and its
     real limitation: a page that does not literally contain a query term is
     never surfaced).
  2. RANK step (the agent's "read the promising pages and rank"):  ONE
     ollama /api/chat call to gemma4:12b-it-qat (low temp) that ranks/selects the
     most-relevant ids FROM THE GREP CANDIDATES -> ranked top-20.

  3. SCORE with embedder_sweep.py's EXACT metric fns (recall/ndcg_at_k/mrr) --
     the same scorer the vector rows use.

The vault is byte-identical to the scaling bench (we REUSE
bench_obsidian_wiki.materialize_vault).  The grep scan is O(n) and does NOT scale
(see bench_obsidian_wiki.py: 42.8 ms@240 -> 666 ms@24k).

Usage:
  python obsidian_wiki_agentic_local.py materialize
  python obsidian_wiki_agentic_local.py run [--limit N] [--endpoint URL]
  python obsidian_wiki_agentic_local.py score
"""
import sys, os, json, time, re, subprocess, statistics, shutil

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
# Repo root = three levels up from benchmark/results/external-systems
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURE = os.path.join(ROOT, "the application repository", "benches", "memory_quality_fixture.json")
VAULT = os.path.join(HERE, ".obsidian_wiki_agentic_local_vault")
RANKINGS_PATH = os.path.join(HERE, "obsidian_wiki_agentic_local_rankings.json")
RESULT_PATH = os.path.join(HERE, "obsidian_wiki_agentic.json")

# Import the EXACT scorer fns (do NOT reimplement).
sys.path.insert(0, os.path.join(ROOT, "benchmark", "results", "embedder-sweep"))
from embedder_sweep import recall, ndcg_at_k, mrr, avg  # noqa: E402

# Reuse the obsidian-wiki vault materialization (byte-identical to the scaling
# bench) so this recall row and the latency/scaling row use the SAME vault.
sys.path.insert(0, HERE)
from bench_obsidian_wiki import materialize_vault, load_fixture  # noqa: E402

MODEL = "gemma4:12b-it-qat"
ENDPOINT = "http://localhost:11434"

RG = shutil.which("rg")
assert RG, "ripgrep (rg) is required -- it is what the host agents' Grep tool maps to"

# Generic English stopwords only -- NOT a domain/curated vocabulary. Used solely
# to turn a natural-language query into the keyword set a grep would search for.
STOP = {
    "the", "and", "for", "are", "was", "were", "did", "does", "how", "what",
    "why", "who", "when", "where", "which", "with", "from", "into", "this",
    "that", "these", "those", "our", "out", "set", "use", "used", "using",
    "have", "has", "had", "you", "your", "they", "them", "their", "can",
    "could", "would", "should", "about", "any", "all", "via", "get", "got",
}


def materialize():
    observations, _queries = load_fixture()
    n_pages, ingest_s, vault = materialize_vault(observations, 1, VAULT)
    print(f"materialized obsidian vault: {n_pages} pages in {ingest_s:.2f}s -> {vault}")
    print(f"  index.md bytes = {os.path.getsize(os.path.join(vault, 'index.md'))}")


# ── GREP step (obsidian-wiki ripgrep Index/Content pass) ──────────────────────

def query_terms(query):
    """Generic keyword extraction (lowercase, drop punctuation, >=3 chars,
    minus generic stopwords). No synonym/concept expansion -- pure keyword grep,
    exactly obsidian-wiki's mechanism (and its limitation)."""
    toks = re.findall(r"[a-z0-9]+", query.lower())
    terms = [t for t in toks if len(t) >= 3 and t not in STOP]
    # de-dup preserve order
    seen, out = set(), []
    for t in terms:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _rg_files(term, pages):
    """Pages whose CONTENT matches `term` (case-insensitive). `rg -il` prints one
    full path per line -- we take the basename stem as the page id (robust on
    Windows, where a 'path:line' split would break on the drive-letter colon)."""
    cmd = [RG, "-il", "--path-separator", "/", "-e", term, pages]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    ids = []
    for line in p.stdout.splitlines():
        line = line.strip()
        if line:
            ids.append(os.path.splitext(os.path.basename(line))[0])
    return ids


def _page_snippet(vault, pid, terms):
    """title - summary (from frontmatter) + the first body line that contains a
    query term -- the bit of the page an agent would skim to judge relevance."""
    fpath = os.path.join(vault, "pages", f"{pid}.md")
    title = summary = ""
    matched = ""
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s.startswith("title:") and not title:
                    title = s.split(":", 1)[1].strip().strip('"')
                elif s.startswith("summary:") and not summary:
                    summary = s.split(":", 1)[1].strip().strip('"')
                elif not matched and not s.startswith(("---", "title:", "id:", "tags:",
                        "summary:", "tier:", "lifecycle:", "base_confidence:",
                        "relationships:", "- type:", "target:")):
                    low = s.lower()
                    if any(t in low for t in terms):
                        matched = s
    except Exception:
        pass
    parts = [p for p in (title, summary) if p]
    head = " - ".join(parts)
    if matched and matched not in head:
        head = (head + " | " + matched) if head else matched
    return head[:200]


def grep_candidates(vault, query, max_candidates=50):
    """REAL ripgrep over pages/ for the query's key terms.  Returns a list of
    (page_id, n_terms_matched, snippet) ranked by how many DISTINCT query terms a
    page matches -- the agent's "read the most promising pages" ordering.  Pages
    with NO literal term match are never surfaced (obsidian-wiki's real
    keyword-grep limitation)."""
    pages = os.path.join(vault, "pages")
    terms = query_terms(query)
    if not terms:
        return [], terms
    per_page = {}  # pid -> set(terms matched)
    for t in terms:
        for pid in _rg_files(t, pages):
            per_page.setdefault(pid, set()).add(t)
    # rank by distinct-term coverage, tie-break by page id (deterministic)
    ranked = sorted(per_page.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:max_candidates]
    cands = []
    for pid, tset in ranked:
        cands.append((pid, len(tset), _page_snippet(vault, pid, terms)))
    return cands, terms


# ── RANK step (gemma4:12b-it-qat over the grep candidates) ────────────────────

RANK_PROMPT = """You are the retrieval/ranking layer of "obsidian-wiki", a markdown knowledge vault. A keyword grep over the vault for the query has already surfaced the candidate pages below (id -- summary/snippet). Each page id is in obs_ses_XXX_YY form.

Query: "{query}"

Candidate pages (from the grep):
{candidates}

Rank the candidate pages from MOST to LEAST relevant to the query. Choose ONLY from the candidate ids above; do not invent ids. Return the most relevant first, up to 20 ids.

Respond with ONLY a JSON object of the form: {{"ranked_ids": ["obs_ses_XXX_YY", ...]}}"""


def ollama_rank(query, cands, endpoint, timeout=180):
    lines = [f"- {pid}: {snip}" if snip else f"- {pid}" for pid, _s, snip in cands]
    prompt = RANK_PROMPT.format(query=query, candidates="\n".join(lines))
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.0, "num_ctx": 16384, "num_predict": 512},
    }
    t0 = time.time()
    r = requests.post(f"{endpoint}/api/chat", json=body, timeout=timeout)
    dt = time.time() - t0
    r.raise_for_status()
    content = r.json().get("message", {}).get("content", "")
    ids = parse_ranked(content)
    return ids, dt, content


def parse_ranked(text):
    # primary: a JSON object/array
    try:
        j = json.loads(text)
        if isinstance(j, dict):
            for k in ("ranked_ids", "ids", "ranked", "pages"):
                if isinstance(j.get(k), list):
                    return [str(x).strip() for x in j[k]]
        if isinstance(j, list):
            return [str(x).strip() for x in j]
    except Exception:
        pass
    # fallback: scrape ids in order
    seen, out = set(), []
    for m in re.finditer(r"obs_ses_\d{3}_\d{2}", text):
        v = m.group(0)
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def run(limit=None, endpoint=ENDPOINT):
    if not os.path.isdir(os.path.join(VAULT, "pages")):
        print("vault not materialized; running materialize() first", flush=True)
        materialize()
    observations, queries = load_fixture()
    rankings = []
    if os.path.exists(RANKINGS_PATH):
        rankings = json.load(open(RANKINGS_PATH, encoding="utf-8"))
    done = {r["query"] for r in rankings}
    todo = [q for q in queries if q["query"] not in done]
    if limit:
        todo = todo[:limit]
    for i, q in enumerate(todo):
        print(f"[{i+1}/{len(todo)}] {q['query']!r} ...", flush=True)
        t_grep0 = time.time()
        cands, terms = grep_candidates(VAULT, q["query"])
        grep_s = time.time() - t_grep0
        cand_ids = {c[0] for c in cands}
        err = ""
        rank_s = 0.0
        retrieved = []
        if not cands:
            # real obsidian-wiki limitation: pure keyword grep surfaced nothing
            err = "no_grep_candidates"
            print(f"    -> 0 grep candidates (terms={terms}); pure-keyword miss", flush=True)
        else:
            try:
                ids, rank_s, _raw = ollama_rank(q["query"], cands, endpoint)
            except Exception as e:  # noqa: BLE001
                ids, err = [], f"ollama_error: {type(e).__name__}: {e}"[:300]
            # keep only ids the grep actually surfaced (faithful: the agent can
            # only rank what grep found), dedupe, cap 20
            seen = set()
            for x in ids:
                if x in cand_ids and x not in seen:
                    seen.add(x)
                    retrieved.append(x)
                if len(retrieved) >= 20:
                    break
            # if the model under-returned, backfill from grep order (the agent's
            # default "most-matching pages first" ranking) up to 20
            for pid, _s, _snip in cands:
                if len(retrieved) >= 20:
                    break
                if pid not in seen:
                    seen.add(pid)
                    retrieved.append(pid)
        rankings.append({
            "query": q["query"],
            "relevantObsIds": q["relevantObsIds"],
            "retrieved": retrieved,
            "grep_candidate_count": len(cands),
            "grep_terms": terms,
            "grep_latency_s": round(grep_s, 4),
            "rank_latency_s": round(rank_s, 3),
            "latency_s": round(grep_s + rank_s, 3),
            "error": err,
        })
        json.dump(rankings, open(RANKINGS_PATH, "w", encoding="utf-8"), indent=2)
        print(f"    -> {len(cands)} cands, {len(retrieved)} ranked, "
              f"grep {grep_s*1000:.1f}ms + rank {rank_s:.1f}s", flush=True)
    print(f"done; {len(rankings)} total rankings saved", flush=True)


def score():
    rankings = json.load(open(RANKINGS_PATH, encoding="utf-8"))
    d = json.load(open(FIXTURE, encoding="utf-8"))
    order = {q["query"]: i for i, q in enumerate(d["queries"])}
    rankings.sort(key=lambda r: order.get(r["query"], 999))
    per_query = []
    lats = []
    ran = 0
    for r in rankings:
        retrieved = r["retrieved"]
        rel = set(r["relevantObsIds"])
        errored = bool(r.get("error")) or len(retrieved) == 0
        if not errored:
            ran += 1
        if r.get("latency_s"):
            lats.append(r["latency_s"])
        per_query.append({
            "query": r["query"],
            "recall_at_5": recall(retrieved, rel, 5),
            "recall_at_10": recall(retrieved, rel, 10),
            "recall_at_20": recall(retrieved, rel, 20),
            "ndcg_at_10": ndcg_at_k(retrieved, rel, 10),
            "mrr": mrr(retrieved, rel),
            "relevant_count": len(rel),
            "retrieved_count": len(retrieved),
            "grep_candidate_count": r.get("grep_candidate_count"),
            "latency_s": r.get("latency_s"),
            "errored": errored,
            "error": r.get("error", ""),
        })
    # Average over the queries that actually returned a ranking (honest n).
    scored = [p for p in per_query if not p["errored"]]
    base = scored if scored else per_query
    res = {
        "system": "obsidian-wiki (agentic grep retrieval, local gemma4:12b-it-qat)",
        "model": "gemma4:12b-it-qat local",
        "provider": "Ollama (local) " + ENDPOINT,
        "retrieval_type": "agentic grep + local-LLM rank (REAL ripgrep surfaces candidate pages from the 240-page markdown vault -> gemma4:12b-it-qat ranks the grep candidates -> top-20)",
        "source": "obsidian_wiki_agentic_local.py over the materialized obsidian-wiki vault (index.md + hot.md + pages/*.md); ranked page ids scored by embedder_sweep recall/ndcg_at_k/mrr (the SAME scorer as the vector rows)",
        "comparable_retrieval": False,
        "parity_note": "DISTINCT modality from vector-IR: obsidian-wiki's grep-then-LLM mechanism (keyword ripgrep + LLM rank) over a plain-markdown vault, on the SAME local gemma4:12b-it-qat the OpenJarvis/Hermes/parity rows use (fair comparability -- the earlier claude -p attempt used a cloud frontier model and is NOT comparable). Pure keyword grep misses semantic matches (a page that does not literally contain a query term is never surfaced), so recall trails the local pure-vector rows. The grep scan is also O(n) and does NOT scale (bench_obsidian_wiki.py scaling curve: 42.8 ms@240 -> 666 ms@24k).",
        "avg_recall_at_5": avg([p["recall_at_5"] for p in base]),
        "avg_recall_at_10": avg([p["recall_at_10"] for p in base]),
        "avg_recall_at_20": avg([p["recall_at_20"] for p in base]),
        "avg_ndcg_at_10": avg([p["ndcg_at_10"] for p in base]),
        "avg_mrr": avg([p["mrr"] for p in base]),
        "latency_p50_s": round(statistics.median(lats), 3) if lats else None,
        "grep_only_latency_note": "COMPARISON.md keeps the grep-scan p50 (42.8 ms@240 docs) as the latency column; latency_p50_s here includes the local-LLM rank call.",
        "n_obs": 240,
        "n_queries": len(per_query),
        "queries_ran_ok": ran,
        "averaged_over": len(base),
        "endpoint": ENDPOINT,
        "per_query": per_query,
    }
    json.dump(res, open(RESULT_PATH, "w", encoding="utf-8"), indent=2)
    print(json.dumps({k: res[k] for k in (
        "avg_recall_at_5", "avg_recall_at_10", "avg_recall_at_20",
        "avg_ndcg_at_10", "avg_mrr", "latency_p50_s", "n_queries",
        "queries_ran_ok", "averaged_over")}, indent=2))
    print("wrote", RESULT_PATH)
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "materialize":
        materialize()
    elif cmd == "run":
        limit = None
        endpoint = ENDPOINT
        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == "--limit":
                limit = int(sys.argv[i + 1]); i += 2
            elif sys.argv[i] == "--endpoint":
                endpoint = sys.argv[i + 1]; i += 2
            else:
                i += 1
        run(limit, endpoint)
    elif cmd == "score":
        score()
    else:
        print(__doc__)
        sys.exit(1)
