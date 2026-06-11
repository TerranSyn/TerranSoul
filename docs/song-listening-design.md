# Song Listening — Design

> Status: draft (2026-05-19). Approved approach: build the harness loop +
> oEmbed metadata phase now; real-audio listening lands in a follow-up
> phase once audio-source policy is decided.
> Owner: TerranSoul harness + brain
> Related rules: [rules/harness-reasoning-engineering.md](../rules/harness-reasoning-engineering.md),
> [rules/llm-decision-rules.md](../rules/llm-decision-rules.md)

## Problem

When the user types "Sing this: https://www.youtube.com/watch?v=…" the
local chat model (e.g. `gemma4:e4b`) currently apologises that it can't
play the audio. The user's intent is clear: they want the avatar to
actually sing the song from the link. Two prior attempts (auto URL
prefetch in `run_chat_stream`; "NEVER refuse to sing" prompt override)
were both reverted as harness-engineering violations — they made the
decision *for* the model rather than giving it agency.

## Goal

Give the model an honest, tool-mediated way to answer "sing the song at
this URL":

1. **Model decides** when to look up a song (no regex / no auto-fetch).
2. **Harness provides** the lookup tool surface + a future audio-listening
   tool surface, with bounded latency and an SSRF-safe network path.
3. **User sees** a status indicator while the harness is fetching, so
   apparent silence is never confused with the model refusing.
4. **No ToS landmines** — YouTube audio download is opt-in and gated;
   metadata-only lookup (oEmbed) is the default.

## Non-goals

- Building a full music-information-retrieval pipeline (key/chord/tempo
  estimation). Out of scope until we know the audio source.
- Streaming the real song's audio back to the user. We always render the
  model's `<sing>` block via our own TTS + pitch-shift pipeline — that
  is what "singing" means in TerranSoul (see
  `SYSTEM_PROMPT_FOR_STREAMING`).
- Replacing or rewriting the existing `<sing>` / `<anim>` / `<pose>`
  tag protocol. The new `<lookup>` tag joins the same protocol family.

## Architecture overview

```
User turn  ──► Chat stream (LLM)
                   │
                   ├─ stream output starts
                   │     │
                   │     ▼
                   │   StreamTagParser sees `<lookup>{...}</lookup>` ?
                   │     │
                   │  yes│
                   │     ▼
                   │   abort current stream, do not show partial text
                   │   ▼
                   │  lookup_song_info(query)    ◄── tool
                   │   │
                   │   ▼
                   │  emit `song-lookup-status` events to frontend
                   │   ▼
                   │  append `[tool_result] title="…" artist="…"` to history
                   │   ▼
                   │  re-invoke LLM (one re-prompt budget)
                   │
                   └─► visible turn (model emits `<sing>` informed by result)
```

Key invariants:

- **Single round-trip budget** per user turn. After one re-prompt, we do
  not loop again. Prevents pathological tool-call cascades.
- **Tool-call-first prompt contract**: the model is told to emit
  `<lookup>` as the very first thing in its response if it wants
  lookup. That lets the parser buffer the first N characters and decide
  cheaply whether to abort.
- **No silent input rewriting** — the lookup result is appended as a
  clearly-marked `[tool_result]` block to history, not stuffed into the
  user's last turn. Conversation store stays truthful (per rule §
  "Hidden context injection").

## Tool surface

### `lookup_song_info(query: string) -> { title, artist? } | null`

| Branch | Behaviour |
|---|---|
| YouTube URL (`youtube.com/watch?v=…` or `youtu.be/<id>`) | GET `https://www.youtube.com/oembed?url=<encoded>&format=json` — returns `title` + `author_name`. No API key. |
| Other HTTP(S) URL | GET URL, parse HTML `<title>` (existing SSRF-safe helper). No artist. |
| Free-text query (no URL) | Return `null` for now. Future: optional web search. |

All branches share the existing SSRF blocklist
(`crate::commands::ingest::validate_url`), 4 s outer timeout, and
TerranSoul user-agent string. On any failure the tool returns `null` —
the model is then expected to fall back to its existing capability
description (improvise an original `<sing>` block).

### `listen_to_song(...)` — phase 2, deferred

Audio listening requires resolving the open questions below. Phase 2
will add a second tool the model can opt into when metadata alone isn't
enough. Until then, the model has metadata only.

## Tag protocol additions

`<lookup>{ "query": "<string>" }</lookup>` — new sibling of `<sing>` and
`<anim>` in `StreamTagParser`. Single field; no nested structure.

Parser emits a `LookupCommand` into `StreamParseOutput`. The streaming
loop is responsible for acting on it (calling the tool, re-prompting),
not the parser.

## Frontend status protocol

Events on the Tauri bus, listened to by `ChatView.vue`:

