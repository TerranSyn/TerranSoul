# GENesis-AGI → TerranSoul Brain: Adoption Spec

> **Spec-driven plan** (Specify → Plan → Tasks) for adopting the
> **cognitive / self-improvement** layer of
> [WingedGuardian/GENesis-AGI](https://github.com/WingedGuardian/GENesis-AGI)
> into TerranSoul's brain.
>
> **Status:** **SHIPPED.** GENESIS-ADOPT (Spec-032) P1–P9 shipped 2026-06-08/09
> (see `rules/completion-log.md`: P1–P4 + schema V30 §"Phase GENESIS-ADOPT
> (Spec-032) — initial schema + P1–P4 (2026-06-08)", P5 §"UNFINISHED-AUDIT batch
> + GENESIS-ADOPT-P5 + DOCS (2026-06-08)", P6–P9 §"GENESIS-ADOPT-DOCS-FINISH —
> P6–P9 reconciled Shipped 2026-06-08", retrieval no-regression verified
> 2026-06-09; durable lesson `seed:genesis-adopt-p1-p9-shipped-2026-06-08`). This
> document remains the design contract of record. Mapped into the design doc at
> [`brain-advanced-design.md`](brain-advanced-design.md) §§ 1.5, 3.5.9, 4, 6,
> 11.1, 16 (Phase 8), 20.7/20.8, 21.9.
>
> **Last updated:** 2026-06-07
> **Attribution:** see [`CREDITS.md`](../CREDITS.md). Patterns reimplemented as
> generic, domain-agnostic Rust primitives — **no GENesis source, prompts,
> schema, or branded identity copied.**

---

## 0. Why this exists

GENesis-AGI's **retrieval core** (RRF k=60, activation scoring, typed KG, decay)
is already matched or exceeded by TerranSoul. The leverage is in its
**cognitive / self-improvement** layer, which TerranSoul does **not** yet have:

- `access_count` is stored **but is not folded into the retrieval ranking
  score** — it only feeds the post-hoc importance auto-adjustment job.
- There is **no procedural confidence / tier / promotion / quarantine
  machinery** anywhere in `memory/`.
- Consolidation does N→1 synthesis **with no faithfulness / shrink / rollback**
  safety.
- Edge extraction is **not automatic** for chat-extracted facts.
- Reflection is **user-triggered with no depth grading** and no autonomous
  cheap monitor.

This spec adopts nine prioritized ideas (P1–P9) that close those gaps.

---

## 1. Prioritized adoptable ideas (deduped)

Four research reports were merged; everything already shipped or already present
in TerranSoul was dropped (dual-ego deliberation → already in `multi_agent.rs`;
intent→source affinity → already a ×1.15 multiplicative boost in §3.5.6;
direction-aware embedding cache → pure infra, deferred; drive system /
earned-autonomy ladder → product mismatch for a single-user desktop companion,
deferred/rejected).

| # | Idea | Why it's better than today | Maps to | Complexity |
|---|------|----------------------------|---------|------------|
| **P1** | **Outcome-classified self-learning loop** — classify each session into `success` / `approach_failure` / `capability_gap` / `external_blocker` / `workaround_success` and route accordingly | `auto_learn` can't tell a successful turn from a failed one — it memorises blockers as durable facts | §21.9, `memory/auto_learn.rs` + new `memory/outcome.rs` | medium |
| **P2** | **Confidence-tiered procedural memory** — Laplace confidence + L4→L1 promote / demote / quarantine | `procedural` is a retrieval label only — no success/failure counting, a failing procedure is retrieved forever | §3.5.9, schema, new `memory/procedural.rs` + promoter job | medium |
| **P3** | **Unified activation ranking signal** — `access_freq × connectivity × source half-life × proper-noun bonus` | `access_count` & edge degree exist but are **not** ranking signals — frequently-recalled, well-connected rules get no lift | §4, new `memory/activation.rs` → `fusion.rs` | medium |
| **P4** | **Consolidation safety gates** — faithfulness review + shrink guard + median/ceiling + rollback/provenance | Consolidation can silently erase facts over repeated cycles | §11.1, `memory/consolidation.rs` | medium |
| **P5** | **Layered recall budget + zero-LLM L1 session primer** | No cheap always-on session-start primer; no explicit per-layer budget | §20.8, new `memory/session_primer.rs` + `commands/chat.rs` | low |
| **P6** | **Echo-collapse diversity penalty** — token-set Jaccard ≥ 0.80 demote | No near-duplicate suppression — paraphrased dups waste top-k | §4, `memory/fusion.rs` | low |
| **P7** | **KG auto-link on write (floor-gated)** — NN typed edges on long-tier writes | Edge extraction isn't automatic for chat-extracted facts | §6, `store.rs::add`, `edges.rs`, `conflicts.rs` | medium |
| **P8** | **Per-request effort triage (SKIP/LIGHT/NORMAL/FULL) + graded reflection depth** | Each gate decides independently; no unified effort budget; fixed reflection cost | §20.7, `brain/intent_classifier.rs`, `memory/reflection.rs` | medium |
| **P9** | **Zero-LLM awareness loop + idle validation cognition** | Reflection is user-triggered; consolidation does no proactive validation | §21.9, `brain::maintenance_runtime`, `memory/edge_conflict_scan.rs` | high |

**Deferred (documented in §16 Phase 8-DEFER, not specced):** two-level wing/room
taxonomy with scoped recall; DRIFT two-phase retrieval; event-calendar table for
time-anchored obligations; tag-cooccurrence FTS5 query expansion (corpus-derived,
AGI-pure HyDE complement); surface-form alias normalisation at ingest.

---

## 2. SPECIFY — Outcome-classified self-learning with confidence-tiered procedural memory and activation-aware recall

**Goal:** Turn the brain's write-back from "extract facts every N turns" into
"learn what worked, promote reliable procedures, and recall what the agent
actually uses." Make consolidation non-destructive and give retrieval a
graph/access-aware activation signal and a zero-LLM session primer.

### User stories

1. As the brain, after a session I classify the outcome and route it (reinforce a
   working procedure, log a capability gap without faking learning, note an
   external blocker) instead of dumping undifferentiated facts.
2. As the brain, a procedure that keeps succeeding gets auto-injected at session
   start; one that keeps failing is demoted / quarantined automatically.
3. As the brain, a frequently-recalled, well-connected steering rule outranks a
   stale casual note of equal text relevance.
4. As the user, consolidation can never silently erase facts — it is
   faithfulness-checked, shrink-guarded, and rollback-able.
5. As the user, greetings get an instant ~300-token "who I am / recent decisions"
   primer with no RAG cost.

### Acceptance criteria (AGI-purity gated)

- All thresholds (Laplace prior, tier bars, demotion rules, activation weights,
  half-lives, shrink ratio, Jaccard cutoff) live in the brain
  (`mcp-data/shared/memory-seed.sql` / `AppSettings`) — **zero hardcoded
  scores / verb-lists in Rust** (AGI-purity grep gate clean).
- Outcome taxonomy + tiers are **generic / structural** (no domain-specific
  procedures or room names).
- Regression tests for every gate; **LongMemEval-S retrieval R@5 / NDCG@10 must
  not regress** from the current 99.2 % / 91.3 % baseline after the activation
  signal lands.
- New procedures start at ≈ 0.67 confidence (Laplace); a 3-consecutive-failure
  procedure quarantines; a consolidation that drops > 50 % length is blocked.

### Out of scope

Drive system, multi-org trust ladder, wing/room taxonomy, event calendar
(deferred to §16 Phase 8-DEFER).

---

## 3. PLAN

### Schema (backward-compatible, nullable — like `cognitive_kind`)

- Procedural rows: `success_count`, `failure_count`, `confidence`,
  `activation_tier` (new `procedures` view or columns on `memories`).
- Provenance: `deprecated` (soft-delete flag), `consolidation_run_id`, and
  `synthesized_from` / `synthesized_into` edges via `memory_edges`.
- Ensure `access_count` + edge-degree are readable at rank time.
- Bump schema version + run the canonical initializer compatibility pass (all
  columns nullable, default L4 with zero counters for existing rows).

### Modules

- `memory/outcome.rs` — classifier (pure prompt + parser), 5-class taxonomy.
- `memory/procedural.rs` — Laplace ledger + counters + promoter.
- `memory/activation.rs` — replaces the kind-only multiplier; feeds `fusion.rs`.
- `memory/session_primer.rs` — zero-LLM L1 primer.
- `memory/consolidation.rs` — add the four safety gates.
- `memory/fusion.rs` — echo-collapse pass + activation wiring.

### Scheduler

- Promoter job + procedure re-test job in `brain::maintenance_runtime` (reuses
  the existing tick — no new process).

### MCP / Gateway

- Route **all** CRUD through `AppStateGateway` (single-source-of-truth rule).
- Add `consolidation_rollback`; surface procedure tiers in `brain_health`.

### Brain config seeds

- All thresholds seeded into `mcp-data/shared/memory-seed.sql`.

---

## 4. TASKS (dependency-ordered)

> Top 5 = P1–P5; P6/P7 are fast-follow tasks in the same spec.

1. **Schema migration + compatibility pass** (procedural columns, provenance,
   `deprecated` flag). *(blocks all)*
2. **`memory/outcome.rs`** classifier + parser + unit tests. **(P1)**
3. **`memory/procedural.rs`** ledger (Laplace confidence, counters) + promoter
   job + tests. **(P2, dep 1, 2)**
4. **Wire P1 verdicts → P2 ledger counters** in `auto_learn` /
   `reflect_on_session`; persist verdict on `session_reflection`. **(P1+P2)**
5. **`memory/activation.rs`** (access_freq + connectivity + source half-life +
   proper-noun bonus) → `fusion.rs`; LongMemEval-S no-regression bench. **(P3, dep 1)**
6. **Echo-collapse diversity pass** in `fusion.rs` + tests. **(P6)**
7. **Consolidation safety gates** (shrink + median/ceiling + faithfulness +
   rollback/provenance) + `consolidation_rollback` cmd + startup integrity
   check + tests. **(P4, dep 1)**
8. **`memory/session_primer.rs`** zero-LLM L1 primer + inject once per
   conversation in `commands/chat.rs`. **(P5, dep 3 for L1-tier procedures)**
9. **KG auto-link-on-write** (floor-gated, generic) in `store.rs::add`. **(P7, dep 1)**
10. **Brain-resident thresholds** in `memory-seed.sql`; AGI-purity grep gate;
    seed the lesson family. *(closes Principle 3)*
11. **Doc edits** (already applied: §§1.5/3.5.9/4/6/11.1/16/20.7/20.8/21.9 +
    README + CREDITS); call `brain_ingest_lesson` with the outcome.

### Fast-follow (P8, P9 — separate sub-spec)

- P8 — Per-request effort triage (`brain/intent_classifier.rs` → effort
  classifier) + graded reflection depth (`memory/reflection.rs`).
- P9 — Zero-LLM awareness loop (cheap signal gather on the maintenance tick →
  conditional depth-graded reflection) + idle validation (contradiction /
  staleness sweep over `contradicts` / temporal edges + procedure re-test);
  optional betweenness-centrality bridge detection for §4 connectivity and
  eviction protection.

---

## 5. Cross-references

| Idea | Design-doc section |
|------|--------------------|
| Architecture-at-a-glance diagram | `brain-advanced-design.md` § 1.5 |
| P2 — procedural ledger | § 3.5.9 |
| P3 — activation signal + P6 echo-collapse | § 4 |
| P7 — KG auto-link on write | § 6 |
| P4 — consolidation safety gates | § 11.1 |
| Roadmap (Phase 8 + deferred) | § 16 |
| P8 — effort triage / P5 — layered recall | § 20.7 / § 20.8 |
| P1 — outcome-classified write-back | § 21.9 |

---

## 6. Notes from the study

- DeepWiki served only a JS shell for this repo — **not usable**; the study used
  the GitHub README + raw source (`src/genesis/memory/*`,
  `src/genesis/learning/procedural/*`, `db/migrations/*`, architecture docs)
  plus the author's Medium write-up. Recorded so we don't re-audit.
- GENesis's RAG core is **not** an adoption target — TerranSoul already matches
  or exceeds RRF k=60 / activation scoring / typed KG / decay. The leverage is
  entirely in the cognitive / self-improvement layer above.
- The single highest-leverage idea is **P1 + P2** (outcome classification + the
  procedural confidence ladder): together they turn write-back from "extract
  facts every N turns" into "learn what worked and promote reliable procedures."
