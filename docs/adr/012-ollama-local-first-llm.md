# ADR 012 — Ollama as the local-first LLM runtime

**Status:** Accepted  
**Date:** 2025  
**Source:** `src-tauri/src/brain/ollama_agent.rs`, `src/stores/brain.ts`

---

## Context

TerranSoul performs LLM inference for chat, memory extraction, emotion tagging,
motion annotation, reasoning harnesses, and autonomous coding loops.

Constraints:
- Must work offline on consumer hardware (8–24 GB VRAM)
- Must auto-download models (no manual install)
- Must have an OpenAI-compatible API (easy provider swap)
- Must install silently on Windows / macOS / Linux
- Privacy: user data must never leave the machine by default

## Decision

Use **Ollama** (`http://localhost:11434`) as the primary local inference runtime,
with automatic detection, install, and warm-up via Tauri commands.

Cloud providers (OpenRouter, NVIDIA, Groq, Pollinations, Cerebras) are available
as fall-back when Ollama is unreachable or the user explicitly chooses cloud.

## RAM-adaptive model tier

The `ramAwareFallback` function picks the best model for the detected hardware:

| RAM | Recommended Ollama tag | Typical VRAM | Notes |
|-----|----------------------|-------------|-------|
| ≥ 48 GB | `gemma4:e4b` | ≥ 24 GB | High-end workstation |
| ≥ 16 GB | `gemma4:12b` | ≥ 8 GB | **Default recommendation** (multimodal, multilingual) |
| ≥ 8 GB | `gemma3:4b` | ≥ 4 GB | < 500 ms TTFT sweet spot |
| ≥ 4 GB | `gemma3:1b` | ≥ 2 GB | Minimum viable |
| < 4 GB | `tinyllama` | CPU-only | Emergency fallback |

The tier is a starting point. The brain catalogue (`refresh_model_catalogue`)
fetches live community recommendations and can upgrade the choice.

## Why not alternatives

| Alternative | Why rejected |
|-------------|-------------|
| llama.cpp directly | No REST API; requires custom IPC; harder mobile bridge; no model management |
| LM Studio | Proprietary GUI; no headless API for Tauri commands |
| vLLM / SGLang | Requires Python + CUDA; too heavy for consumer desktop install |
| Hugging Face transformers | Python dependency + GB-scale Python environment |
| OpenAI API only | Breaks offline / privacy posture |

Ollama provides a clean REST interface (`/api/chat`, `/api/generate`, `/api/pull`)
that maps directly to Rust `reqwest` calls — no Python runtime required.

## Critical performance note

Ollama reallocates the KV cache when `num_ctx` changes between requests,
adding 2–3 s per request. TerranSoul pins `num_ctx: 2048` for all chat turns
and only varies `num_predict` (max output tokens). This is the single most
impactful performance decision in the streaming pipeline.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — brain context injected before each Ollama call
- [ADR 014](014-gemma4-default-and-multimodal.md) — Gemma 4 12B as the new tier default