| Event | Payload | UI effect |
|---|---|---|
| `song-lookup-status` | `{ phase: 'looking-up' \| 'done' \| 'failed', query?: string, title?: string }` | A small chip near the assistant bubble: "Looking up …", or "Found: ‹title›", or "Couldn't reach the link". |

The chip auto-dismisses when the assistant's main reply starts streaming.

## Streaming-loop changes

For both `stream_ollama` and `stream_openai_api`:

1. Run stream as today, but **gate user-visible text emission** until
   either (a) the parser confirms no `<lookup>` is coming (first
   non-tag byte seen → flush buffer, stream normally), or (b) a
   `<lookup>` block closes.
2. If `<lookup>` closed: abort the upstream LLM stream, call the tool,
   emit `song-lookup-status` events, then start a second stream with
   the original prompt + the appended `[tool_result]`. Reset the
   visible-text gate; emit normally this time.
3. Budget: at most one re-prompt per user turn. If the second response
   *also* emits `<lookup>`, ignore it.

Latency profile:

- **No lookup turn** (most chats): gate releases on the first non-tag
  byte — typically within a few tens of milliseconds of TTFT. No
  user-visible regression.
- **Lookup turn**: gate holds through the `<lookup>` block (~50 tokens),
  tool call (~200–800 ms for oEmbed, 1–4 s for SSRF-safe HTML), then
  the second stream begins. UI shows the chip the entire time.

## Open questions (resolved later)

1. **Audio source for `listen_to_song`** — pick one of:
   - User-supplied audio files only (drag/drop `.mp3` / `.wav` next to
     a URL). Zero ToS risk, no extractor dep.
   - `yt-dlp` integration with explicit per-URL user consent. Fragile,
     ToS-grey, needs caching + retry.
   - Both.
2. **Audio → features pipeline** — Whisper (lyrics only) vs aubio /
   librosa-equivalent (melody + tempo) vs a single multimodal model.
3. **Caching** — by `query` hash, with TTL and per-user cap. Required
   before audio download lands.
4. **Local-only mode** — must work offline; when offline the lookup
   tool returns `null` quickly and the model falls back to improvising.

These are tracked in `rules/backlog.md` under the song-listening epic.

## Phased delivery

### Phase 1 — Harness `<lookup>` loop + oEmbed metadata (this PR)

- Design doc (this file).
- `LookupCommand` parser support + tests.
- `lookup_song_info` Rust helper + oEmbed parsing + tests.
- Two-pass streaming loop integration in `stream_ollama` and
  `stream_openai_api`.
- Frontend status chip.
- System-prompt capability description for `<lookup>`.

### Phase 2 — Real audio listening (chunks 52.1a / 52.1b / 52.1c)

**Audio-source decision (2026-05-19):** `yt-dlp` URL extraction with
per-call user consent. Local file uploads are deferred — the chat surface
is the primary entry point and the model can already pick a URL out of
the conversation.

- **52.1a — `yt-dlp` wrapper + consent gate.** Locate a bundled or PATH
  `yt-dlp` binary, add a `song_listening.consent` setting (off by
  default), and expose `download_song_audio(url) -> Result<TempAudio, _>`
  that streams to a temp `.opus` file under
  `<data_dir>/song-cache/tmp/`, with `Drop`-based cleanup. SSRF-safe:
  only `http(s)` URLs and a configurable host allow-list defaulting to
  `youtube.com`, `youtu.be`, `soundcloud.com`, `bandcamp.com`.
- **52.1b — Audio analysis pipeline.** Decode the downloaded file
  (`symphonia`) to PCM 16k mono, feed to the existing `AsrProvider` for
  lyrics, run a simple onset-autocorrelation BPM detector for tempo,
  and call the brain LLM as a judge for `{mood, key_guess}` from the
  lyrics summary. Output a structured `SongFeatures`.
- **52.1c — `<listen>` block + harness round-trip + status pill.** New
  `ListenCommand` parser block, two-pass harness loop, "🎧 Listening
  to song…" + "🎤 Transcribing…" status events, system-prompt
  capability description.

### Phase 3 — Caching + persistence (future)

- Lookup-result cache (`mcp-data/shared/song-cache.sqlite`).
- Cross-session re-use; cap entries; respect quiet hours.

## Rule alignment

- Harness rule (`rules/harness-reasoning-engineering.md`): the model
  decides to call the tool by emitting `<lookup>`; the harness only
  provides mechanism (fetch, status events, re-prompt). No regex,
  no hardcoded URL detection in `run_chat_stream`. ✅
- LLM-decision rule (`rules/llm-decision-rules.md`): any toggle that
  changes whether `<lookup>` is offered (e.g. offline mode, privacy
  mode) goes through `ai-decision-policy.ts`. ✅
- Brain doc sync rule: this is not a brain-store change, so no update
  to `docs/brain-advanced-design.md` is required.
