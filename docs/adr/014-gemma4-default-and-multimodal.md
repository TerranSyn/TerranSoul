# ADR 014 — Gemma 4 12B as default LLM + multimodal chat

**Status:** Accepted  
**Date:** 2026-06 (Spec 021)  
**Source:** `src/stores/brain.ts`, `src/components/ChatInput.vue`, `src-tauri/src/commands/streaming.rs`

---

## Context

The previous default for 16–48 GB RAM machines was `gemma3:4b`. In June 2026,
`gemma4:12b` (Google Gemma 4 12B, `google/gemma-4-12B` on HuggingFace,
`gemma4:12b` in Ollama) became generally available with:

- **Vision/multimodal support** — images, PDFs rendered as images, multiple
  languages natively, no separate embedding model required for image input.
- **Q4_K_M quantisation at ~7.5 GB VRAM** — fits a standard consumer GPU.
- **Better reasoning** than Gemma 3 4B for multi-hop memory questions.

## Decision

### 1. Update `ramAwareFallback`

```typescript
if (ram >= 49_152) return 'gemma4:e4b';   // ≥ 24 GB VRAM
if (ram >= 16_384) return 'gemma4:12b';   // ≥ 8 GB VRAM — new default
if (ram >= 8_192)  return 'gemma3:4b';    // 4 GB VRAM
if (ram >= 4_096)  return 'gemma3:1b';
return 'tinyllama';
```

### 2. Add image attachment support to chat

Image files (jpg, png, gif, webp, bmp) picked or dropped into `ChatInput.vue`
are base64-encoded client-side and held in a `pendingImages` ref. An image
thumbnail strip is shown above the textarea.

On submit, base64 strings flow through:
```
ChatInput emit('submit', text, images)
  → conversationStore.sendMessage(text, images)
  → streamingStore.sendStreaming(msg, overrides, images)
  → invoke('send_message_stream', { ..., images })
  → AppState.chat_images (Mutex<Option<Vec<String>>>)
  → stream_ollama: injected into last user message JSON before POST
```

Ollama accepts `images: ["base64..."]` in the `/api/chat` message body for
vision-capable models.

### 3. URL/link input

A "🔗 Link" button in `ChatInput.vue` opens a URL input row. Confirmed URLs
are injected as `@url:<link>` mention text into the message, where the
scholar_crawl pipeline can fetch and summarise them.

### 4. `MULTIMODAL_MODEL_TAGS` constant

```typescript
export const MULTIMODAL_MODEL_TAGS = ['gemma4', 'llava', 'minicpm-v', 'moondream', ...]
```

Used to determine whether to show image UI and whether to include images in
the Ollama payload. Ollama also silently ignores an `images` field for non-vision
models — so even without strict gating, non-vision models are unaffected.

## Why 16 GB RAM as the threshold

16 GB RAM is the minimum for a machine that *also* has 8 GB VRAM (GPU VRAM is
separate). A 16 GB RAM + 8 GB VRAM laptop can run `gemma4:12b` at Q4_K_M
(≈7.5 GB VRAM) with room for KV cache. Machines with only 8 GB RAM are
unlikely to have 8 GB VRAM — they fall through to `gemma3:4b` at 4 GB VRAM.

## Trade-offs

- TTFT is ~900 ms vs ~450 ms for `gemma3:4b` on the same hardware. Acceptable
  for the quality gain, but users on the RAM threshold can revert to `gemma3:4b`
  from the Brain settings panel.
- Large images (> 4 MB) add significant JSON payload. No resize is applied yet
  — a future improvement can cap attachment dimensions client-side.

## Related ADRs

- [ADR 012](012-ollama-local-first-llm.md) — Ollama model management and `ramAwareFallback`
- [ADR 006](006-vrm-avatar-and-motion-pipeline.md) — multimodal opens image → motion generation paths
