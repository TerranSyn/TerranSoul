# Model-latency ladder — strongest local model at ~1 s latency (2026-07-11)

**Question (owner, 2026-07-11):** "find the most possible model with 1s
latency with colibri. Maybe trying gamma4:32b-it-qat."

**Scope corrections established before measuring:**
- **colibri cannot serve this goal** — it is a single-architecture C engine
  implementing exactly the GLM-5.2 744B forward pass (its README + source);
  it cannot load gemma-family weights, and its measured cold latency here is
  hours-per-answer (see the colibri smoke: prefill layer 57/78 after 50 min
  on the NTFS bind mount). The ladder therefore ran on the Ollama stack.
- **`gemma4:32b-it-qat` does not exist.** Registry probes for
  `gemma4:{27b,27b-it-qat,32b}` all return manifest-not-found — the gemma4
  line caps at the 12b already in use.

**Method (loop-engineered, `scratchpad/latency-ladder.py`):** per model on
this machine (RTX 3080 Ti 12 GB, 63.7 GB RAM, Ollama 0.30.6 in Docker):
cold load via a first chat call, `/api/ps` VRAM-placement check
(`size_vram==size` preflight lesson), one discarded warm-up, then 3
measured streamed chat calls — TTFT = first streamed token (content OR
thinking chunk), decode tok/s from `eval_count/eval_duration`. Signal:
**warm TTFT median ≤ 1.0 s**. Models unloaded between candidates.

## Results

| Model | Params (active) | Warm TTFT median (all 3) | Decode tok/s | GPU placement | ≤1 s bar |
|---|---|---|---|---|---|
| qwen3:30b-a3b | 30B MoE (~3B) | **181 ms** (175/181/186) | 18.3 | 9.8/19.7 GiB = 50% | **PASS** |
| gemma4:12b-it-qat (baseline) | 12B dense | 391 ms (376/391/413) | **65.9** | 7.4/7.4 GiB = 100% | **PASS** |
| gpt-oss:20b | 20B MoE | 402 ms (384/402/405) | 36.1 | 9.3/14.6 GiB = 64% | **PASS** |
| gpt-oss:120b | 120B MoE (~5B) | 888 ms (824/888/1291) | 9.4 | 8.8/64.8 GiB = 14% | PASS (marginal — 1 of 3 samples over) |
| qwen3:32b | 32B dense | 1094 ms (936/1094/1149) | 3.3 | 9.7/23.1 GiB = 42% | FAIL |

## Reading

- **Largest model meeting the 1 s median bar: `gpt-oss:120b`** — a 120B
  MoE runs at 888 ms TTFT with only 14% of its weights on the GPU, because
  only ~5B parameters are active per token. Marginal: sample spread reaches
  1.29 s and 9.4 tok/s decode reads slowly for chat.
- **Best capability-per-latency: `qwen3:30b-a3b`** — first token in 181 ms,
  FASTER than the current 12B baseline, at 2.5× the total parameters;
  18.3 tok/s decode is comfortably conversational.
- **Decode-speed champion stays `gemma4:12b-it-qat`** (65.9 tok/s, only
  fully-GPU-resident model).
- **Dense scaling fails exactly where MoE succeeds**: qwen3:32b (dense)
  fails both TTFT and decode; the near-same-size qwen3:30b-a3b (MoE)
  posts the best TTFT of the whole ladder. On a 12 GB card, active-set
  size — not total parameters — is what the 1 s bar prices.

**No default change** — `gemma4:12b-it-qat` remains the brain default per
the standing keep-12b owner mandate; this ladder is measurement for an
explicit owner decision (quality benching of qwen3:30b-a3b vs gemma4 on
LongMemEval/jd would be the next step if a switch is ever considered).
