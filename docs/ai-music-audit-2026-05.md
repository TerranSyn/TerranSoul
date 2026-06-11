# AI Music Quality Audit — 2026-05-23

> Scope: audit the current TerranSoul `<sing>` pipeline against modern AI music
> reference points (Suno, Udio, Riffusion, ACE-Step, OpenAI Voice-style covers),
> identify why the output is markedly lower quality than the user's reference
> (YouTube `tJbQ620SsQg`), and define the chunks needed to close the gap by
> end-of-day 2026-05-23.
>
> **User ask (verbatim, paraphrased):** "Keep the music from the original song.
> Our AI song should be same quality or better than what's online."

## 1. What ships today

### 1.1 The runtime path
1. LLM emits `<sing lyrics="…" melody="C4:0.4 D4:0.4 …" language="…">…</sing>`
   via `commands::chat::SYSTEM_PROMPT_FOR_STREAMING` and the harness rules in
   [rules/harness-reasoning-engineering.md](rules/harness-reasoning-engineering.md).
2. Frontend calls Tauri command `sing_lyrics` ([src-tauri/src/commands/voice.rs](src-tauri/src/commands/voice.rs#L1099)).
3. Lyrics → Supertonic ONNX TTS (`voice::supertonic_tts`) renders English/Korean/
   Spanish/Portuguese/French. Other languages fall through to Edge `Read aloud`
   neural TTS ([src-tauri/src/voice/edge_tts.rs](src-tauri/src/voice/edge_tts.rs)).
4. Returned WAV is shipped to the frontend immediately for zero-latency playback.
5. **Background upgrade** (when `pitch-analysis` feature on): RMVPE estimates F0
   on the TTS clip, PSOLA pitch-shifts each syllable to the LLM-supplied melody,
   then emits `sing-pitch-ready` so the frontend can swap the audio source.

### 1.2 What this produces
- **Vocoded melodic *speech*, not singing.** PSOLA-shifted Supertonic preserves
  the speaker's neutral prosody, then jerks pitch up/down per note. Vowels do
  not sustain, there is no vibrato, no breath modelling, no formant tracking.
- **No accompaniment.** The output is dry vocal-only. There is nothing in the
  pipeline that supplies the *music* the user is asking us to "keep".
- **No reference to the source song.** Even with a YouTube URL in the prompt,
  the LLM only extracts lyrics (LRCLIB lookup, ID 1182 in brain memory) and
  hand-picks a short melody string. The actual mix, harmony, tempo, key,
  groove, and instrumental tone of the source are discarded.

### 1.3 Wired into `sing_lyrics` (shipped in MUSIC-QUALITY-1)
| Module | What it can do | Wired into `sing_lyrics`? | Notes |
|---|---|---|---|
| [src-tauri/src/voice/ace_step.rs](src-tauri/src/voice/ace_step.rs) (902 lines) | ACE-Step v1.5 — local/remote Gradio/FastAPI client on `:7860`/`:8001`. Text→music, optionally audio-conditioned. | ✅ Shipped (`MusicMode::LocalAceStep` branch) | `sing_via_ace_step` routes through `AceStepClient::generate(prompt, lyrics, duration_secs, …)`; default URL = `127.0.0.1:7860`. |
| [src-tauri/src/voice/suno.rs](src-tauri/src/voice/suno.rs) (723 lines) | Suno V4.5 cloud (`api.sunoapi.org`), BYO-key. Full-song generation, polled. | ✅ Shipped (`MusicMode::CloudSuno` branch + auto-fallback) | `sing_via_suno` routes through `SunoClient::from_key(...).sing(req)`. Also used as automatic fallback when Suno API key is present and no explicit mode is set. |
| [src-tauri/src/voice/melody.rs](src-tauri/src/voice/melody.rs) | Parses `NOTE:DURATION` melody strings. | ✅ Used by `sing_lyrics` | OK as-is. |
| [src-tauri/src/voice/pitch.rs](src-tauri/src/voice/pitch.rs) + `pitch_shift.rs` | RMVPE F0 + PSOLA. | ✅ Background upgrade in `sing_lyrics` | OK as-is. |

## 2. Quality gap vs reference

The user's reference is a polished mainstream YouTube track. Our output lacks:
| Dimension | Reference | TerranSoul today | Closeable? |
|---|---|---|---|
| Singing voice realism | Trained human vocalist or Suno V4.5 cloud model | Pitch-shifted TTS | Partially — see §3.A |
| Instrumental backing | Full mixed arrangement | Silence | Yes — see §3.B / §3.C |
| Source-song fidelity | (it *is* the source) | None | Yes — see §3.B "cover" mode |
| Melodic phrasing | Continuous legato + vibrato | Discrete note steps, no sustain | Hard without a real SVS — see §4 |
| Mix quality | Mastered, multi-band, stereo | Mono speech sample-rate | Yes — see §3.D |

## 3. Closing the gap

There are three independent design tracks. They can ship in parallel chunks.

### 3.A — Better vocal engine (MUSIC-VOCAL-*)
Order of preference for the vocal stem:
1. **Suno V4.5 cloud (BYO-key)** — already scaffolded; highest quality, full
   song including arrangement. Gate behind explicit user consent + key + cost
   warning. (See [docs/licensing-audit.md](docs/licensing-audit.md) — Suno
   terms allow non-commercial personal generation; commercial use requires
   the Pro/Premier plan. Confirm in chunk before ship.)
2. **ACE-Step local (Apache-2.0 model weights, MIT code)** — already
   scaffolded; runs offline on local GPU if user installs it. Apache-2.0
   weights per HuggingFace `ACE-Step/ACE-Step-v1-3.5B`. Lower quality than
   Suno but private and unlimited.
3. **Supertonic + RMVPE + PSOLA (current path)** — keep as offline fallback.
   No license risk, instant start, but vocoded.

### 3.B — Cover mode: keep the original instrumental
This directly addresses the user's "keep the music from the original song" ask.
Pipeline (only triggers when the prompt contains a music URL, not just lyrics):
1. **Download** — yt-dlp via existing `<listen>` infrastructure
   ([brain memory id=1175](mcp://terransoul-br) — `<data_dir>/song-cache/tmp/`).
   Already shipping; re-use the `TempAudio` drop-guard.
2. **Source separation** — Demucs (Meta AI, MIT) v4 `htdemucs`. Splits into
   `vocals` + `drums` + `bass` + `other`. Run via Python sidecar (matches
   the existing VibeVoice ASR sidecar pattern per brain memory id=1166).
   *License check required:* Demucs code is MIT, model weights ship under MIT
   in the [facebookresearch/demucs](https://github.com/facebookresearch/demucs)
   repo. Confirm at chunk time and log in `docs/licensing-audit.md`.
3. **Discard `vocals` stem, keep `drums + bass + other`** as the backing track.
4. **Synthesise new vocal** via §3.A engine, key-matched and tempo-matched
   to the backing track (Demucs preserves the source's BPM and key).
5. **Mix** vocal stem over the instrumental in Rust (`hound` for WAV I/O is
   already a dep; trivial gain + sum mix).

### 3.C — "Inspired-by" mode: pure-generative
When no URL is supplied, route through Suno/ACE-Step text-to-music with the
LLM's lyric + style hint. No source-separation required. Already 90% there
in the scaffolded code; just needs wiring + UI consent toggle.

### 3.D — Mix polish
Even the local Supertonic+PSOLA fallback can sound substantially better with:
- Resample to 44.1 kHz stereo (currently 24 kHz mono).
- Light reverb (e.g. `fundsp` crate, MIT) per phrase boundary.
- Loudness-normalise to −14 LUFS before serving.

## 4. What we **cannot** close (and why)
- **A real local SVS (singing-voice synthesiser) that produces studio-quality
  singing.** DiffSinger was investigated in SING-DS-* and **pulled 2026-05-19**
  (brain memory id=1164): every public voicebank is CC-BY *Research-Only*, the
  openvpi vocoders are AGPL-3.0, and no MIT/Apache singing model with
  competitive quality currently exists. Re-opening this requires either
  paying for a commercial voicebank licence or training one from scratch on
  cleared data — both out of scope for the 2026-05-23 deadline.
- **Suno-level quality from a fully-offline, ≤8 GB VRAM model.** Even
  ACE-Step v1 acknowledges a ~1–2 generation gap vs Suno V4.5 on subjective
  MOS evals. Local-only users will see lower quality than cloud users; this
  is documented honestly in the consent UI.

## 5. Recommended chunk sequence (target: ship by 2026-05-23 EOD)

| ID | Goal | Files touched | Tests |
|---|---|---|---|
| **MUSIC-MODE-1** | Add `MusicMode` enum (`SpeechMelody` / `LocalGenerative` / `CloudSuno` / `Cover`) to settings store + UI consent toggle in `SettingsView`. Defaults to `SpeechMelody` (current behaviour). | `src/stores/settings.ts`, `SettingsView.vue`, `src-tauri/src/commands/settings.rs` | 6 vitest + 3 cargo |
| **MUSIC-COVER-1** | Wire `<sing src="…youtube…">` URL parsing in `commands/chat.rs` LLM prompt + harness path; reuse existing yt-dlp via `<listen>` infra to fetch the audio into `song-cache/tmp/`. | `commands/chat.rs`, `commands/streaming.rs`, harness rules | 4 cargo |
| **MUSIC-COVER-2** | Demucs Python sidecar (`scripts/demucs-sidecar.py` + `src-tauri/src/voice/demucs.rs`), launched on first cover request. Cargo feature `music-cover` (no new deps; sidecar is out-of-process). Returns 4 WAV stems. | `voice/demucs.rs`, sidecar script, `Cargo.toml` | 5 cargo (mocked sidecar) |
| **MUSIC-COVER-3** | Backing-track builder: mix `drums+bass+other` into a single 44.1 kHz stereo WAV via `hound`. Cache by `source_hash`. | `voice/backing_track.rs` | 4 cargo |
| **MUSIC-VOCAL-1** | Wire `SunoClient::sing` behind `MusicMode::CloudSuno` from `sing_lyrics`. Key from `voice_config.suno_api_key` with onboarding banner. | `commands/voice.rs` | 3 cargo |
| **MUSIC-VOCAL-2** | Wire `AceStepClient::generate` behind `MusicMode::LocalGenerative`. Health-check `:7860` on first call; surface NotInstalled when down. | `commands/voice.rs` | 3 cargo |
| **MUSIC-MIX-1** | Final mix: overlay synthesised vocal over backing track (§3.B step 5). Loudness-normalise via `ebur128` crate (MIT). | `voice/mixer.rs` | 4 cargo |
| **MUSIC-DOCS** | Update `README.md` "Sing" section, add CREDITS entries for Demucs / ACE-Step / Suno research, add licensing-audit rows, archive completed chunks via the milestones enforcement rule. | docs only | n/a |

Total ~32 new tests; CI gate `npx vitest run && cargo clippy -- -D warnings && cargo test --lib --tests` must stay green at every chunk boundary.

## 6. Acknowledgements / sources

Updates to `CREDITS.md` to land alongside MUSIC-DOCS:
- **Demucs** (facebookresearch/demucs, MIT) — used for source separation.
  Verified via DeepWiki + upstream repo per `rules/coding-standards.md`.
- **ACE-Step** (ACE-Step/ACE-Step v1, code MIT, weights Apache-2.0) — already
  scaffolded; CREDITS row to be added when wired in MUSIC-VOCAL-2.
- **Suno** (sunoapi.org gateway, BYO commercial terms) — already scaffolded.
- **LRCLIB** (existing) — still the synced-lyrics source.

## 7. Hard constraints recorded

- No DiffSinger / openvpi vocoders (license, see §4).
- No bundled model weights >100 MB (matches existing
  `docs/licensing-audit.md` policy for opt-in first-run download).
- YouTube scraping only via yt-dlp executable; never direct HTTP fetch
  (brain memory id=1182).
- All music-cover paths are off-by-default and require explicit user consent
  in Settings before the first run.

---
*Recorded by Copilot on 2026-05-23 during the music-quality audit chunk.
Brain MCP preflight: gemma3:4b, 1194/1194 embedded, `brain_suggest_context`
fingerprint matched prior SING-RUST-0 / SING-BARK-1 / LRCLIB lessons.*
