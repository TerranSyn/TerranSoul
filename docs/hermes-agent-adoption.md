# Hermes-Agent Adoption — Autonomous Skill Creation from Observed Workflows

> **Status:** **SHIPPED** — HERMES-ADOPT-1..6 shipped 2026-06-09 (Spec-033; see
> `rules/completion-log.md` §"HERMES-ADOPT-DOCS + Phase HERMES-ADOPT COMPLETE ✅
> (2026-06-09)"). The delta is real in the brain: `brain/skill_synthesizer.rs`
> (authoring module) + the `synthesizes_new_skill` predicate
> (`memory/outcome.rs`, seam in `memory/reflection.rs`) + a `tool_skills` row with
> `source='synthesized'` and its procedural twin (durable lesson
> `seed:hermes-adopt-shipped-2026-06-09`). §1–§6 below are retained as the design
> rationale of record.
>
> **Source studied:** [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
> (MIT, © 2025 Nous Research), reverse-engineered 2026-06-08 via DeepWiki
> (commit `6c73e8ff`) + two raw upstream files (`agent/prompt_builder.py`,
> `agent/memory_manager.py`). **No upstream source code, prompts, branded
> identity, file names, or schema are vendored.** Every behaviour below is
> described generically and re-grounded onto existing TerranSoul Rust modules so
> it **enhances** the brain rather than duplicating it.
>
> **Design contract:** [`docs/brain-advanced-design.md`](brain-advanced-design.md)
> is the authority. This doc maps each Hermes mechanism onto an existing
> §-section / module so we never re-add intel the brain already has. The single
> genuinely **new** capability is **autonomous skill creation from successful
> trajectories** (Hermes §8.1 skill auto-generation) — TerranSoul today can
> *optimize*, *reinforce*, *import*, *render*, and *promote* skills, but it cannot
> *mint a brand-new one from observed behaviour*. That is the delta.

---

## 1. What Hermes does

Hermes is an agent runtime whose self-improvement is built around **procedural
memory authored as Markdown skill documents**, plus a cross-session memory layer
and a bounded self-scheduling primitive. Three pillars:

### 1.1 The closed skill loop (Hermes §8.1 / §13) — the part TerranSoul lacks

A skill is **not** an executable plugin; it is a Markdown document (`SKILL.md`)
with YAML frontmatter (`name` ≤64 chars, `description` ≤1024 chars, optional
`platforms` / `prerequisites`) plus an optional Markdown body. The directory of
documents **is** the registry — there is no separate index table. The loop:

```
TRIGGER   ── LLM judgement, gated by a behavioural heuristic embedded in the
             system prompt: "after a complex task (5+ tool calls), a fixed
             tricky error, or a discovered non-trivial workflow → save the
             approach as a skill; patch an outdated skill immediately."
             (creation is LLM-driven, NOT a hardcoded code rule)
   │
AUTHOR    ── the agent calls a `skill_manage` tool (create / edit / patch /
             delete). The body is written by the model from the trajectory.
   │
VALIDATE  ── (a) frontmatter validation (name format, description length,
             platform compat); (b) a static security scan ("Skills Guard"):
             regex detection of env-exfiltration / credential-store access /
             prompt-injection / destructive commands + Unicode-homoglyph /
             invisible-char checks → verdict safe / caution / dangerous, gated
             by a trust tier (builtin / trusted / community / agent-created).
   │
REGISTER  ── atomic write of the validated document into the skills dir.
   │
REUSE     ── a retrieval-by-description index (name + description only, NOT full
             bodies) is injected into the system prompt; the model hydrates a
             skill's full body on demand when a task matches. Keeps the prompt
             small while exposing the whole library.
   │
REFINE    ── an idle-time "Curator" auxiliary-LLM pass (separate session, to
             avoid cache pollution) surveys *agent-created* skills using per-skill
             usage sidecars (use / view / patch counts + last_used_at) and an
             Active → Stale → Archived lifecycle (Pin = absolute exemption).
             It proposes patches, consolidates redundant skills, or archives
             obsolete ones. Snapshot-before-mutate backups; archive — never
             auto-delete. Loops back into REUSE.
```

### 1.2 Observe-user → personalize (Hermes §4.3 / §4.4)

Two local declarative Markdown files (`MEMORY.md` = agent facts/quirks,
`USER.md` = user prefs) edited by a builtin memory tool; a **frozen-snapshot**
write trick (persist to disk now, apply to the prompt next session) protects the
LLM prefix cache. A SQLite-WAL session DB with FTS5 gives cross-session recall
(discovery / scroll / browse modes). An optional external user-model (Honcho)
adds dialectic multi-pass synthesis. Selective persistence is the LLM's own
tool-call judgement, not a hardcoded extractor.

### 1.3 In-conversation compaction + bounded proactivity (Hermes §10.1 / §10.3)

A head-middle-tail context compressor (protect first/last N, iterative summary
with deterministic fallback, **tool-result pre-shrink** to 1-liners before LLM
summarization). Proactivity is deliberately minimal: there is **no** "suggest
next action" engine — the only proactive primitive is **bounded agent
self-scheduling** (a cron tool the agent can use to schedule its own future
runs, with strong anti-recursion guards and origin-context capture).

---

## 2. What TerranSoul already has (do NOT rebuild)

TerranSoul already ships a substantial self-improvement stack. Per the audit,
**every** existing path is one of *optimize / reinforce / import / render /
promote* — none **creates** a brand-new skill from observed behaviour:

| # | Capability | Module(s) | What it does | Why it is NOT skill-creation |
|---|---|---|---|---|
| a | **Skill optimization (SkillOpt)** | `brain/skill_optimizer.rs`, `commands/skill_optimizer.rs` | Reads `agent_traces`, scores turns with an LLM judge, generates a **refined** version of an **existing** prompt, offline A/B-tests refined-vs-original, reports `score_gain` + diff. ODY-12 hardening: gradient clipping (`MAX_EDITS_PER_PASS=3`), protected regions, `SkillVersion` provenance, dual analysts. | Improves text that **already exists**; never mints a new entity. |
| b | **Confidence-tiered procedural ledger** (GENESIS P2) | `memory/procedural.rs` (design §3.5.9) | Laplace confidence `(s+α)/(s+f+α+β)` (~0.67 cold start), L4→L1 tier ladder, promote/demote, quarantine after 3 consecutive failures. | Counts success/failure on procedures **already retrieved**; never synthesizes a new one. |
| c | **Outcome-classified learning** (GENESIS P1) | `memory/outcome.rs` (design §21.9) | 5-class `SessionOutcome` taxonomy + `reinforces_procedure()` / `penalises_procedure()` / `persists_durable_facts()` routing; wired into `reflect_on_session`; `external_blocker` facts not memorised. | Routes reinforcement; the doc §21.9 **earmarks** "extract a NEW procedure" but the code only flips counters. |
| d | **Session reflection + idle sweep** (GENESIS P8/P9) | `memory/reflection.rs`, `memory/edge_conflict_scan.rs`, `brain/maintenance_runtime.rs` | Depth-graded reflection (`Skip`/`Summary`/`Facts`/`Full`) + zero-LLM idle re-test of quarantined/low-confidence procedures. | Recall/maintenance, not authoring. |
| e | **Deterministic doc-skill rendering** | `coding/skills.rs` (Chunk 37.12) | Renders `SKILL.md` (YAML + Markdown) from the **static code graph** (`code_symbols`/`code_edges`/`code_processes`). | Deterministic from code, not derived from behaviour. |
| f | **Skill catalog import (Hermes import seam)** | `memory/tool_skills.rs`, `commands/tool_skills.rs` (PARITY-OJ-9) | `tool_skills` catalog of `ToolSkill{source, name, version, schema_json, prompt, description}` with `upsert_tool_skill` / `sync_catalog` / `install` / `uninstall`; **already imports** Hermes (~150) and OpenClaw (~13.7k) skills. | Import / marketplace seam — sync only, never autonomous authoring. |
| g | **Capability promotion-to-source** | `teachable_capabilities/registry.rs`, `coding/promotion_plan.rs` | 17 user-tunable capabilities on a maturity ladder (Untested→Learning→Proven→Canon); `build_promotion_plan()` turns a proven config into a 4-step `WorkflowPlan` that bakes the config into a source default. | Promotes **config of a pre-defined** capability, not a brand-new skill. |

**Already-present analogs to the rest of Hermes (so we do not re-add them):**

| Hermes mechanism | TerranSoul analog (already shipped) |
|---|---|
| Curator lifecycle (Active/Stale/Archived, usage signal) | Procedural ledger promote/demote/quarantine (§3.5.9) + idle re-test sweep (§21.9 / P9) |
| Consolidation / redundancy merge with backups | Consolidation N→1 + faithfulness review + shrink guard + rollback (`memory/consolidation.rs`, §11.1) |
| Retrieval-by-description skill index | L1 session primer + effort triage (§20) + `search_tool_skills` |
| Head-middle-tail compaction + tool-result pre-shrink | Rolling conversation summary on overflow (CHAT-HARNESS-2) + 3-tier memory + decay |
| Frozen-snapshot memory write (apply-next-turn) | Versioned `MemoryStore::update` + write-back loop (§21.1) |
| Cross-session FTS5 recall (discovery/scroll/browse) | FTS5 session search (Chunk 48.5) |
| MEMORY.md / USER.md split, honcho dialectic | `personal:*` / `meta:*` memory tiers + reflection |
| Pre-write injection/exfil scan ("Skills Guard") | Faithfulness review on ingest (no dedicated injection scan yet — see §5 optional hardening) |
| Bounded agent self-scheduling (cron) | `brain/maintenance_runtime.rs` idle tick (no agent-authored future runs yet — see §5 optional proactivity) |

---

## 3. THE DELTA — autonomous skill synthesis from successful workflows

The one capability Hermes has and TerranSoul lacks: **detect a recurring or
workaround-successful multi-step trajectory and AUTHOR a brand-new reusable
skill** (a fresh `tool_skills` row + a cold procedural-memory entity) that did
not exist before. The design-doc §21.9 routing table already **specifies** this
intent (`workaround_success → extract a NEW procedure`); the shipped code only
flips counters. This section makes that earmarked-but-unbuilt path real, as a
**single new module** plus reuse of the optimizer's trace extractor, the
outcome classifier, the `tool_skills` catalog, the procedural ledger, and the
promotion runner — **zero duplication**.

### 3.1 The closed loop, re-grounded onto TerranSoul

```
TRIGGER  (read side) ── memory/outcome.rs SessionOutcome routing, consumed in
                        reflect_on_session (§21.1 write-back, Step 3.5).
                        NEW predicate synthesizes_new_skill() fires on
                        workaround_success (and, gated, a *recurring* success
                        cluster). Doctrinally the §21.9 table already points here.
   │
AUTHOR   (new module)── brain/skill_synthesizer.rs (sibling of skill_optimizer.rs).
                        Optimizer = improve an existing prompt; Synthesizer =
                        MINT a new one from a trajectory. An auxiliary-LLM pass
                        extracts {name, when-to-use/description, parameter
                        JSON-Schema, prompt snippet} from the successful trace.
                        Trajectory data comes from skill_optimizer::
                        extract_turn_pairs_public(agent_traces) — reused, not
                        re-implemented.
   │
VALIDATE (gate)     ── (a) generic structural validation of the synthesized
                        artefact (name format, description length, schema is
                        valid JSON-Schema, prompt non-empty) — mirrors Hermes
                        frontmatter checks but over the ToolSkill shape;
                        (b) a NO-REGRESSION / CONFIDENCE gate (see §3.3): the
                        skill is born COLD and must EARN trust; it is never
                        injected on creation;
                        (c) optional pre-write content scan (§5 hardening).
   │
REGISTER (reuse)    ── write the artefact through the EXISTING catalog:
                        memory/tool_skills.rs upsert_tool_skill with a new
                        source value (e.g. source="synthesized") so it is
                        distinct from imported "hermes"/"openclaw" rows and from
                        the static "code-graph" doc-skills. The ON CONFLICT
                        (source, name) natural key gives idempotent re-authoring.
                        In parallel, mint a procedural-tier memory so the
                        procedural.rs Laplace ledger immediately governs it
                        (born at TIER_COLD / ~0.67). No new table is invented.
   │
REUSE    (existing) ── the new skill surfaces via search_tool_skills + the L1
                        primer's "available procedures" index (description-only,
                        body hydrated on match — Hermes retrieval-by-description,
                        but reusing the existing primer rather than a new index).
                        Because it is born advisory-only (L4), it is retrievable
                        but NOT auto-injected until it proves itself.
   │
REFINE   (existing) ── every subsequent USE feeds record_procedure_outcome
                        (§3.5.9): success → confidence ++ / promote toward L1;
                        repeated failure → demote → quarantine. The idle re-test
                        sweep (§21.9 / P9) and the optimizer (a) can then refine
                        the synthesized prompt. Promotion-to-source (§3.4) for
                        the winners. Loops back into REUSE.
```

**Net new surface: ONE module (`brain/skill_synthesizer.rs`) + ONE outcome
predicate (`synthesizes_new_skill`) + ONE new `source` value in `tool_skills`.**
Everything else is reuse. This deliberately does not touch the optimizer
(which only refines existing prompts), the ledger (which only scores existing
procedures), or the catalog importer (which only syncs).

### 3.2 Trigger — when to author (read seam)

- **Primary entry point:** `memory/outcome.rs`, consumed in `reflect_on_session`
  (the §21.1 Step-3.5 outcome-classifier stage). Add a `synthesizes_new_skill()`
  predicate **alongside** the existing `reinforces_procedure()` /
  `penalises_procedure()` / `persists_durable_facts()` predicates.
- **Fires on:** `workaround_success` (the doctrinally-correct case — the agent
  found a novel path that worked), and **optionally** a `success` that belongs to
  a *recurring cluster* (Hermes's "non-trivial workflow / 5+ tool calls"
  heuristic, re-expressed as a brain-resident cluster-size + recurrence
  threshold, not a hardcoded turn count). De-dup against existing
  `tool_skills` by the `(source, name)` natural key and against existing
  procedures by embedding similarity so we PATCH rather than duplicate (Hermes's
  "patch an outdated skill immediately" guidance, re-grounded onto upsert).
- **Effort gating:** authoring runs behind the same `AutoLearnPolicy` / effort
  triage (§20.7) as every other write path so it **never fires an LLM every
  turn** (per §21.8 new-write-path rules). Authoring is `deep`/`strategic`
  reflection depth only.

### 3.3 Validate — no-regression / confidence gate (AGI-purity)

Hermes's Skills Guard is a *security* gate; TerranSoul additionally needs a
*quality / no-regression* gate so a synthesized skill cannot pollute retrieval:

1. **Structural validation** — name matches the lowercase-alnum-hyphen format,
   `description` within the brain-resident length cap, `schema_json` parses as
   valid JSON-Schema, `prompt` non-empty. Reject + log on failure (no silent
   drop — Principle: fail loud).
2. **Born-cold, never-injected-on-create** — the procedural twin starts at
   `TIER_COLD` (~0.67 confidence) and is **advisory-only (L4)**: retrievable for
   audit but excluded from auto-injection until it earns promotion through the
   §3.5.9 ledger. This is the no-regression guarantee — an unproven synthesized
   skill cannot change live behaviour.
3. **Optional offline replay** — reuse the optimizer's offline A/B harness
   (`brain/skill_optimizer.rs`) to sanity-check that injecting the new skill on
   a held-out trace subset does not *lower* the judge score versus baseline; gate
   registration on `score_gain ≥ 0`.
4. **All thresholds brain-resident (AGI-purity / Principle 3):** the recurrence
   count, cluster-size minimum, cold-start confidence, description length cap,
   the `score_gain` floor, and the demote/quarantine bars live in
   `mcp-data/shared/memory-seed.sql` / `AppSettings` — never inlined in Rust.
   The synthesizer must be **generic over any trajectory**: no hardcoded verb
   lists, domain skill names, room names, or curated vocabularies (per
   `rules/bench-agi-purity.md`). It extracts structure from the trace, it does
   not pattern-match a fixed domain.

### 3.4 Register & reuse — existing stores only

- **Skill artefact →** `memory/tool_skills.rs::upsert_tool_skill` with
  `source="synthesized"`. Reuses the Hermes-compatible `ToolSkillUpsert`
  shape (`name`/`schema_json`/`prompt`/`description`/`version`) so the same
  catalog UI, `search_tool_skills`, and install/uninstall surface work unchanged.
- **Procedure twin →** a `procedural`-kind memory (cognitive-kind label,
  §3.5.x) so `procedural.rs` governs confidence/promotion from birth. This
  **closes the loop**: authored → reinforced → quarantined-if-it-fails, all
  through the one ledger rather than a parallel mechanism.
- **Reuse surface →** the L1 primer (§20) already injects L1-tier procedures;
  extend it to expose a lightweight description-only "available procedures"
  index (Hermes retrieval-by-description), with bodies hydrated on match. No
  separate index table.

### 3.5 Promotion-to-source (optional, already exists)

Once a synthesized skill clears the **Proven** bar (≥ N uses & ≥ rating, both
brain-resident), `coding/promotion_plan.rs::build_promotion_plan()` can promote
it to a bundled default via the multi-agent `WorkflowPlan` runner
(`commands/workflow_plans.rs`) — exactly as `teachable_capabilities` does today.
This makes the synthesizer the missing *front half* of an
author → prove → promote pipeline whose *back half* already ships.

---

## 4. Proactivity hook (bounded, optional)

Hermes's only proactive primitive is **bounded agent self-scheduling**, not an
open-ended suggestion engine. The safe, additive version for TerranSoul:

- **Seam:** `brain/maintenance_runtime.rs` already runs an idle maintenance tick
  (re-test sweep, decay, consolidation). Extend it so that, when the synthesizer
  produces or promotes a skill, it may **enqueue a bounded follow-up re-test job**
  on the idle tick (re-run the offline replay as more traces accumulate) —
  mirroring Hermes's Curator pass, reusing the existing scheduler rather than a
  new cron engine.
- **Guards (re-grounded from Hermes cron guards):** idle jobs cannot recursively
  enqueue further jobs; the synthesizer cannot fire from inside a maintenance
  job (anti-recursion); a `[silent]`-style suppression skips empty deliveries;
  capture the origin trace id for provenance. This is the *only* proactivity we
  adopt — bounded self-scheduling with anti-recursion, **not** an open-ended
  "suggest next action" engine (which Hermes itself does not have).

---

## 5. Optional security hardening (lower priority, additive)

Independent of skill creation, two Hermes ideas harden the brain's self-writes
and can land as small follow-ups:

- **Pre-write content scan (Skills Guard analog).** A generic regex/Unicode scan
  for prompt-injection / exfiltration / homoglyph / invisible-char on every
  self-authored artefact (synthesized skill body, `brain_ingest_lesson`,
  procedural writes) **before** persistence, with a trust tier
  (agent-authored vs imported) gating quarantine. Complements the existing
  faithfulness review (which checks fidelity, not malice).
- **Frozen-snapshot working-memory writes.** Apply Hermes's write-now /
  apply-next-turn trick at the gateway for working-memory edits so the LLM
  prefix cache stays stable within a session — a cheap, high-value caching win
  layered onto the existing versioned `MemoryStore`.

These are explicitly **optional** and **not** on the skill-creation critical path.

---

## 6. Doctrine compliance

- **Reverse-engineering doctrine:** studied via DeepWiki first
  (`deepwiki.com/nousresearch/hermes-agent`, commit `6c73e8ff`), then two raw
  upstream files; all behaviour described generically; **no source, prompts,
  branded identity, file names, or schema vendored**.
- **Enhance, never duplicate/regress:** every Hermes mechanism is mapped onto an
  existing §-section/module (§2). The only net-new code is the synthesizer
  module + one predicate + one `source` value; the optimizer, ledger, catalog,
  consolidation, and primer are **reused, not re-built**.
- **AGI-purity / no hardcoded decisions:** all thresholds brain-resident; the
  synthesizer is generic over any trajectory — no verb lists, domain skills, or
  curated vocab.
- **MCP single-source-of-truth:** all CRUD goes through the existing
  `tool_skills` / procedural stores via the gateway; no private caches.
- **Design contract updated:** the new write path must be added to the §21.1
  diagram + §21.8 checklist + §3.5.9 ledger notes when implemented.
- **Durable lessons:** to be synced into `mcp-data/shared/memory-seed.sql`
  (noted here, seed left untouched per this research workflow's constraints).

---

## 7. Proposed milestone chunks

> Paste-ready for `rules/milestones.md` (dependency-ordered). **This document
> does not edit `milestones.md`.** Thresholds are brain-resident (AGI-purity).

### HERMES-ADOPT-1 — outcome predicate + synthesizer trigger seam
- **Goal:** add a `synthesizes_new_skill()` predicate to the `SessionOutcome`
  taxonomy (fires on `workaround_success` + brain-resident recurring-`success`
  cluster) and wire a synthesis call site into `reflect_on_session` at the
  §21.1 Step-3.5 stage, gated by `AutoLearnPolicy` / effort triage so it never
  fires an LLM every turn. No authoring yet — just the routing + a no-op hook +
  tests asserting the predicate fires only for the right outcomes/depth.
- **Key files:** `src-tauri/src/memory/outcome.rs`,
  `src-tauri/src/memory/reflection.rs` (or the `reflect_on_session` seam),
  `mcp-data/shared/memory-seed.sql` (recurrence/cluster thresholds).

### HERMES-ADOPT-2 — `brain/skill_synthesizer.rs` authoring module
- **Goal:** new module (sibling of `skill_optimizer.rs`) that, given a successful
  trajectory from `skill_optimizer::extract_turn_pairs_public(agent_traces)`,
  runs an auxiliary-LLM pass to extract `{name, description/when-to-use,
  parameter JSON-Schema, prompt snippet}`. Generic over any trajectory — no
  hardcoded domain logic. Returns a typed candidate; structural validation
  (name format, description cap, valid JSON-Schema, non-empty prompt) with
  fail-loud rejection. Unit tests with synthetic traces.
- **Key files:** `src-tauri/src/brain/skill_synthesizer.rs` (new),
  `src-tauri/src/brain/mod.rs`, `src-tauri/src/brain/skill_optimizer.rs` (reuse
  `extract_turn_pairs_public`), `mcp-data/shared/memory-seed.sql` (caps/floors).
- **Depends on:** HERMES-ADOPT-1.

### HERMES-ADOPT-3 — register synthesized skill + procedural twin (no-regression gate)
- **Goal:** persist the validated candidate via `upsert_tool_skill` with
  `source="synthesized"` (ON CONFLICT `(source,name)` → idempotent patch) AND
  mint a paired `procedural`-kind memory born at `TIER_COLD` / advisory-only
  (L4), so `procedural.rs` governs confidence from birth. Born-cold = the
  no-regression guarantee (never auto-injected until proven). De-dup against
  existing rows/procedures (patch, don't duplicate). Tests: a synthesized skill
  is retrievable but not injected; re-authoring the same name patches in place.
- **Key files:** `src-tauri/src/memory/tool_skills.rs`,
  `src-tauri/src/memory/procedural.rs`, `src-tauri/src/brain/skill_synthesizer.rs`,
  `src-tauri/src/commands/tool_skills.rs`.
- **Depends on:** HERMES-ADOPT-2.

### HERMES-ADOPT-4 — reuse surface: description-index injection + offline replay gate
- **Goal:** expose synthesized + procedural skills as a description-only
  "available procedures" index in the L1 primer (bodies hydrated on match —
  Hermes retrieval-by-description), and add an optional offline-replay
  no-regression check that reuses the optimizer's A/B harness to gate
  registration on `score_gain ≥ 0` (brain-resident floor). Tests for the index
  shape + the replay gate.
- **Key files:** L1-primer assembler (§20 path, e.g.
  `src-tauri/src/memory/context_pack.rs`),
  `src-tauri/src/brain/skill_optimizer.rs` (reuse A/B harness),
  `src-tauri/src/brain/skill_synthesizer.rs`.
- **Depends on:** HERMES-ADOPT-3.

### HERMES-ADOPT-5 — bounded idle re-test / promotion hook (proactivity, optional)
- **Goal:** on the `brain/maintenance_runtime.rs` idle tick, enqueue a **bounded**
  follow-up re-test of synthesized skills as traces accumulate, and route a
  Proven synthesized skill into `coding/promotion_plan.rs::build_promotion_plan()`.
  Guards: anti-recursion (idle jobs can't enqueue more; synthesizer can't fire
  inside a maintenance job), origin-trace provenance, silent-empty suppression.
- **Key files:** `src-tauri/src/brain/maintenance_runtime.rs`,
  `src-tauri/src/coding/promotion_plan.rs`,
  `src-tauri/src/memory/edge_conflict_scan.rs` (re-test sweep seam).
- **Depends on:** HERMES-ADOPT-3 (and benefits from -4).

### HERMES-ADOPT-6 — optional security hardening (pre-write scan + frozen snapshot)
- **Goal:** add a generic pre-write content scan (prompt-injection / exfiltration
  / homoglyph / invisible-char) with a trust-tier (agent-authored vs imported)
  gating quarantine on synthesized-skill bodies, `brain_ingest_lesson`, and
  procedural writes; optionally adopt the frozen-snapshot (write-now /
  apply-next-turn) working-memory write at the gateway. Off the critical path.
- **Key files:** `src-tauri/src/memory/store.rs` (or the write-back seam),
  `src-tauri/src/ai_integrations/gateway.rs`,
  `src-tauri/src/brain/skill_synthesizer.rs`.
- **Depends on:** HERMES-ADOPT-3 (independent of -4/-5).
