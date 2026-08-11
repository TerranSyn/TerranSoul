#!/usr/bin/env python3
"""Real SCALING bench of **obsidian-wiki** (Ar9av/obsidian-wiki) on the
agentmemory 240-doc fixture, scaled to 2,400 and 24,000 docs.

WHY THIS IS NOT THE in-process store()/search() micro-bench used for the
memory/RAG rows: obsidian-wiki ships NO programmatic retrieval API. The Python
package (obsidian_wiki/cli.py, `dependencies = []`) is purely an INSTALLER that
copies markdown SKILL.md files into ~30 AI coding agents' skill dirs. The actual
"engine" is an LLM coding agent that READS .skills/wiki-query/SKILL.md and
executes it by hand with the host agent's Grep/Read tools over a plain-markdown
Obsidian vault. There is no database, no ANN, no in-process vector store, and no
embeddings of its own (embeddings exist only if the user separately installs the
EXTERNAL "QMD" tool, which is not part of this repo). So retrieval is NOT
vector-comparable to Mem0/Letta/agentmemory and we do NOT compute R@k here
(see retrieval_type in the JSON).

What we DO measure — the axis that is fair and that matches what we measure for
TerranSoul: ingest time, query p50 latency, and peak memory as the corpus grows.
We faithfully reproduce obsidian-wiki's own mechanism, QMD DISABLED (the
grep-only baseline the repo calls "fully functional"):

  INGEST  — materialize one markdown page per observation with YAML frontmatter
            (title/tags/summary/tier/lifecycle/base_confidence + typed
            `relationships:` edges) and an Obsidian body; append one entry per
            page to the single growing `index.md` registry; write `hot.md`,
            append `log.md`, and write `.manifest.json` with a SHA-256 content
            hash per source (exactly the coordination files the skills define).

  QUERY   — the wiki-query Retrieval Protocol, grep-only path:
              Step 1  read hot.md (recent-activity cache)
              Step 2  read index.md IN FULL  (grows O(n) every query)
              Step 2  Grep page FRONTMATTER across the whole vault (Index Pass)
              Step 4  worst-case broad CONTENT grep across every vault .md
                      (the explicit "expensive path" fallback)
            using REAL ripgrep — the same tool the host agents' Grep maps to.
            query_p50_ms is the median wall-clock of the standard Index Pass
            (read index.md + hot.md + frontmatter grep); the worst-case content
            grep is recorded separately as content_grep_p50_ms.

The repo acknowledges the scaling shape itself in llm-wiki/SKILL.md:465 —
"a 20-page vault lets you get away with full-vault scans. A 200-page vault does
not ... how the skills framework scales to large vaults WITHOUT a database."

Usage:
  python bench_obsidian_wiki.py --smoke          # 24-doc reproduce-first check
  python bench_obsidian_wiki.py                  # full 240 / 2400 / 24000 curve
  python bench_obsidian_wiki.py --sizes 240,2400 # custom multipliers
"""
import sys, os, json, time, math, hashlib, shutil, subprocess, threading, argparse, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = r"D:/Git/TerranSoulApp/src-tauri/benches/memory_quality_fixture.json"
WORK = os.path.join(HERE, ".obsidian_wiki_vaults")
OUT = os.path.join(HERE, "..", "obsidian_wiki_scaling.json")

import psutil

RG = shutil.which("rg")
assert RG, "ripgrep (rg) is required — it is what the host agents' Grep tool maps to"


# ── Fixture ──────────────────────────────────────────────────────────────────

def load_fixture():
    with open(FIXTURE, "r", encoding="utf-8") as f:
        d = json.load(f)
    return d["observations"], d["queries"]


