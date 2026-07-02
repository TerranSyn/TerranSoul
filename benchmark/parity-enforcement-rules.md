# Parity Enforcement Rules — TerranSoul Brain & RAG

**Effective Date:** 2026-05-27  
**Scope:** All TerranSoul benchmarks under `benchmark/terransoul/*/`  
**Rule:** Every benchmark must validate that **direct-store retrieval** and **MCP gateway-routed retrieval** produce **byte-for-byte identical results** on all quality metrics.

## Why This Matters

TerranSoul ships a production MCP server (`7421`/`7422`/`7423`) that wraps `AppStateGateway::search()`. AI coding agents, the Zork bench bridge, and external integrations all route through this gateway — so if the gateway produces different results than direct-store, the brain is broken for everyone downstream, not just for the bench that happened to catch it.

This is why every benchmark runs dual (direct-store + gateway), every table shows both paths, and CI fails if drift exceeds ±1.0 pp on any metric (unless explicitly accepted and documented) — a code change that breaks the gateway silently gets caught the same run, not in production.

## Benchmark Parity Checklist

| Benchmark | Direct-Store Baseline | Gateway Dual-Run | Parity Acceptance | Status |
|---|---|---|---|---|
| **agentmemory-quality** | 240-obs, R@10=59.9% | Same 240-obs via gateway, R@10=59.9% | ±0.0 pp | PASS |
| **longmemeval-s** | 50-q sampled, R@10=98.0% | Same 50-q via gateway, R@10=98.0% | ±0.0 pp (0/50 per-q) | PASS |
| **locomo-mteb** | 1976-q, R@10=57.3% | Same 1976-q via gateway, R@10=57.3% | ±0.0 pp | PASS |
| **locomo-at-scale** | 100-q, R@10=64.0% | Dual-parity gateway on same DB, R@10=64.0% | ±0.0 pp (quality), 85/100 ID-identical | PASS |
| **zorkgpt** | 3 arms, brain-vs-default | Bridge routes via MCP | N/A (qualitative) | ROUTED |
| **parity-personal-ai** | 22 prompts, direct MCP | Runs live MCP on 7421/7423/7422 | N/A (qualitative) — see [parity-personal-ai/README.md](parity-personal-ai/README.md) for current pass/fail counts | LIVE |

## Implementation Pattern

Every benchmark MUST follow this dual-run pattern:

```bash
# ARM A: Direct-store (baseline)
node scripts/my-bench.mjs run --systems=rrf --scale=100000 --output=baseline.json

# ARM B: Gateway-routed (validation)
LONGMEM_VIA_GATEWAY=1 node scripts/my-bench.mjs run --systems=rrf --scale=100000 --output=gateway.json

# Parity check (automated in harness)
node scripts/validate-parity.mjs --baseline=baseline.json --gateway=gateway.json \
  --metric=R@10 --tolerance=1.0 --tolerance=NDCG@10:1.0 --tolerance=MRR:1.0
```

## Metrics to Validate

- **R@k** (Recall @ k) — Primary quality metric
- **NDCG@k** (Normalized Discounted Cumulative Gain) — Ranking quality
- **MRR** (Mean Reciprocal Rank) — First-result quality
- **Latency p50/p99** — Overhead (informational, not a failure condition if <5%)

## Acceptance Bars

| Scenario | Acceptance | Action if Exceeded |
|---|---|---|
| Quality drift ≤ ±1.0 pp on any metric | PASS | Proceed |
| Quality drift > ±1.0 pp | FAIL | Diagnose the gateway regression, fix in code or config, rerun until parity restored, update `mcp-data/shared/memory-seed.sql` with the root cause |
| Latency overhead > 10% | WARN | Document in benchmark README; investigate if time-sensitive application |
| Latency overhead ≤ 5% | PASS | Expected (MCP JSON-RPC overhead) |

## New Benchmark Checklist

When adding a new benchmark to `benchmark/terransoul/*/`:

Run the harness twice on the same query set — once without `LONGMEM_VIA_GATEWAY=1` (direct-store baseline) and once with it (gateway validation) — and save both result JSON files. Add a parity row to the benchmark's README with direct-store metrics (R@10, NDCG@10, MRR), the matching gateway metrics, and the drift (pp difference, pass/fail). The milestones.md chunk acceptance criteria must state the parity verdict (e.g. "0.0 pp drift on all 5 tasks → production-ready"), and the root-cause analysis gets appended to `mcp-data/shared/memory-seed.sql` (e.g. `source_hash='seed:bench-<name>-parity-validated-2026-05-27'`).

## CI/CD Gate

The **Full CI Gate** (`npm run test:full`) must include a new step:

```bash
npm run test:full  # Runs vitest, vue-tsc, cargo clippy, cargo test
# NEW: Add parity validation for all benchmarks that have been modified
npx node scripts/bench-parity-gate.mjs --check-all-modified
```

If parity check fails on any benchmark, CI fails. Merging requires either:
- Fixing the code to restore parity, OR
- Updating `mcp-data/shared/memory-seed.sql` with documented acceptance of the known divergence (rare)

## Root Cause Analysis — patterns to check first

These are the drift causes that have shown up across benches so far; check them before assuming a real gateway bug:

- **Embedding timeout mismatch** — gateway has a 30s Ollama timeout, direct-store has 500ms (production default). Either make both paths use the same timeout, or document why they differ. Lesson: `"Gateway embeddings use 30s bench timeout; production defaults to 500ms. Both paths correct; timeout mismatch was test-only config."`
- **Shard routing divergence** — gateway routes 15 shards, direct-store routes all. Force both to the same shard mode (e.g. `ShardMode::AllShards` for bench). Lesson: `"Shard routing must be identical on both paths; set LONGMEM_SHARD_MODE=all for parity validation."`
- **Decay score drift** — gateway applies decay filters, direct-store doesn't. Apply filters consistently, or confirm they're not needed for rrf-only mode. Lesson: `"Decay filters skipped on rrf-only (no embeddings); both paths consistent."`

## Monitoring & Alerts

After merge, any benchmark with parity drift > ±1.0 pp on CI fails the build (PRs can't merge), needs a code reviewer who understands the root cause, and gets its lesson synced to `mcp-data/shared/memory-seed.sql` so future parity runs catch the same regression automatically.

---

## Status as of 2026-05-27

Validated and enforced: agentmemory-quality (BENCH-MCP-PARITY-1), longmemeval-s (BENCH-MCP-PARITY-3), locomo-mteb (BENCH-MCP-PARITY-4).

In progress: locomo-at-scale (BENCH-MCP-PARITY-5) — validating at 100k docs + 100 queries.

Pending: phase closure matrix (BENCH-MCP-PARITY-7) — will document parity coverage for all benches.

**Rule enforcement begins immediately:** All new benchmarks MUST include dual-run parity validation. All existing benchmarks will be retrofitted during the next opportunity.
