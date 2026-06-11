# TTS Voice Design Evaluation

## Scope

The current TerranSoul voice stack uses browser Web Speech / SpeechSynthesis for the local free path and OpenAI-compatible cloud TTS for higher-quality synthesis. The user request adds editable voice-design controls to persona/model profiles: gender, age, pitch, whisper style, English accent, Chinese dialect, provider voice name, and per-model persona metadata.

This note compares that target against `k2-fsa/OmniVoice` and records the integration decision.

## Current TerranSoul TTS

- Strengths: zero setup in browser fallback, works through the existing streaming TTS queue, integrated with lip sync, low operational risk, no model download.
- Limits: browser voices expose only coarse `pitch` and `rate`; accent/dialect/style control depends on the installed voice and cannot guarantee whisper, 四川话, 陕西话, or voice design prompts.
- Best immediate fit: keep as the default provider and map model profiles into voice name, pitch, and rate where supported.

## OmniVoice Fit

- Upstream: `k2-fsa/OmniVoice`, Apache-2.0.
- Capabilities that match the requested controls: voice design by gender, age, pitch, whisper style, English accent, Chinese dialect examples including 四川话 and 陕西话, broad multilingual coverage, non-verbal/pronunciation control, and reference-voice cloning.
- Runtime shape: Python/PyTorch/Hugging Face model dependency with larger model/runtime footprint than TerranSoul's current default voice path.
- Product risks to handle before shipping: model download size, GPU/CPU performance, packaging inside Tauri, offline install UX, consent and safety UX for voice cloning, and a clear provider boundary so default local voice stays lightweight.

## Decision

Do not replace TerranSoul's existing TTS with OmniVoice as the default engine right now.

Adopt the voice-design data model and UI now, because those fields are useful immediately for persona prompting and can partially drive current TTS voice/pitch/rate. Keep OmniVoice as an optional future provider behind a separate install/runtime path after benchmarking and consent UX are designed.

## Implementation Notes

- `PersonaTraits.voiceProfile` is the canonical persona-level voice design record.
- Per-model profile overrides persist in the character store and drive active model TTS voice/pitch/rate.
- The `[PERSONA]` prompt includes a concise `Voice design:` line so future text-to-speech providers and the LLM share the same intent.
- A future provider should accept the same profile fields and build the OmniVoice-style instruction string at the provider boundary rather than coupling UI code to one engine.