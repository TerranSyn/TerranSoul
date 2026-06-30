# TerranSoul — a 3D AI companion that remembers, and runs on your own machine

> **A first-class external memory you can plug into any AI.** Private, local, **$0** — it remembers across sessions, and shares one brain with your other AI tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Paper: From Memo to Memory](https://img.shields.io/badge/paper-From%20Memo%20to%20Memory-8A2BE2)](https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/)
[![Benchmarks](https://img.shields.io/badge/benchmarks-COMPARISON.md-2ea44f)](benchmark/COMPARISON.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/RzXcvsabKD)

> **🚧 In active development.** Interested? Join us at <https://discord.gg/RzXcvsabKD>

> This is the public **information & GitHub Pages** repository for TerranSoul — what it is, why it exists, and the research and benchmarks behind it. It is not the application source.

TerranSoul keeps your language model **frozen** and makes the **memory around it** smarter — so a small local model behaves above its weight class, every change is auditable, and your knowledge stays **portable data, not opaque weights**. One brain, shared with your other AI tools.

**[📖 TerranSoul in Six Scenes](https://terransyn.github.io/TerranSoul/)** — a non-technical primer · **[📄 Research — *From Memo to Memory*](https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/)** — the thesis, with receipts.

---

## The problem

Today's AI doesn't really belong to you:

- **It forgets you.** Most assistants lose everything the moment you close the tab — no memory, no continuity.
- **It lives in the cloud.** Your data leaves your device every time you use it.
- **It's behind a paywall.** Powerful AI is locked behind a monthly subscription.

## Memory-first, by design

TerranSoul is an AI companion that **remembers** — and runs on your own machine:

- **Runs on your computer** — local models on your own hardware, no subscription, **$0**.
- **Private by default** — your data never leaves your device.
- **Remembers everything, offline** — persistent memory plus an offline core loop; it picks up where you left off.
- **Plugs in anywhere** — it shares one brain so your *other* AI tools (Claude Code, Copilot, Cursor, Codex, peer instances) get smarter too.

## A first-class memory you can plug in anywhere

TerranSoul is a **first-class external memory** — built for knowledge **representation, retrieval, and updating**, the way a brain organizes and revises what it knows. The language model stays **frozen**; the memory does the learning — so every gain is **auditable, reversible, and portable** (it's *data, not weights*).

That makes TerranSoul a **different kind of tool** than coding agents or self-improvement loops — it is the **memory substrate they plug into**. It is **complementary, not competitive**, and its sweet spot is **memory-heavy read + update**: long-lived, cross-session, cross-tool knowledge that has to stay correct as it changes.

---

## Benchmark highlights

Measured, not asserted — full methodology and per-task tables in [`benchmark/COMPARISON.md`](benchmark/COMPARISON.md).

- **Memory recall — LongMemEval-S** (500 questions): R@5 **98.6%** · R@10 **99.8%** · R@20 **100%** — the top row in the table (agentmemory 95.2%, MemoryPalace ~96.6%).
- **Personal-assistant answer quality** (22 prompts, independent 0–10 judge, same model): TerranSoul **9.82** at **~1.0 s** for **$0** — the highest and fastest local row.
- **Frozen-model self-improvement — ZorkGPT** (4B model): memory alone lifts the score from **0** (both controls) to **10–20**, reaching rooms it never visited. No weight edits.
- **LawBench** (191-class charge prediction): a frozen 12B + memory scores **76.3%** Top-1, above a weight-trained 120B baseline (70.1%) and prior SOTA (45%); a stronger frozen actor reaches **80.0%** — all with no weight training.

---

## Read the research

TerranSoul's thesis — *memory, not weights* — is defended in a research report, with receipts:

**[📄 From Memo to Memory: A First-Class External-Memory Architecture for Frozen Language Models](https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/)** — a combined position-and-measurement paper. It accepts the *memo-vs-memory* charge in the recent literature and contests the dichotomy: five behavioural criteria separate a memo from a memory, and a structured external substrate can satisfy them with the model's weights frozen — shown on a controlled Zork I study and four public benchmarks. ([per-turn runs](https://terransyn.github.io/TerranSoul/zorkgpt/))

---

## Learn more

- **[TerranSoul in Six Scenes](https://terransyn.github.io/TerranSoul/)** — a non-technical primer on LLMs, RAG, memory and reasoning.
- **[Research paper](https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/)** — *From Memo to Memory*.
- **[ZorkGPT bench runs](https://terransyn.github.io/TerranSoul/zorkgpt/)** — per-turn evaluation artifacts.
- **[Benchmarks](benchmark/COMPARISON.md)** — the full results matrix.

If you are interested, please connect via <https://discord.gg/RzXcvsabKD>.
