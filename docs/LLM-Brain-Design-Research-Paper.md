# Memory as a First-Class Architectural Layer: In a Controlled Taught-Solution Setting, Delivery Reliability — Not Model Capacity — Bounds a Weak Agent on Zork I

*A research report — ZorkGPT × external-memory bench, May–June 2026.*

> **Scope.** This report isolates delivery reliability as an agent-performance
> variable. In the 350/350 result, a correct strategy (distilled from a frontier
> run, §4.5) is held fixed, and the experiment varies only how reliably the
> brain-selected move reaches the engine. The same model's *unaided* (AGI-pure)
> score is 10–20 (§4.3). We make three separable claims — a memory **lift**
> (§4.3), a delivery-**reliability** result (§4.4), and an economic
> **distillation-through-memory** architecture (§5) — and keep them strictly
> apart.

> **Interactive results** (per-turn, live):
> [TaughtLocalLLM demo](https://terransyn.github.io/TerranSoul/zorkgpt/taughtLocalLLM/) ·
> [Claude Opus 4.8 run](https://terransyn.github.io/TerranSoul/zorkgpt/claude-opus-4.8/) ·
> [Zork bench hub](https://terransyn.github.io/TerranSoul/zorkgpt/) ·
> [Retrieval-bench leaderboard](https://terransyn.github.io/TerranSoul/leaderboard/) ·
> [Project home](https://terransyn.github.io/TerranSoul/).

---

## Abstract

Whether an LLM agent's long-term memory should live *inside* the model (as
weights or a long context window) or *outside* it (as a queryable store) is an
open architectural question, and one that the 2025–2026 literature increasingly
frames as central: a recent survey formalises agent memory as *"a write–manage–read
loop tightly coupled with perception and action"* and argues that *"memory … is
what turns a stateless text generator into a genuinely adaptive agent"* [15]. We
study the question empirically by wiring a deliberately weak local model —
`gemma4:e4b`, an effective-4B edge model served by Ollama (its E4B configuration
uses per-layer embeddings, so its effective parameter count is smaller than its
total footprint) — to the **system under test** (TerranSoul's external
memory-and-knowledge server, referred to throughout as "the brain" or "the
external memory server"), reached over the Model Context Protocol (MCP), and
measuring it on a canonical long-horizon, sparse-reward task: playing *Zork I*
through the Jericho Z-machine interface [11].
This task is genuinely hard: the TALES suite reports that *"even the top
LLM-driven agents fail to achieve 15% on games designed for human enjoyment"* and
that *"Zork1 still proves an insurmountable challenge even for modern
state-of-the-art LLMs"* [14]. Our harness runs the upstream `stickystyle/ZorkGPT`
agent **unmodified**, swapping only its memory and knowledge managers, isolating
the contribution of the memory substrate against two controls.

We report five results. **(1) Stability:** the external memory server served
1 682 memory operations across four canonical episodes with **0 errors**, and a
later demonstration ran 6 456 operations at a 0.17 % error rate. **(2) Four
failure classes:** building the bench surfaced four memory-layer failure modes —
silent ingest, mis-scoped reflection, frozen prompts, grammar-without-strategy
seeds — each diagnosable and fixable at the brain layer without retraining; the
first is the concrete face of the survey's warning that *"one bad write can
pollute the store for many steps downstream"* [15]. **(3) AGI-pure lift:** with
no task-specific seeds, the external memory server raises the same 4B from
**0** (both controls) to a **10–20** score and removes its fixation loops.
**(4) Reliability demonstration (principal result):** holding the model, the
taught solution, and the critic fixed, we vary only *how reliably the chosen
move is delivered to the engine*; intermittent delivery yields a
non-deterministic 73/177/death, while a **forked agent loop** that forces the
brain's move every turn via an exception-safe pointer drives the *same* 4B to
the full **350/350**, deterministically (396/396 moves, 0 errors). **(5) Frontier
reference:** Claude Opus 4.8 reaches 350 by *recall* and 50 by *cold reasoning*;
the public ZorkGPT frontier best is 115 — consistent with TALES' finding that
*"Claude models demonstrate the best overall performance"* yet all models
*"struggle to reason across extremely long-horizon contexts where important
information is sparsely scattered throughout"* [14]. Taken together, the results
separate three claims: the external memory server externalises task knowledge
that **lifts** the unaided 4B from 0 to 10–20; with a strategy held fixed,
**delivery reliability** — not added model capacity — was the binding constraint
that moved the *same* model from non-deterministic failure to deterministic
350/350; and the system under test enables an economic **distillation through
memory** in which a frontier model solves once and a cheap local model executes
thereafter. We position delivery reliability as a third agent-performance axis
distinct from retrieval quality and model capacity, and as support for treating
memory as a first-class architectural layer. On the orthogonal *retrieval* axis,
the external memory server is competitive or leading on four public memory
benchmarks against published baselines (agentmemory, MemoryPalace), with
retrieval holding R@10 64.0 % at 100 k-document scale and store operations
meeting interactive latency/token budgets to the million-entry tier (§4.6–4.7).
We are explicit about scope: this is a single-ROM, single-model-family
demonstration, and repeated-trial statistics and cross-game generalisation
remain future work (§6, §8).

---

## 1. Introduction

A capable LLM agent must remember: what it learned last episode, what failed last
room, and what the world looks like beyond its context window. The field now
treats this as foundational. Du's 2026 survey states plainly that *"memory — the
ability to persist, organize, and selectively recall information across
interactions — is what turns a stateless text generator into a genuinely adaptive
agent"* and that *"without memory, every Monday morning it rediscovers the
directory layout, re-reads the same README"* [15]. Two architectures answer the
need differently. The **model-internal** approach grows the context window or
fine-tunes weights so memory lives in the network. The **model-external** approach
factors memory into a separate, queryable store the agent reads and writes through
a tool interface — the lineage of MemGPT/Letta [2], Mem0 [1], HippoRAG [4], and
temporal knowledge-graph systems such as Zep/Graphiti [10], surveyed from several
angles in 2025–2026 [15,17,18,19].

The system under test here — hereafter the "external memory server" — is a Rust
memory server with a six-signal hybrid retriever (BM25/FTS5 + dense HNSW ANN +
reciprocal-rank fusion, $k{=}60$) and a typed knowledge graph, exposed to *any*
client — desktop app, coding agent, or game-playing agent — over MCP. This paper
asks the sharpest version of the architectural question: **does an external memory
server help a model so small it cannot hold the task in its head?** A 4B model is
a stringent probe because it has no slack — if the system under test helps, the
help is visible; if the model is the bottleneck, that is visible too.

We measure on *Zork I*: 0–350 points over ~400 optimal moves, fatal hazards, and a
parser vocabulary the model never saw in pre-training. The choice is deliberate.
TALES [14] characterises text adventures as having *"long-horizon causal
dependencies, and puzzles that require a composition of multiple reasoning skills
for progression,"* and BALROG [13] argues games demand *"intricate interactions,
advanced spatial reasoning, long-term planning, and continuous exploration of new
strategies."* Both report that current LLMs fall far short — BALROG: *"while
current models achieve partial success in the easier games, they struggle
significantly with more challenging tasks"* [13]; TALES: Zork I is *"insurmountable
… even for modern state-of-the-art LLMs"* [14]. That a 4B scores near zero unaided
is therefore expected, and it makes the measurable lift, and the
reliable-delivery demonstration, meaningful rather than trivial.

**Contributions.**

1. A controlled three-arm benchmark (external memory server / agent's-own-managers / none)
   on the *same* model, seed, and ROM, with the memory substrate as the sole
   independent variable (§3); design and transcripts are public [16].
2. Four agent-memory failure classes surfaced by the bench, each with the shipped
   fix and a public verification artifact (§4.2).
3. An **AGI-purity** discipline — no task seeds, walkthroughs, or hardcoded room
   logic in the memory server — under which it still lifts the 4B from 0 to 10–20
   (§4.3).
4. A controlled **reliability demonstration** (§4.4): holding model, knowledge,
   and critic fixed, varying only *delivery reliability of the chosen action*
   moves the score from a non-deterministic 73/177 to a deterministic 350. We
   argue this isolates *delivery reliability* as an agent-performance axis distinct
   from the retrieval-quality and model-capacity axes that dominate the literature.
   The strategy executed here is a taught solution, not an autonomous discovery by
   the 4B; the two regimes are kept strictly separate (§3.6–3.7, §6).
5. Cross-task evidence that the same memory server leads or is competitive on four
   independent retrieval benchmarks against published baselines (agentmemory,
   MemoryPalace, and the agent's built-in memory), plus systems-level latency, a
   blend ablation, and a token-economy result (§4.6–4.7), shown live on the
   leaderboard [21].

We run the upstream `stickystyle/ZorkGPT` agent [12] — an existing LLM-driven
Zork system that we did **not** author — unmodified, and contribute the external
memory substrate, the harness, and the controlled comparison around it. A
**Threats to Validity** analysis (§7) and a reproducibility manifest (§3.9)
state the boundaries of every claim above.

---

## 2. Related Work

### 2.1 Agent memory: mechanisms and 2025–2026 surveys

The external-memory lineage runs from MemGPT/Letta [2], which frames the LLM as an
OS paging memory in and out of context, through Mem0 [1], whose extraction-and-
consolidation pipeline (and LLM-arbitrated conflict resolution, which the system
under test adopts at its `memory_edges` layer [20]) targets production scale, to
HippoRAG [4], which uses a personalized-PageRank graph for multi-hop recall, and
spatial schemes such as MemoryPalace [3]. The 2025–2026 surveys converge on a
common spine. Du [15] formalises memory as a *"write–manage–read loop tightly
coupled with perception and action."* *From Storage to Experience* [32] traces
three evolutionary stages driven by *"the necessity for long-range consistency, the
challenges in dynamic environments, and the ultimate goal of continual learning."*
A *Unified Representation–Management* survey [33] organises methods by
construction, update, and query. Critically for our §4.2, the *Mnemonic
Sovereignty* security survey [31] characterises agent memory as *"malleable,
rewritable, and socially propagating,"* and Du [15] warns that *"one bad write can
pollute the store for many steps downstream"* — the abstract statement of the
silent-ingest failure we hit concretely.

### 2.2 Memory and long-horizon benchmarks

Three benchmarks anchor the field: **LoCoMo** [34] (multi-session, ~1.5k questions
over single-hop/multi-hop/open-domain/temporal recall), **LongMemEval** [35] (~500
questions including knowledge updates and multi-session recall), and **BEAM**
(1M/10M-token scales). **MemoryAgentBench** [22] grounds evaluation in cognitive
science — accurate retrieval, test-time learning, long-range understanding,
selective forgetting — and **AMA-Bench** [23] targets long-horizon memory for
agentic applications. These benchmarks expose a sobering gap: Du [15] reports that
*"models that score near-perfectly on LoCoMo plummet to 40–60 % in MemoryArena,"*
and that maintaining consistent behaviour across sessions *"is a distinct — and
largely unsolved — challenge."* The external memory server's standing on LoCoMo,
LongMemEval-S, and AgentMemory is reported in §4.6; this paper's Zork bench is the
long-horizon *acting* complement to those *retrieval* benchmarks.

### 2.3 Retrieval, graph memory, and agentic RAG

The system's retriever fuses lexical and dense channels with
reciprocal-rank fusion and applies two techniques from the literature: **Contextual
Retrieval** [8], which situates a chunk before embedding, and **HyDE** [9], which
embeds a hypothetical answer — wired, per our ablations, as a *per-query-class
tool* rather than a global default [20]. The graph layer follows **GraphRAG**'s
Leiden-community lineage and the typed-edge designs of **Zep/Graphiti** [10],
**MAGMA** [24] (a multi-graph agentic memory architecture), and **PersonalAI** [25]
(a systematic comparison of KG storage/retrieval for personalized agents). The
broader move toward *agentic* retrieval is surveyed by Singh, Ehtesham et al. [26]:
Agentic RAG *"transcends [static] limitations by embedding autonomous AI agents
into the RAG pipeline,"* whose agents *"leverage agentic design patterns
reflection, planning, tool use, and multi-agent collaboration to dynamically manage
retrieval strategies."* That survey names *"Memory Management and Long-Term
Adaptation"* and *"Safety, Trust, and Governance in Autonomous RAG Systems"* as
critical open challenges [26] — precisely the territory of our §4.2 (reliability
of writes) and §4.4 (reliability of delivery).

### 2.4 Agent reasoning, self-evolution, and skill libraries

ReAct [5] interleaves reasoning and acting; Reflexion [6] adds verbal self-feedback
across episodes; Voyager [7] shows an LLM accumulating a *skill library* in
Minecraft. The 2025–2026 self-evolution wave extends this: **AutoSkill** [27]
performs *"experience-driven lifelong learning via skill self-evolution,"* and RL
frameworks now fold a validated skill library into training [28]. Our room-scoped
reflections (§4.2) are Reflexion-style feedback given *spatial* scope; our "taught
skill" (§4.4) is a Voyager-style library entry. We deliberately separate *having*
the skill from *executing* it — the distinction the self-evolution literature
tends to merge — which is what exposes the delivery-reliability axis.

### 2.5 Games as agent benchmarks; text-adventure agents

Jericho [11] exposes 55 interactive-fiction games to agents with ground-truth
state, valid-action sets, and scores; we use its `zork1.z5`. BALROG [13] motivates
games as agent benchmarks — *"real-world tasks require handling intricate
interactions, advanced spatial reasoning, long-term planning, and continuous
exploration of new strategies"* — and reports broad struggle on the hard tasks.
TALES [14] unifies Jericho, ALFWorld, ScienceWorld, and TextWorld and supplies the
framing this paper builds on: text adventures are *"a grand challenge for
agents due to their length, long-horizon causal dependencies,"* *"all models
struggle to reason across extremely long-horizon contexts where important
information is sparsely scattered throughout,"* *"Claude models demonstrate the
best overall performance,"* and yet *"Zork1 still proves an insurmountable
challenge even for modern state-of-the-art LLMs"* [14]. **TextQuests** [29] and
**Dual-Scale World Models** [30] extend the long-horizon/hard-exploration line.
The upstream agent we run, **ZorkGPT** [12], peaks at 115/350 in its public
continuous run with a frontier `deepseek` agent + 27B extractor — our frontier-
scaffold reference (§4.5).

### 2.6 Position

Prior work largely optimises *retrieval quality* [1,4,8,9] or *reasoning
structure* [5,6,7]. The agentic-RAG survey lists *memory management* and
*governance/trust* as open [26]; the memory surveys warn that bad writes propagate
[15,31]. We contribute an empirical isolation of a *third* axis — **does the chosen
action actually reach the world, every turn?** — and show, with model and strategy
held fixed, that this delivery-reliability axis dominated outcome in our setting
(§4.4). To our knowledge this is the first clean separation of *delivery
reliability* from *model capacity* on a long-horizon game.

---

## 3. Methods

### 3.1 Benchmark design

We run upstream `stickystyle/ZorkGPT` [12] (pinned commit) against Jericho's
`zork1.z5` [11] inside a sealed Docker image. The agent, critic, information-
extractor and strategy-generator are all the **same** local model (`gemma4:e4b`
via Ollama) across arms; seed, temperature and ROM are held constant. Only the
cognitive substrate is swapped:

| Arm | Memory + Knowledge substrate |
|---|---|
| `none` | bare LLM, episode-local only |
| `zorkgpt-default` | ZorkGPT's own `MemoryManager` + `KnowledgeManager` (the upstream thesis) |
| **`terransoul-brain`** | external memory server over MCP — `brain_search` reads, `brain_ingest_lesson` writes, KG edges |

The external memory server runs as a separate OS process; the bridge speaks MCP
JSON-RPC 2.0 over a real TCP boundary (container → host), bearer-token
authenticated, with explicit error accounting — the same transport a production
client uses.

### 3.2 The brain bridge as a harness

The bridge converts raw Z-machine state into importance-scored, KG-structured
memories: **signal-derived importance** (`score_delta>0` → 10; inventory change →
8; first visit → 7; revisit → 6; 3-repeat loop → 2 + a `principle` dead-end
memory; death → 10 + a `fatal` memory), **structured content** (`prefix |
Location | Action | Result | Score | Inventory`) so the KG auto-extractor builds
typed edges, and **principle-before-episodic retrieval** so cross-episode rules
are not buried under repeated specifics — a Reflexion-style mechanism [6] given
spatial scope.

### 3.3 The knowledge-graph layer

Map adjacency and object/location pairs are promoted into a typed `memory_edges`
graph via the MCP `brain_add_edge` tool (capability-gated, idempotent on
`(src,dst,rel_type)`). A direct probe confirms `Living Room —exits_via_west→
Kitchen` persists across restarts and is queryable by *any* MCP client — the
spatial graph one agent builds is legible to the next, in the spirit of the
graph-memory architectures of §2.3 [10,24,25].

### 3.4 Hybrid retrieval

Reads fuse four retrievers (dense HNSW, lexical FTS5, KG-neighbour, freshness)
with reciprocal-rank fusion ($k{=}60$); Contextual-Retrieval-style situating [8]
and HyDE expansion [9] are applied, the latter gated per query class after
ablation (our `rrf_rerank` is the canonical default on LoCoMo; see the retrieval
ablations in [20]). RRF over four retrievers is chosen for robustness: a failing
retriever contributes nothing rather than poisoning the top-$k$.

### 3.5 Task-agnostic harness controls (AGI-pure)

A sequence of perception/decision gates was added at the bridge layer, each
*domain-agnostic* and validated by a sub-10-second reproduction before any bench:
ID-keyed mapping by Z-machine `location_id` (so identically-named maze rooms are
distinct nodes); object-tree/valid-exit validation; id-based loop-breaking and
hard exit-pruning after repeated wall-bumps; one-shot light-acquisition; and a
delivery rule that banks *valued* (score-bearing) items over junk — value learned
from the score signal, never a hardcoded treasure list. The loop-breaker and
completion-verifier patterns generalise mechanisms credited to an upstream
agent-harness study [20].

### 3.6 AGI-purity discipline

A standing rule forbids seeding the external memory server with Zork maps,
routes, walkthroughs, room names, or curated vocabularies, enforced by a grep gate
("zero verb/score constants in the bridge source"). All §4.3 results are produced
task-naïve. The *only* exception is the explicitly-labelled demonstration of §4.4,
whose taught solution is a demo artifact that is **never** written to the memory
seed (verified by grep) and is gated behind a runtime flag.

### 3.7 The TaughtLocalLLM demonstration protocol

To isolate *delivery reliability* from *strategy discovery*, §4.4 gives the
external memory server the move-level solution — distilled from the Claude Opus
4.8 350/350 run of §4.5, a Voyager-style skill [7] — and measures only whether
the 4B can *execute* it under the agent loop. Agent and critic still run every
turn; we vary how reliably the chosen move reaches the engine. This demonstrates
an architectural property, **not** a capability claim about the 4B discovering
Zork.

### 3.8 Smoke and bench harness

Smoke tests run without the Z-machine against a live memory server in ~30 s; the
canonical bench runs in Docker. Bridge, smoke suite, specs, seeds and per-turn
transcripts are public [16]; the two reported runs are rendered per-turn on the
interactive evaluation artifact pages [17,18].

### 3.9 Reproducibility manifest

Each held-fixed factor below is pinned in a tracked verification artifact rather
than described only in prose, so an external replicator can reconstruct the exact
configuration. The manifest is intentionally explicit about the one factor that
distinguishes our demonstration from upstream ZorkGPT — which avoids predetermined
solutions — namely the runtime-gated taught solution of §4.4.

| Factor | Where it is pinned |
|---|---|
| System under test bridge + orchestrator-fork commit | `benchmark/scripts/zork-bench/` (pinned) [19] |
| Upstream ZorkGPT commit | `stickystyle/ZorkGPT` pinned commit in the Dockerfile [12,16] |
| Docker image / build args | `benchmark/scripts/zork-bench/Dockerfile` (`OLLAMA_BASE_HOST`) [16] |
| Game ROM | Jericho `zork1.z5` [11] |
| Local model | `gemma4:e4b` via Ollama (model digest recorded in run log) [16] |
| Decoding (seed, temperature, top-p) | per-run config recorded in the spec headers [16] |
| Critic | enabled in all reported runs |
| Memory seed (durable lessons) | `mcp-data/shared/memory-seed.sql` [20] |
| Taught-solution flag (§4.4 only) | `TAUGHT_SOLUTION_DEMO=1` runtime gate; **never** in the memory seed (grep-verified) |
| Reproduce command + expected output | Appendix A |

Digest-level reproducibility (ROM SHA-256, image hash, and model digest) is listed
as future work in §8.

---

## 4. Results

### 4.1 Architectural stability

Two canonical 2-episode × 100-turn runs on `gemma4:e4b` (specs 005/006) executed
**1 682 MCP memory operations with 0 errors** while the external memory server
concurrently served the desktop app for four hours. A later, longer demonstration
(§4.4) ran **6 456 operations at 11 errors = 0.17 %**, under our 5 % bar.

### 4.2 Four agent-memory failure classes (and their fixes)

Each failure would break *any* LLM+memory stack and was found and fixed at the
memory-server layer:

1. **Verify, don't trust.** Every `brain_ingest_lesson` had silently stored zero
   rows for the entire bench history — the MCP client treated a structured error
   envelope as success. This is the concrete form of Du's warning that *"one bad
   write can pollute the store for many steps downstream"* [15]; in our case the
   "bad write" was *no* write, undetected. A 14-line fix (honour `result.isError`;
   require `category`) plus a hard "is it retrievable next episode?" probe closed
   it. *A memory layer with no verification probe will lie to you.*
2. **Reflections require spatial scope.** One episode-level summary is dominated by
   late-episode wandering. Per-room reflections tagged `loc_<id>` and grounded in
   that room's transcript-tail are surfaced by the next episode's *room-scoped*
   retrieval exactly when the agent re-enters the room — Reflexion [6] at the right
   granularity for an embodied agent.
3. **The prompt is a snapshot, not a stream.** Upstream builds the system prompt
   once at episode start; a lantern discovered at turn 11 was never seen because
   the model still ran the turn-0 prompt. A `reload_knowledge_base()` push fixes
   it — only possible because the bridge, not the model, owns the prompt.
4. **Grammar is not strategy.** A seed listing verbs without strategy ("open closed
   containers; take on sight; never repeat a failed action") left the agent
   examining a closed mailbox and walking away for 100 turns. Replacing the seed is
   a `brain_ingest_lesson` call, not a fine-tune.

### 4.3 AGI-pure arm: the external memory server lifts the weak model where controls stay at zero

With no task seeds, the external memory server raises the *same* 4B above both
controls and suppresses fixation loops:

| Arm | Score | Reach |
|---|---:|---|
| **`terransoul-brain`** | **10–20** | egg (+5) → white-house interior (+10) → Living Room/trophy case |
| `zorkgpt-default` | 0 | stuck on the surface; never enters the house |
| `none` | 0 | surface loop |

Cross-episode behavioural change is real even where the score plateaus: in spec
006, episode 2 reached *Up a Tree* (the egg room), unvisited in episode 1, via a
reflection hydrated from episode 1. The system under test delivered new strategy;
the 4B did not always follow through — the boundary that motivates §4.4, and an
instance of TALES' finding that long-horizon, sparsely-cued progression defeats
current models [14].

### 4.4 Reliability demonstration: intermittent vs. reliable delivery

Holding the model, the taught solution, and the critic fixed, we vary only **how
reliably the chosen move is delivered to the engine**:

| Delivery mode | Result | Determinism |
|---|---:|---|
| Intermittent (serving invoked ~60 % of turns; rejection-sampling desyncs a blind pointer) | 73 / 177 / death | **non-deterministic** |
| **Reliable (orchestrator-loop fork forces the brain's move every turn)** | **350 / 350** | **deterministic** |

The cause turned out to be a loop-bookkeeping bug, not a capacity limit. The agent
loop incremented its turn counter *unconditionally* at the loop top, so any turn
whose LLM call threw (and fell back) advanced the counter while skipping the
served move — desyncing the lamp-sensitive solution. We replaced turn-count
indexing with a **self-managed pointer that advances only when a move is actually
executed** at the engine boundary, making delivery **exception-safe**: a failed
turn leaves the pointer untouched and the next execution resumes the exact order.
The *same* 4B then served all **396/396 moves 1:1, 0 errors, reaching 350 exactly
at move 396**; a no-LLM replay of the identical sequence confirms the 350 ceiling.
The agent and critic ran every turn. The per-turn trace is public [17]. The
principle — *key delivery on actual execution, never on the loop's turn counter*
— is itself stored in the memory server (importance-8) and seeded durably [20].

**What "delivery reliability" means mechanically.** The variable is not model
fluency but whether the brain-selected action token reaches the Z-machine on the
turn it was chosen. In the intermittent regime, a turn whose LLM call raised (a
dropped/!malformed tool call, a fallback path, or a context-saturated decode) still
advanced a *blind* turn-counter index into the taught sequence, so the lamp-gated
ordering desynced and the run diverged non-deterministically. In the reliable
regime the execution-keyed pointer makes the delivered move equal the chosen move
whenever the move is valid — formally, raising $R_d = P(E_t = A_t \mid A_t\ \text{valid})$
from intermittent toward 1.0. This is a harness property, independent of the
4B's own proposals, which are overridden.

**Measured ablation map.** The rows below situate the reliability contrast using
only arms measured in this revision. Additional controls are listed as future work
(§8), but no numbers are reported for unrun arms.

| Arm | Purpose | Status |
|---|---|---|
| `none` / `zorkgpt-default` (no taught solution) | weak-model and upstream-memory baselines | measured: 0 (§4.3) |
| `terransoul-brain`, AGI-pure | memory lift without a taught solution | measured: 10–20 (§4.3) |
| No-LLM script replay of the taught sequence | establishes the solved-sequence ceiling | measured: 350 (this §) |
| Taught solution, intermittent delivery | delivery-reliability sensitivity | measured: 73/177/death (this §) |
| Taught solution, reliable (execution-keyed) delivery | principal demonstration | measured: 350/350 (this §) |

The contrast between the no-LLM replay (350) and the reliable-delivery run (350,
agent + critic live) is what shows the *harness*, not the 4B's reasoning, carries
the taught solution — exactly the claim §4.4 is scoped to make.

### 4.5 Frontier reference: Claude Opus 4.8 and the ZorkGPT scaffold

To situate the demonstration against the strongest available agents, we ran a
frontier model on the same ROM and record the public ZorkGPT scaffold's best:

| Agent | Mode | Score | Note |
|---|---|---:|---|
| Claude Opus 4.8 — recall | reproduces a known solution, played move-by-move | **350** | real run; recall, not from-scratch reasoning |
| Claude Opus 4.8 — no recall | cold, genuine in-context reasoning | 50 | below the scaffolded frontier |
| ZorkGPT ep120 | frontier `deepseek` + 27B, critic off | 115 | best of 122 public episodes |
| ZorkGPT (typical) | frontier, full | 88–102 | public SOTA-ish |

Two honesties follow. Opus "leads" the frontier scaffold via **recall** (the same
basis `deepseek` uses), not raw reasoning — its cold reasoning (50) is *below* the
115 scaffold; that Claude leads is itself consistent with TALES' *"Claude models
demonstrate the best overall performance"* [14]. And the unaided 4B's near-zero
score is exactly what TALES and BALROG predict for any model unaided on Zork
[13,14]. The full per-turn Opus run is public [18].

### 4.6 Cross-task: the same memory server across four retrieval benchmarks, against published baselines

The Zork bench (§4.1–4.5) measures the *acting / long-horizon* axis. The *same*
external memory server is independently measured on the *retrieval-quality* axis
across four public memory benchmarks; all rows are live on the leaderboard [21],
and every comparison below is against a published or built-in baseline rather than
a self-reported "standing." Du's caution that LoCoMo-strong systems can collapse on
harder, multi-session settings [15] is exactly why we report both axes.

**AgentMemory Quality** (240 observations, 20 queries). The system's
hybrid-RRF retriever against the two memory substrates a coding agent would
otherwise use:

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | p50 |
|---|---:|---:|---:|---:|---:|---:|
| **TerranSoul (hybrid RRF)** | **44.8 %** | **67.1 %** | **80.7 %** | **98.2 %** | **100.0 %** | 16.8 ms |
| Built-in (CLAUDE.md / grep) | 37.0 % | 55.8 % | 70.6 % | 80.3 % | 82.5 % | 0.08 ms |
| Built-in (200-line MEMORY.md) | 27.4 % | 37.8 % | 42.3 % | 56.4 % | 65.5 % | 0.02 ms |

**LongMemEval-S** (500 cleaned questions). Two configurations of the system
under test — the corpus-aware `search` (lexical weighting + gated KG boost) and the
plain `rrf` shown on the public leaderboard [21] — against the published systems
the field reports, including **MemoryPalace** [1,3]. Every system-under-test number
below is taken from a committed result file [16]. *(Both rows are the direct-store,
no-embed path — `longmemeval_s_terransoul.json`, 2026-06-09. The production
embedding path — BENCH-AM-6.1 — measures R@10 99.6 %, NDCG@10 91.3 %, MRR 92.6 %
with corpus-aware lexical weighting; see
`benchmark/terransoul/longmemeval-s/README.md`.)*

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| **TerranSoul (`search`)** | **98.6 %** | **99.8 %** | **100.0 %** | **88.8 %** | **89.1 %** |
| TerranSoul (`rrf`, leaderboard) | 95.0 % | 99.8 % | 100.0 % | 74.9 % | 69.3 % |
| agentmemory (published) | 95.2 % | 98.6 % | 99.4 % | 87.9 % | 88.2 % |
| MemoryPalace (published) | ~96.6 % | — | — | — | — |

The system under test leads at R@10/R@20 in both configurations; the corpus-aware
`search` config also edges agentmemory and MemoryPalace at R@5 (98.6 %) and
NDCG@10 (88.8 %), while the leaderboard `rrf` config is on par with agentmemory at
R@5. We name both configs rather than headline a single best-of-runs number.

**LoCoMo retrieval (MTEB slice, 1 976 queries).** The committed full-slice result
for the fused `rrf` retriever is reported below [16,21]:

| Configuration | R@5 | R@10 | Note |
|---|---:|---:|---|
| `rrf` (committed, full 1 976-query slice) | 50.0 % | **57.2 %** | fused lexical + dense + KG + freshness |

The production pipeline layers a cross-encoder reranker and per-query-class HyDE on
top of this fused base; their measured effect is characterised in the retrieval
ablations of the design contract [20]. We report only the committed `rrf` slice
here and do **not** quote a reranked headline number without a committed result file
to back it. End-to-end *QA-J* scores from Mem0, Letta/MemGPT and MemoryPalace are
not directly comparable to this retrieval-only table; the adapter's
`--qa-eval=mem0-paper` mode bridges that gap with the Mem0 paper's LLM-as-judge
protocol [20].

**LoCoMo at-scale.** On a 100 k-document corpus (100 adversarial queries), the
routed production retriever (`rrf`) holds **R@10 64.0 %** (R@5 55.0 %, R@20
68.5 %, NDCG@10 46.6 %, MRR 42.1 %) at **p50 2.05 s / p95 6.85 s** [16,21] —
retrieval quality barely degrades from the small-corpus slice as the corpus grows.
The IVF-PQ compression arm — previously zero-recall because the shard router routed
queries off the single index-bearing shard, now fixed to probe all shards —
retrieves **R@10 28.5 % at p50 331 ms** on the same 100 k corpus: ≈6× faster than
exact RRF at roughly half the recall, the expected approximate /
product-quantization tradeoff. Both rows are on the public leaderboard [21].

### 4.7 Systems performance, ablation, and token economy

Three further results substantiate the engineering claims the architecture rests on;
all are reproducible from the benchmark harness [16,36].

**Retrieval and store latency (million-memory bench [16,36]).** The HNSW vector
stage used by hybrid search returns top-10 over 768-dim vectors at **p50 0.57 ms /
p95 0.74 ms / p99 0.86 ms** (10 k smoke tier; the hard gate is p99 ≤ 100 ms at the
full 1 M tier). At 1 M entries the SQLite path bulk-writes at **137 521 rows/s**
(7.27 s) and full-reads at **469 036 rows/s** (2.13 s), and capacity-pruning
10 500→9 500 entries completes in 0.26 s — the external memory server stays inside
interactive budgets as the store scales, which is what "it scales" must mean
operationally.

**Hybrid-blend ablation (10 k adversarial corpus, n = 100 [16,36]).** Collapsing
the six-signal RRF blend to vector-only drops R@10 from a 64.5 % blended baseline
to **54.5 % (−10 pp)**, with NDCG@10 falling 52.5 %→37.6 %. This is the empirical
justification for the multi-retriever fuser over the vector-only default common in
the literature: a single failing retriever contributes nothing under RRF rather than
poisoning the top-$k$.

**Token economy.** For equal retrieval quality, the rrf retriever returns **2,798
retrieved-memory tokens/query versus 32 660 tokens/query** for a full-context paste —
**91.4 % fewer tokens** (committed, the same case set as the AgentMemory rows above)
[16,20]. A separate session-anchored measurement records a ~29×
aggregate reduction on brain-seeded lookups (an honest 30–100× per-query range,
falling to ~3–5× session-wide once non-seeded code search is included) [36]; we
report the falsifiable session number rather than a headline marketing multiple.

**Personal-AI parity (OpenJarvis head-to-head [36]).** To check the assistant
pipeline against an independently-built reference rather than only against
published numbers, both the system under test (TerranSoul) and **OpenJarvis**
(Stanford, Apache-2.0) answer the *same* 22 prompts across seven personal-AI
archetypes (daily-digest, deep-research, code-assistant, scheduled-monitor, chat,
voice, VRM-overlay) with the *same* model (`gemma4:12b-it-qat`) on the *same* GPU,
each given the identical ground-truth context, and each answer is scored 0–10 by
the same judge model. Running each stack as its real assistant — TerranSoul with
its production companion prompt, its real sampling temperature (0.7), and the
spec-030 VTuber emotion-expression cues its VRM avatar genuinely emits — TerranSoul
scores **9.82/10 at p50 1.01 s** versus OpenJarvis' **9.55/10 at p50 3.19 s**:
the system under test leads on quality at **~3.2× lower latency**, both at
**\$0** marginal cost (fully local, no API). We flag the methodology honestly: an
earlier pass had under-built the system's side (temperature 0, a generic
prompt, no avatar emotion) and tied at 9.3/9.5; correcting it to the *actual*
production pipeline — not tuning to the judge — is what surfaces the lead. The
single archetype that still moves the margin is the avatar-overlay task, where the
system's emotion expression is a real capability OpenJarvis lacks; on the
text-only archetypes the two are within judge noise. Same model, same injected
context, same judge throughout. Energy is reported `n/a` rather than fabricated —
the test GPU (RTX 3080 Ti) does not expose `power.draw` through NVML, so no
software on this machine (OpenJarvis' own telemetry included) can measure it.

---

## 5. Discussion

We separate three claims that are easy to conflate.

**Claim A — Memory lift (§4.3).** With no task-specific seeds, externalising
task knowledge into the external memory server raised the *same* effective-4B from
0 (both controls) to 10–20 and removed its fixation loops. This is a genuine,
discovery-side contribution of the memory substrate, modest because the 4B's
own planning ceiling binds it.

**Claim B — Delivery reliability (§4.4).** Holding model, taught solution, and
critic fixed, the variable that moved the agent from a non-deterministic
73/177 to a deterministic 396-move, 350/350 completion was *delivery
reliability*, not added model capacity. The model never got larger; *delivery*
got reliable. Where a strategy already exists, model size gates **execution
fidelity**, and a thin, exception-safe harness can close that gap without
retraining. We state Claim B narrowly: it is a controlled isolation result on
one game with one model, not evidence that small models are broadly sufficient.

**Claim C — Distillation through memory, not weights (§4.5→§4.4).** The taught
skill is the Claude Opus 4.8 solution stored in the external memory server and
replayed by a 4B: a frontier model solves once, the memory server persists the
result, and a cheap local model executes thereafter. Nothing is retrained — the
knowledge lives as editable, inspectable memory and transfers to any client that
queries the same memory server. For the broad class of *already-solved* tasks this
trades repeated frontier inference for a one-time capture plus cheap local
execution.

**The mental model, stated carefully.** It is tempting to summarise Claims B–C
as "the memory server is the intelligence and the LLM is the actuator." We prefer
the precise version: **the system under test externalises task knowledge and action
selection into a persistent memory layer, while the local model acts as a
constrained executor under the harness.** In the taught-solution regime the memory
server is serving a stored action sequence, not reasoning anew — which is exactly
the property the experiment isolates.

**Delivery reliability is a distinct, under-studied axis.** The literature
optimises retrieval [1,4,8,9] and reasoning [5,6], and the agentic-RAG survey lists
*memory management* and *governance* as open [26] — but the variable that dominated
our outcome lived in neither place: it was the loop's bookkeeping (turn-count vs.
execution-count indexing). This is a general hazard for any "brain decides,
tool/LLM acts" stack, and it sits alongside the survey-level warning that bad
*writes* propagate [15,31]: bad *delivery* propagates too.

**Memory as a first-class layer.** Each §4.2 failure was *observable* only because
memory was external: a health endpoint exposed the silent ingest; query-time
tag/kind filters exposed mis-scoped recall; bridge ownership of the prompt exposed
the frozen snapshot; a tagged, versioned seed made strategy editable as data — a
`brain_ingest_lesson` call, not a fine-tune (cf. skill-library self-evolution
[7,27,28], but at the data layer). A model-internal stack has none of these
affordances: you cannot probe, scope, diff, or re-seed weights between episodes.

**Recall vs. reasoning.** The Opus rows (§4.5) caution against over-claiming.
Frontier "wins" on Zork are largely *recall* of a famous game; cold reasoning is
weaker, and TALES/BALROG show even frontier models far from solving long-horizon IF
[13,14]. The 4B demonstration is explicitly about *executing delivered strategy*,
not discovering it — which is why we keep the taught demo and the AGI-pure arm
strictly separated.

---

## 6. Limitations

- **The AGI-pure score is low (10–20).** With no taught solution, the 4B's
  multi-step planning ceiling — not the memory layer — binds the score; every
  architectural promise the system under test makes is honoured in the verification
  artifacts. This is the expected regime per TALES/BALROG [13,14]; a 13B/30B
  reasoning model is the next knob.
- **The 350 is a demonstration, not a discovery.** §4.4 *gives* the memory server
  the solution to isolate delivery reliability; it shows reliable serving lets a
  weak actuator finish, not that the 4B can solve Zork unaided. The taught
  knowledge is demo-only and never enters the AGI-pure memory server.
- **Single ROM, single model family.** Results are on `zork1.z5` with `gemma4:e4b`
  plus a frontier reference. Generalisation across the Jericho/TALES surface
  [11,14] and model families is future work.
- **Stochastic decoding.** Even seeded, KV-cache eviction over long contexts causes
  minor drift; we report per- and cross-episode deltas, and the §4.4 determinism is
  *of delivery* (the actuator's own proposals remain stochastic and are overridden).

---

## 7. Threats to validity

We state the attacks a reviewer would make and our answer to each.

| Threat | Our answer |
|---|---|
| "It is just replaying a known walkthrough." | Correct, and deliberate. §4.4 is a *delivery-reliability isolation* experiment, not a discovery claim; the no-LLM replay row makes the solved-sequence ceiling explicit. |
| Single game (Zork I). | Zork I is our first long-horizon test; the Jericho/TALES surface [11,14] is the natural next step (§8). |
| Single local model (`gemma4:e4b`). | The reliability result is shown for one effective-4B model; model-family generality is not established here (§8). |
| Possible walkthrough leakage into the AGI-pure arm. | The taught solution is runtime-gated (`TAUGHT_SOLUTION_DEMO=1`) and never written to the memory seed; a grep gate forbids Zork maps/routes/vocabularies in the bridge source (§3.6). |
| Semantic (not just literal) leakage via embeddings. | The grep gate catches literal strings only; a public-web-pretrained embedder *could* encode Zork layout. We acknowledge this as an open limitation; isolating it requires a leakage-controlled embedder, which we have not run. |
| "System under test vs. a flat script — what does the memory server add?" | The ablation map (§4.4) lists a no-memory-server script-replay control as the solved-sequence ceiling; the system's added value is the retrieval, KG, and editable-seed affordances of §4.2/§5, not a lower replay score. |
| Determinism / reproducibility. | The reproducibility manifest (§3.9) pins commit, image, ROM, model, decoding, critic, and seed; cryptographic digests and repeated-trial statistics are the remaining step (§8). |
| KG-edge extraction accuracy. | Map adjacency is parsed from Jericho's valid-exit signal at the bridge, not free-text-extracted by the 4B (§3.3); extraction error is therefore the engine's, not the model's. |

## 8. Future work toward a stronger result

The current report is a controlled single-game, single-model demonstration. Future
work to strengthen external validity and reproducibility includes:

1. **Repeated trials per arm.** Run each arm in the §4.4 ablation map 10–30 times
   and report mean / max / min / standard deviation, completion rate, death rate,
   delivery-error rate, and move accuracy, instead of single deterministic runs.
2. **Cross-game generalisation.** Run the *unchanged* bridge on additional Jericho
   games (e.g. Zork II, Enchanter, the short *9:05*) to test whether the AGI-pure
   lift and the delivery-reliability effect hold beyond Zork I.
3. **Cross-model generalisation.** Repeat with other local models to test whether
   the delivery-reliability axis is model-family-independent.
4. **Expand the ablation map.** Execute additional controls (brain-suggests
   / model-decides; reliable delivery with injected drops; fresh empty memory server).
5. **Digest-level reproducibility.** Attach ROM SHA-256, Docker image hash, and
   `gemma4:e4b` model digest to the manifest (§3.9).
6. **Quantify the 4B's failure economy.** Measure tool-call/JSON-malformation rate
   and context-saturation effects per 100 turns to ground the $R_d$ definition of
   §4.4 empirically.
7. **Extend IVF-PQ recall to the 10 M tier.** The IVF-PQ at-scale recall bug (the
   shard router routed queries off the index-bearing shard) was **fixed** — IVF-PQ
   now measures R@10 28.5 % at 100 k (§4.6). The remaining step is running the same
   fixed path at the 10 M-document tier (and tuning `nprobe`) for a measured 10 M
   recall.

---

## 9. Conclusion

We wired a deliberately weak effective-4B model to an external memory server over
MCP and measured it on *Zork I* — a task TALES calls *"insurmountable … even for
modern state-of-the-art LLMs"* [14]. Three claims survive the controls.
Externalising task knowledge **lifts** the unaided 4B from 0 to 10–20 with no
task seeds (§4.3). With a strategy held fixed, **delivery reliability** — whether
the chosen move reaches the engine every turn — and *not* added model capacity, was
the binding constraint that moved the *same* model from a non-deterministic 73/177
to a deterministic 350/350 (§4.4); we position this as a third agent-performance
axis distinct from retrieval quality and model capacity. And the system under test
enables **distillation through memory** (§4.5→§4.4): a frontier model solves once,
a cheap local model executes thereafter, with the knowledge living as editable,
inspectable data rather than weights.

On the orthogonal retrieval axis, the same external memory server is competitive
or leading on four public memory benchmarks against published baselines —
agentmemory, MemoryPalace, and the agent's own built-in memory — holds R@10 64.0 %
retrieval at 100 k-document scale, and meets interactive latency with a 91.4 %
token-economy advantage as the store scales to the million-entry tier (§4.6–4.7).
Together these results are a concrete argument for treating memory as a first-class
architectural layer: observable, probeable, and editable in ways a model-internal
store is not. The boundaries are explicit (§6–§7) — a single ROM and model family,
single-trial runs, and at-scale IVF-PQ recall — and define the path to a stronger
result (§8).

---

---

## 10. References

**External work — agent memory, retrieval, reasoning.**

1. *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory.* 2025. arXiv:2504.19413.
2. Packer et al. *MemGPT: Towards LLMs as Operating Systems* (Letta). 2023. arXiv:2310.08560.
3. *MemoryPalace / spatial agent memory.* 2025. arXiv:2503.06868.
4. Gutiérrez et al. *HippoRAG: Neurobiologically Inspired Long-Term Memory for LLMs.* 2024. arXiv:2405.14831.
5. Yao et al. *ReAct: Synergizing Reasoning and Acting in Language Models.* 2022. arXiv:2210.03629.
6. Shinn et al. *Reflexion: Language Agents with Verbal Reinforcement Learning.* 2023. arXiv:2303.11366.
7. Wang et al. *Voyager: An Open-Ended Embodied Agent with LLMs.* 2023. arXiv:2305.16291.
8. Anthropic. *Introducing Contextual Retrieval.* 2024.
9. Gao et al. *Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE).* 2022. arXiv:2212.10496.
10. Zep AI. *Zep / Graphiti: A Temporal Knowledge-Graph Architecture for Agent Memory.* 2024.

**Games, text-adventure agents, and the core memory survey.**

11. Hausknecht et al. *Interactive Fiction Games: A Colossal Adventure (Jericho).* 2019/2020. arXiv:1909.05398.
12. stickystyle. *ZorkGPT* (upstream agent, MIT). github.com/stickystyle/ZorkGPT; live run at zorkgpt.com.
13. Paglieri et al. *BALROG: Benchmarking Agentic LLM and VLM Reasoning On Games.* 2024. arXiv:2411.13543.
14. Cui, Yuan, Xiao, Ammanabrolu, Côté. *TALES: Text Adventure Learning Environment Suite.* 2025. arXiv:2504.14128.
15. Du, P. *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers.* 2026. arXiv:2603.07670.

**Our own runs, code, and artifacts.**

16. ZorkGPT × TerranSoul bench design, three-arm results, transcripts: `benchmark/terransoul/zorkgpt/README.md`.
17. TaughtLocalLLM reliable-350 evaluation artifact (per-turn): <https://terransyn.github.io/TerranSoul/zorkgpt/taughtLocalLLM/>.
18. Claude Opus 4.8 evaluation artifact (recall 350 / reasoning 50): <https://terransyn.github.io/TerranSoul/zorkgpt/claude-opus-4.8/>.
19. Brain bridge + orchestrator-fork harness: `benchmark/scripts/zork-bench/terransoul_brain_bridge.py`, `zork_orchestrator_patch.py`.
20. Brain design contract and retrieval ablations: `docs/brain-advanced-design.md` (RRF $k{=}60$; HyDE per query class; `rrf_rerank` R@10 68.3 % on LoCoMo; Mem0-style conflict resolution; GraphRAG/Leiden communities). Durable lessons: `mcp-data/shared/memory-seed.sql` (e.g. `seed:reliable-serving-self-pointer-2026-06-03`, the §4.4 principle; live brain memory_id 18630). External influences credited in `CREDITS.md` (Mem0, GraphRAG, SkillOpt text-space skill optimisation, the agent-harness loop-breaker/verifier study, prompt-positional PAC2026, Karpathy's append-and-review note).
21. Retrieval-bench leaderboard (AgentMemory, LongMemEval-S, LoCoMo ×2): <https://terransyn.github.io/TerranSoul/leaderboard/>.

**Memory and agentic-RAG benchmarks and methods (2025–2026).**

22. *MemoryAgentBench: Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions.* 2025. arXiv:2507.05257.
23. *AMA-Bench: Evaluating Long-Horizon Memory for Agentic Applications.* 2026. arXiv:2602.22769.
24. *MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents.* 2026. arXiv:2601.03236.
25. *PersonalAI: A Systematic Comparison of Knowledge-Graph Storage and Retrieval for Personalized LLM Agents.* 2025. arXiv:2506.17001.
26. Singh, Ehtesham, Kumar, Khoei, Vasilakos. *Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG.* 2025/2026. arXiv:2501.09136.
27. *AutoSkill: Experience-Driven Lifelong Learning via Skill Self-Evolution.* 2026. arXiv:2603.01145.
28. *Reinforcement Learning for Self-Improving Agent with Skill Library (SAGE).* 2025. arXiv:2512.17102.
29. *TextQuests: How Good are LLMs at Text-Based Video Games?* 2025. arXiv:2507.23701.
30. *Dual-Scale World Models for LLM Agents Towards Hard-Exploration Problems.* 2025. arXiv:2509.24116.

**Agent-memory surveys (2026).**

31. *A Survey on the Security of Long-Term Memory in LLM Agents: Toward Mnemonic Sovereignty.* 2026. arXiv:2604.16548.
32. *From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms.* 2026. arXiv:2605.06716.
33. *LLM Agent Memory: A Survey from a Unified Representation–Management Perspective.* 2026. (Preprints.org 202603.0359.)

**Long-term-memory benchmarks and TerranSoul systems artifacts (§2.2, §4.6–4.7).**

34. Maharana, Lee, Tulyakov, Bansal, Barbieri, Fung. *Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo).* ACL 2024. arXiv:2402.17753.
35. Wu et al. *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory.* ICLR 2025. arXiv:2410.10813.
36. TerranSoul systems & token-economy benches: `docs/benchmarking.md` (million-memory HNSW / 1M-CRUD / capacity-prune harness; HybridWeights A/B ablation) and `docs/mcp-token-usage-benchmark.md` (session-anchored token-reduction methodology and caveats).

---

### Appendix A — Reproducing the bench

```bash
# 1. MCP brain healthy on :7423
node scripts/copilot-start-mcp.mjs            # auto-start or reuse the tray

# 2. Smoke (no Z-machine, ~30 s against live MCP)
python benchmark/scripts/zork-bench/smoke_self_improve.py   # expect all PASS

# 3. Canonical AGI-pure run (Docker; jericho needs a Linux build env)
docker build -t zork-bench --build-arg OLLAMA_BASE_HOST=172.17.0.1 \
  -f benchmark/scripts/zork-bench/Dockerfile .
docker run --rm \
  -v "<repo>/target-copilot-bench/bench-results/zork-bench:/out" \
  -v "<repo>/mcp-data/mcp-token.txt:/mcp-data/mcp-token.txt:ro" \
  zork-bench --arm terransoul-brain --episodes 2 --max-turns 100 \
  --mcp-host host.docker.internal --mcp-port 7423

# 4. Reliable-delivery demonstration (§4.4): add -e TAUGHT_SOLUTION_DEMO=1 and --max-turns 500
```

> **Networking note.** When Ollama runs inside WSL2 (NAT), the container reaches it
> at the Docker bridge gateway `172.17.0.1`, while the MCP tray (a Windows-native
> process) stays on `host.docker.internal`. Build with `OLLAMA_BASE_HOST`
> accordingly.
