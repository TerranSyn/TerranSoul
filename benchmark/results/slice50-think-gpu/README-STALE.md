# ⚠️ STALE — measured on PRE-FIX code. Do not quote these numbers as `think`.

**Measured 2026-08-01 22:57. The fix that changed what `think` means landed 2026-08-02.**
This directory records a configuration that **no longer exists**, and its headline number is
worse than `chat` on the same slice.

| arm | NDCG@10 | latency | artifact |
|---|---|---|---|
| **this directory (`think`, pre-fix)** | **86.6** | **19,265 ms** | `slice50-think-gpu` |
| `chat`, same slice/env | **93.5** | **569 ms** | `benchmark/results/arm-chat-50q/` |

34× the latency for 6.9 NDCG points **worse**. Quoting 86.6 as "TerranSoul think" describes a
code path that was deleted.

## What changed

This arm ran `think` with the pointwise LLM-judge reranker enabled. Owner decision 2026-08-02
— *"think cannot be lower than chat, if it is, keep the same logic but adding reasoning only"* —
removed it, because the reranker measured **net-negative**: full-500 NDCG@10 93.26 against
`chat`'s 93.78 at 4,765 ms against 675 ms.

The mechanism is recorded in `internal module` (~:3163) and is not a tuning
miss: *the judge scores topical relatedness rather than answer-bearingness, so on multi-gold
questions it demotes secondary golds that the plain hybrid+RRF pass had already ranked
correctly.* 324 of LongMemEval-S's 500 questions are multi-gold.

`think` now runs **byte-identical retrieval to `chat`** and differs only in reasoning effort
(`Medium` vs `Off`). The same holds on the MCP surface, where `ladder_rung(Think) ==
ladder_rung(Chat)` is pinned by a test, and on the CLI and desktop chat — one path, three
surfaces (`rules/one-path-three-surfaces.md`).

## Why this directory is kept rather than deleted

It is the evidence for *why* the configuration was retired. Deleting it would leave the decision
unfalsifiable and invite someone to re-enable the reranker on the same reasoning that produced it
the first time. Two independent measurements now say the same thing, which is the point.

**Open question this raises (filed as TOKSAV-9):** an LLM reranker making retrieval *worse* has
now happened twice, and the same judge mechanism sits on `max`'s path — where it currently
measures *positive* (`slice50-max-alpha`: R@5 100.0, NDCG@10 98.5). Understanding why it helps
there and hurts here is worth more than either number.

## If you need a current `think` number

Use a post-2026-08-02 artifact. `think` is byte-identical to `chat` by construction now, so a
`think` figure that differs materially from `chat` on the same slice is a bug report, not a
result.
