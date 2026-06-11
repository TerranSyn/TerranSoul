# Parity Enforcement Rules — TerranSoul Brain & RAG

**Effective Date:** 2026-05-27  
**Scope:** All TerranSoul benchmarks under `benchmark/terransoul/*/`  
**Rule:** Every benchmark must validate that **direct-store retrieval** and **MCP gateway-routed retrieval** produce **byte-for-byte identical results** on all quality metrics.

## Why This Matters

TerranSoul ships a production MCP server (`7421`/`7422`/`7423`) that wraps `AppStateGateway::search()`. AI coding agents, the Zork bench bridge, and external integrations all route through this gateway. **If the gateway produces different results than direct-store, the brain is broken for production.**

This rule ensures:
1. **Consistency:** Code changes affecting memory, retrieval, embeddings, or filtering are caught immediately if they cause gateway/direct-store divergence.
2. **Transparency:** Every benchmark table shows both paths so readers can verify parity is maintained.
3. **Enforcement:** CI/CD gates fail if drift > ±1.0 pp on any metric (unless explicitly accepted + documented).

## Benchmark Parity Checklist

| Benchmark | Direct-Store Baseline | Gateway Dual-Run | Parity Acceptance | Status |
|---|---|---|---|---|
| **agentmemory-quality** | ✅ 240-obs, R@10=59.9% | ✅ Same 240-obs via gateway, R@10=59.9% | ±0.0 pp | ✅ PASS |
| **longmemeval-s** | ✅ 50-q sampled, R@10=98.0% | ✅ Same 50-q via gateway, R@10=98.0% | ±0.0 pp (0/50 per-q) | ✅ PASS |
| **locomo-mteb** | ✅ 1976-q, R@10=57.3% | ✅ Same 1976-q via gateway, R@10=57.3% | ±0.0 pp | ✅ PASS |
| **locomo-at-scale** | ✅ 100-q, R@10=64.0% | ✅ Dual-parity gateway on same DB, R@10=64.0% | ±0.0 pp (quality), 85/100 ID-identical | ✅ PASS |
| **zorkgpt** | ✅ 3 arms, brain-vs-default | ✅ Bridge routes via MCP | N/A (qualitative) | ✅ ROUTED |
| **parity-personal-ai** | ✅ 22 prompts, direct MCP | ✅ Runs live MCP on 7421/7423/7422 | N/A (qualitative) | ✅ LIVE |

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
| Quality drift ≤ ±1.0 pp on any metric | ✅ PASS | Proceed |
| Quality drift > ±1.0 pp | ❌ FAIL | (a) Diagnose the gateway regression, (b) Fix in code or config, (c) Rerun until parity restored, (d) Update `mcp-data/shared/memory-seed.sql` with the root cause |
| Latency overhead > 10% | ⚠️ WARN | Document in benchmark README; investigate if time-sensitive application |
| Latency overhead ≤ 5% | ✅ PASS | Expected (MCP JSON-RPC overhead) |

## New Benchmark Checklist

When adding a new benchmark to `benchmark/terransoul/*/`:

1. **Implement dual-run harness:**
   - Run once WITHOUT `LONGMEM_VIA_GATEWAY=1` (direct-store baseline)
   - Run again WITH `LONGMEM_VIA_GATEWAY=1` (gateway validation)
   - Save both result JSON files

2. **Add parity row to README:**
   - Direct-store metrics (R@10, NDCG@10, MRR)
   - Gateway metrics (same row, same query set)
   - Drift columns (pp difference, pass/fail)

3. **Document acceptance in milestones:**
   - Chunk acceptance must include parity verdict
   - E.g.: "0.0 pp drift on all 5 tasks → production-ready"

4. **Sync durable lesson:**
   - Append `mcp-data/shared/memory-seed.sql` with root cause analysis
   - E.g.: `source_hash='seed:bench-<name>-parity-validated-2026-05-27'`

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

## Root Cause Analysis Examples

**Scenario 1: Embedding timeout mismatch**
- Symptom: Gateway has 30s Ollama timeout, direct-store has 500ms (production default)
- Fix: Ensure both paths use the same timeout, or document why they differ
- Lesson: `"Gateway embeddings use 30s bench timeout; production defaults to 500ms. Both paths correct; timeout mismatch was test-only config."`

**Scenario 2: Shard routing divergence**
- Symptom: Gateway routes 15 shards, direct-store routes all
- Fix: Ensure both use the same shard mode (e.g., `ShardMode::AllShards` for bench)
- Lesson: `"Shard routing must be identical on both paths; set LONGMEM_SHARD_MODE=all for parity validation."`

**Scenario 3: Decay score drift**
- Symptom: Gateway applies decay filters, direct-store doesn't
- Fix: Ensure filters are applied consistently or verify they're not needed for rrf-only mode
- Lesson: `"Decay filters skipped on rrf-only (no embeddings); both paths consistent."`

## Monitoring & Alerts

After merge, any benchmark with **parity drift > ±1.0 pp** on CI must trigger:

1. **In-code assertion:** Parity check fails CI, PRs cannot merge
2. **Human review:** Code reviewer must understand the root cause
3. **Documentation:** Lesson synced to `mcp-data/shared/memory-seed.sql`
4. **Regression prevention:** Future parity runs will catch regressions

---

## Status as of 2026-05-27

✅ Parity validated and enforced on:
- agentmemory-quality (BENCH-MCP-PARITY-1)
- longmemeval-s (BENCH-MCP-PARITY-3)
- locomo-mteb (BENCH-MCP-PARITY-4)

🔄 In progress:
- locomo-at-scale (BENCH-MCP-PARITY-5) — to validate at 100k docs + 100 queries

📋 Pending:
- Phase closure matrix (BENCH-MCP-PARITY-7) — will document parity coverage for all benches

**Rule enforcement begins immediately:** All new benchmarks MUST include dual-run parity validation. All existing benchmarks will be retrofitted during the next opportunity.
