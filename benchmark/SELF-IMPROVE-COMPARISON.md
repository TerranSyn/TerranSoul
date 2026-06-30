# TerranSoul vs SIA — Self-Improvement Head-to-Head

**[hexo-ai/sia](https://github.com/hexo-ai/sia)** (arXiv:2605.27276, MIT) self-improves by training a task-agent's **weights + harness** per benchmark (base `gpt-oss-120b`). **TerranSoul** self-improves around a **permanently frozen** `gemma4:12b-it-qat` via memory/RAG — **no weight training**. Same benchmark, both numbers, below.

## LawBench — Top-1 accuracy

> Predict the criminal charge from a Chinese court-case description across **191 charge classes** (n = 913). SIA's headline benchmark.

<p align="center"><img src="charts/lawbench_headtohead.png" alt="LawBench Top-1 — TerranSoul 76.3% vs SIA 70.1%" width="720"><br>
<i>TerranSoul (frozen 12B + memory-RAG) vs SIA (weight-trained 120B) on SIA's headline LawBench — plus prior SOTA (45%) and a zero-shot LLM (7%).</i></p>

| System | Top-1 | Model | Method |
|---|--:|---|---|
| **🧠 TerranSoul** | **76.3 %** | `gemma4:12b-it-qat` · **frozen** | frozen-model memory-RAG (k = 10) |
| SIA-W+H | 70.1 % | `gpt-oss-120b` · **weight-trained** | harness + LoRA/RL weight updates † |
| prior SOTA | 45.0 % | — | — |
| zero-shot LLM | 7.0 % | — | — |

> **TerranSoul's frozen 12B + memory beats SIA's weight-trained 120B by +6.2 points** on SIA's own headline benchmark — with a ~10× smaller model and zero weight training. (k-NN memory-only baseline: 58.9 %.) Measured: [`results/sia/lawbench_terransoul_full.json`](results/sia/lawbench_terransoul_full.json) — n = 913, 697 correct, 0 invalid, 2.35 s/case, seed 42. SIA figure is `SIA-W+H` from its README.

## SIA's other benchmarks

> Agent task-optimization in domains TerranSoul does not target (it is a memory brain, not a CUDA/bio optimizer). Shown for completeness; no TerranSoul number.

| Benchmark | SIA | TerranSoul |
|---|--:|---|
| AlphaFold-3 TriMul CUDA kernel | 14× speedup | — (off-domain, not run) |
| scRNA-seq denoising | 0.289 MSEnorm (vs 0.220 SOTA) | — (off-domain, not run) |
| OpenAI MLE-Bench Hard | #1 across generations | — (off-domain, not run) |

## TerranSoul's memory benchmarks

> What TerranSoul measures and SIA cannot — SIA ships no memory / retrieval subsystem.

<p align="center"><img src="charts/terransoul_memory_recall.png" alt="LongMemEval-S recall R@5 98.6%, R@10 99.8%, R@20 100%" width="720"><br>
<i>TerranSoul's LongMemEval-S retrieval recall — the memory axis SIA has no analog for.</i></p>

| Benchmark | TerranSoul | SIA |
|---|--:|---|
| LongMemEval-S R@5 / R@10 / R@20 | **98.6 % / 99.8 % / 100 %** | — (no memory) |
| Zork cross-episode (frozen 4B) | **0 → 10–20** | — |
| Personal-AI parity (quality · latency · cost) | **9.8/10 · 1.0 s · $0** | — |

## Why frozen, not weight-edited

TerranSoul keeps the base model frozen by design — self-improvement runs through **memory consolidation + skill synthesis**, not gradient retraining. SIA's harness/code self-revision maps to a brain faculty we **adopt** (we vendored + ported its generation-bookkeeping into `memory/self_improve_log.rs`); its **weight-editing has no human-brain analog** — the brain learns via Complementary-Learning-Systems consolidation + plasticity, not benchmark-gradient-descent — so we **exclude** it. Full rationale: [`docs/brain-advanced-design.md` §1.5](../docs/brain-advanced-design.md).

---
*SIA = [hexo-ai/sia](https://github.com/hexo-ai/sia) (arXiv:2605.27276v2, Hexo Labs, MIT). † SIA's LoRA/RL weight path is paper-reported; only the harness/scaffold-editing path is visible in the public source. Full cross-system retrieval matrix: [COMPARISON.md](COMPARISON.md). Reviewed 2026-06-30.*