def slugify(s):
    out = "".join(c if c.isalnum() else "-" for c in s.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")[:60] or "page"


# ── Vault materialization (the obsidian-wiki "ingest") ───────────────────────

def page_markdown(obs, page_id, neighbor_ids):
    """One Obsidian page: YAML frontmatter + body, faithful to the skill format."""
    title = (obs.get("title") or "untitled").replace('"', "'")
    subtitle = obs.get("subtitle") or ""
    facts = obs.get("facts") or []
    narrative = obs.get("narrative") or ""
    concepts = obs.get("concepts") or []
    summary = (subtitle or (facts[0] if facts else title)).replace('"', "'")[:140]
    tags = " ".join(f"#{slugify(c)}" for c in concepts) or "#misc"
    # typed relationships block (a couple of neighbours → real graph edges)
    rels = "\n".join(f"  - type: related_to\n    target: {n}" for n in neighbor_ids)
    fm = [
        "---",
        f'title: "{title}"',
        f"id: {page_id}",
        f"tags: [{', '.join(slugify(c) for c in concepts) or 'misc'}]",
        f'summary: "{summary}"',
        "tier: supporting",
        "lifecycle: verified",
        "base_confidence: 0.8",
        "relationships:",
        rels if rels else "  []",
        "---",
        "",
    ]
    body = [f"# {title}", ""]
    if subtitle:
        body.append(f"*{subtitle}*\n")
    if facts:
        body.append("## Facts\n")
        body += [f"- {x}" for x in facts]
        body.append("")
    if narrative:
        body.append("## Narrative\n")
        body.append(narrative)
        body.append("")
    if neighbor_ids:
        body.append("## Related\n")
        body += [f"- [[{n}]]" for n in neighbor_ids]
        body.append("")
    body.append(f"Tags: {tags}")
    return "\n".join(fm) + "\n".join(body) + "\n"


def materialize_vault(observations, mult, vault):
    """Replicate the 240-doc fixture `mult`x into a fresh markdown vault.
    Returns (n_pages, ingest_seconds, vault_path)."""
    if os.path.isdir(vault):
        shutil.rmtree(vault, ignore_errors=True)
    pages_dir = os.path.join(vault, "pages")
    os.makedirs(pages_dir, exist_ok=True)

    t0 = time.time()
    index_lines = ["# Wiki Index", "", "## Pages", ""]
    manifest = {"version": 1, "sources": {}}
    n = len(observations)
    page_count = 0
    for rep in range(mult):
        for i, obs in enumerate(observations):
            page_id = obs["id"] if rep == 0 else f"{obs['id']}_r{rep}"
            # neighbours within the same replica (typed edges to populate graph)
            neigh = []
            for off in (1, 2):
                j = (i + off) % n
                nid = observations[j]["id"] if rep == 0 else f"{observations[j]['id']}_r{rep}"
                neigh.append(nid)
            md = page_markdown(obs, page_id, neigh)
            fpath = os.path.join(pages_dir, f"{page_id}.md")
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(md)
            # index.md: one growing registry entry per page (the O(n) catalog)
            summary = (obs.get("subtitle") or (obs.get("title") or "")).replace("\n", " ")[:80]
            tagstr = " ".join(f"#{slugify(c)}" for c in (obs.get("concepts") or [])) or "#misc"
            index_lines.append(f"- [[{page_id}]] — {summary} ( {tagstr})")
            # .manifest.json: per-source SHA-256 content hash (the delta backbone)
            manifest["sources"][page_id] = {
                "page": f"pages/{page_id}.md",
                "sha256": hashlib.sha256(md.encode("utf-8")).hexdigest(),
                "ingested_at": "2026-06-28T00:00:00Z",
            }
            page_count += 1

    # root coordination files
    with open(os.path.join(vault, "index.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(index_lines) + "\n")
    # hot.md — recent-activity cache (last ~20 pages), read first each query
    hot = ["# Hot — recent activity", ""] + index_lines[-20:]
    with open(os.path.join(vault, "hot.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(hot) + "\n")
    with open(os.path.join(vault, "log.md"), "w", encoding="utf-8") as f:
        f.write(f"## Log\n\n- [2026-06-28T00:00:00Z] INGEST pages_created={page_count}\n")
    with open(os.path.join(vault, ".manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    ingest_s = time.time() - t0
    return page_count, ingest_s, vault


# ── Query path (wiki-query grep-only baseline) ───────────────────────────────

def rg_count(pattern, path, extra=None):
    """Run real ripgrep, return (match_lines, files_touched). Streams output."""
    cmd = [RG, "--no-heading", "--with-filename", "-N", pattern]
    if extra:
        cmd[1:1] = extra
    cmd.append(path)
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    lines = [l for l in p.stdout.splitlines() if l]
    files = {l.split(":", 1)[0] for l in lines if ":" in l}
    return len(lines), len(files)


def index_pass(vault, query):
    """The standard wiki-query path EVERY query incurs (Steps 1-2):
       read hot.md + read index.md IN FULL + Grep page FRONTMATTER across vault."""
    pages = os.path.join(vault, "pages")
    # Step 1: read hot.md (recent cache)
    with open(os.path.join(vault, "hot.md"), "r", encoding="utf-8") as f:
        _hot = f.read()
    # Step 2: read index.md IN FULL — this single file grows O(n)
    with open(os.path.join(vault, "index.md"), "r", encoding="utf-8") as f:
        _index = f.read()
    # Step 2: Grep page FRONTMATTER (title/tags/summary/tier) across the vault
    terms = [w for w in query.lower().replace("?", "").split() if len(w) > 3][:4]
    pat = "|".join(terms) if terms else "title"
    rg_count(rf"^(title|tags|summary|tier|aliases):.*({pat})", pages, extra=["-i"])
    return len(_index) + len(_hot)  # bytes that must enter the agent context


def content_grep(vault, query):
    """Step 4 worst-case fallback: broad CONTENT grep across every vault .md."""
    pages = os.path.join(vault, "pages")
    terms = [w for w in query.lower().replace("?", "").split() if len(w) > 3][:4]
    pat = "|".join(terms) if terms else "the"
    rg_count(pat, pages, extra=["-i"])


# ── Memory sampler ───────────────────────────────────────────────────────────

class PeakRSS:
    def __init__(self):
        self.proc = psutil.Process()
        self.peak = 0
        self._stop = False

    def _run(self):
        while not self._stop:
            try:
                rss = self.proc.memory_info().rss
                for c in self.proc.children(recursive=True):
                    try:
                        rss += c.memory_info().rss
                    except Exception:
                        pass
                self.peak = max(self.peak, rss)
            except Exception:
                pass
            time.sleep(0.003)

    def __enter__(self):
        self.peak = self.proc.memory_info().rss
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop = True
        self._t.join(timeout=1)


# ── One size point ───────────────────────────────────────────────────────────

def run_size(observations, queries, mult):
    vault = os.path.join(WORK, f"vault_{mult}x")
    n_pages, ingest_s, vault = materialize_vault(observations, mult, vault)
    q_texts = [q["query"] for q in queries]

    index_ms, content_ms = [], []
    with PeakRSS() as peak:
        for q in q_texts:
            t0 = time.time()
            index_pass(vault, q)
            index_ms.append((time.time() - t0) * 1000.0)
        for q in q_texts:
            t0 = time.time()
            content_grep(vault, q)
            content_ms.append((time.time() - t0) * 1000.0)

    return {
        "corpus_size": n_pages,
        "multiplier": mult,
        "ingest_s": round(ingest_s, 3),
        "query_p50_ms": round(statistics.median(index_ms), 2),
        "query_p95_ms": round(sorted(index_ms)[int(len(index_ms) * 0.95) - 1], 2),
        "content_grep_p50_ms": round(statistics.median(content_ms), 2),
        "content_grep_p95_ms": round(sorted(content_ms)[int(len(content_ms) * 0.95) - 1], 2),
        "index_md_bytes": os.path.getsize(os.path.join(vault, "index.md")),
        "peak_mem_mb": round(peak.peak / (1024 * 1024), 1),
        "n_queries": len(q_texts),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--sizes", default="1,10,100",
                    help="comma multipliers of the 240-doc fixture (default 1,10,100 = 240/2400/24000)")
    args = ap.parse_args()

    observations, queries = load_fixture()
    print(f"[fixture] {len(observations)} obs / {len(queries)} queries", flush=True)
    os.makedirs(WORK, exist_ok=True)

    if args.smoke:
        obs = observations[:24]
        pt = run_size(obs, queries[:3], 1)
        print("[smoke]", json.dumps(pt, indent=1))
        assert pt["corpus_size"] == 24 and pt["query_p50_ms"] >= 0
        print("[smoke] OK")
        return

    mults = [int(x) for x in args.sizes.split(",")]
    curve = []
    for m in mults:
        print(f"[size] {m}x = {len(observations)*m} docs — materializing + querying ...", flush=True)
        pt = run_size(observations, queries, m)
        print("  ->", json.dumps({k: pt[k] for k in
              ("corpus_size", "ingest_s", "query_p50_ms", "content_grep_p50_ms", "peak_mem_mb", "index_md_bytes")}), flush=True)
        curve.append(pt)

    result = {
        "system": "obsidian-wiki",
        "source": "Ar9av/obsidian-wiki — skill-based 'LLM Wiki' (Karpathy pattern); pure-stdlib installer (dependencies=[]) that copies markdown SKILL.md files into AI coding agents. No retrieval code, no DB, no ANN, no in-process vector store, no embeddings of its own. Retrieval = an LLM agent executing .skills/wiki-query/SKILL.md by hand with Grep/Read over a plain-markdown Obsidian vault. Bench QMD-DISABLED (the grep-only baseline the repo calls 'fully functional').",
        "retrieval_type": "keyword grep + LLM prose synthesis (NOT vector ANN; NO callable search() returning ranked doc ids)",
        "comparable_retrieval": False,
        "recall_skipped_reason": "obsidian-wiki exposes no programmatic ranked retrieval — answers are an LLM agent's synthesized prose, not a ranked doc-id list. Dropping it into the in-process 240-doc store()/search() recall fixture 1:1 would be apples-to-oranges, so R@5/R@10/etc are reported as '—' (not fabricated).",
        "mechanism_audited": "INGEST: one .md page/obs (YAML frontmatter title/tags/summary/tier/lifecycle/base_confidence + typed relationships edges) + Obsidian body; single growing index.md registry; hot.md cache; log.md; .manifest.json with SHA-256 per source. QUERY (wiki-query grep-only): read hot.md + read index.md IN FULL (O(n)) + ripgrep page FRONTMATTER across vault (Index Pass); worst-case broad CONTENT grep across every .md (Step 4 fallback). Real ripgrep " + (RG or ""),
        "scaling_acknowledged_by_repo": "llm-wiki/SKILL.md:465 — 'a 20-page vault lets you get away with full-vault scans. A 200-page vault does not ... how the skills framework scales to large vaults WITHOUT a database.'",
        "embedder": None,
        "machine": f"{psutil.cpu_count()} logical CPUs, {round(psutil.virtual_memory().total/1e9,1)} GB RAM, ripgrep {subprocess.run([RG,'--version'],capture_output=True,text=True).stdout.splitlines()[0]}",
        "scaling_curve": curve,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"[done] wrote {OUT}")
    print(json.dumps(curve, indent=2))


if __name__ == "__main__":
    main()
