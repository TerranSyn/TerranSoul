"""SIA-suite benchmark reproduction on TerranSoul: AlphaFold-3 TriMul kernel.

TerranSoul's FROZEN model (gemma4:12b-it-qat via Ollama -- NO weight training)
is the coding agent: it writes/optimizes an implementation of the Triangle
Multiplicative Update whose fp32 reference is in trimul_ref.py. Each candidate is
correctness-gated against the fp32 reference (relative max-error) and timed on
the local GPU. We iterate with error/latency feedback (the agentic loop SIA
uses) and keep the fastest correct candidate.

    speedup = reference_latency / best_correct_candidate_latency   (measured)

GPU-sharing: the 12B fills the 12 GB card, so we generate with keep_alive:0
(unloads the model, freeing the GPU) and then measure each candidate in a
short-lived torch subprocess (trimul_measure.py) that exits and frees the GPU
before the next generation. At no moment do torch and the 12B both hold the GPU.

SIA published: 14x speedup over baseline on H100 (weight-trained gpt-oss-120b).
TerranSoul here: frozen 12B, measured on the local GPU. Hardware + method differ
from SIA's H100 run; we report exactly what was measured.
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
REL_TOL = 3e-2
B, N, D, H = 1, 256, 128, 128
REF_SRC = open(os.path.join(HERE, "trimul_ref.py")).read()

SYSTEM = (
    "You are an expert CUDA/Triton/PyTorch kernel engineer. You write fast, "
    "numerically correct GPU code. Reply with EXACTLY ONE ```python fenced code "
    "block and nothing else."
)
TASK = f"""Optimize the AlphaFold-3 Triangle Multiplicative Update.

The fp32 REFERENCE implementation (the baseline you must beat) is:

```python
{REF_SRC}
```

Write a function `optimized_trimul(x, mask, p)` with the SAME signature and the
SAME mathematical result as `reference_trimul`, but as FAST as possible on an
NVIDIA GPU (Ampere, sm_86). Rules:
- x: [B={B}, N={N}, N={N}, D={D}] float32 ; mask: [B,N,N,1] float32 ; p: the dict
  from make_params (D={D}, H={H}).
- You MAY use torch, torch.nn.functional as F, triton, and `import triton.language as tl`.
- You MAY compute internally in bf16/fp16 (tensor cores) as long as the final
  result matches the fp32 reference with relative max-error < {REL_TOL:.0e}.
- The heavy op is einsum('b i k d, b j k d -> b i j d', a, b). Consider fusing
  the projections/gates, a Triton kernel, bf16 tensor cores, torch.compile, or a
  batched-matmul formulation -- whatever is fastest while staying correct.
- Return ONLY the function (and any @triton.jit kernels / imports it needs).
  Do not call it. Do not print.
- Prefer a CONCISE, complete, correct solution (under ~120 lines) -- e.g. bf16
  batched-matmul with fused gating -- over a long complex kernel. Output the
  COMPLETE function; do not get cut off mid-code.

PRIOR TERRANSOUL OPTIMIZATION MEMORY (hard-won findings on THIS exact kernel from
earlier self-improvement runs -- BUILD ON THESE, do not rediscover them):
- BEST KNOWN (~2.9x, correct, rel-err ~7e-3): keep the forward in einsum form
  (torch.einsum("bikd,bjkd->bijd", a, b)), wrap the whole function body in
  torch.compile(mode="max-autotune") (cache the compiled fn in a module-global),
  and run the matmuls under torch.autocast("cuda", torch.bfloat16). Let inductor
  lower the einsum -- this fuses the layernorms/gates and uses bf16 tensor cores.
- KNOWN REGRESSION -- AVOID: hand-writing the triangle product as
  a.permute(...).reshape(...) then torch.bmm(...). The permute/reshape COPIES are
  memory-bound and erase the speedup (~1.0x). Plain eager bf16 (no compile) is
  only ~1.1x. Do NOT go down these paths.
- BOTTLENECK after compile: the triangle batched-matmul is occupancy-limited at
  N=256, D=128. The biggest remaining win is a SINGLE fused Triton kernel that
  computes the projections + gating + triangle product WITHOUT materializing the
  [B,N,N,H] intermediates. If you attempt the frontier, do that.
- bf16 matmuls with fp32 accumulation stay well within the 3e-2 tolerance.
- FORMAT: output exactly ONE ```python block that DEFINES optimized_trimul(x,
  mask, p); the grader calls that function by name directly.
"""


def build_messages(history):
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TASK}]
    for h in history:
        msgs.append({"role": "assistant", "content": "```python\n" + h["code"] + "\n```"})
        msgs.append({"role": "user", "content": h["feedback"]})
    return msgs


def ollama_chat(model, messages, temperature=0.3, num_ctx=8192):
    # think:false -> emit code directly instead of burning the whole budget on
    # reasoning (gemma4 otherwise returns empty content). keep_alive:0 unloads
    # the model after responding so the GPU frees for the torch measurement.
    body = json.dumps({
        "model": model, "messages": messages, "stream": False, "keep_alive": 0,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": num_ctx, "num_predict": 4096},
    }).encode()
    req = urllib.request.Request(OLLAMA + "/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())["message"]["content"]


def extract_code(text):
    m = re.search(r"```(?:python)?\s*(.*?)```", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def unload_model(model):
    """Force Ollama to evict the model from the GPU so torch can use it."""
    body = json.dumps({"model": model, "prompt": "", "keep_alive": 0,
                       "stream": False}).encode()
    req = urllib.request.Request(OLLAMA + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except Exception:
        pass


def measure(code, model):
    """Run the measurement subprocess (owns the GPU alone). Returns result dict."""
    unload_model(model)  # free the GPU before any torch allocation
    code_path = os.path.join(HERE, "_cand.py")
    res_path = os.path.join(HERE, "_res.json")
    if code is not None:
        open(code_path, "w", encoding="utf-8").write(code)
    cmd = [sys.executable, os.path.join(HERE, "trimul_measure.py"), "--out", res_path]
    if code is not None:
        cmd += ["--code", code_path]
    subprocess.run(cmd, check=True, timeout=600)
    return json.load(open(res_path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=6)
    ap.add_argument("--model", default="gemma4:12b-it-qat")
    ap.add_argument("--provider", default="ollama")  # ollama | deepseek
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "results", "sia",
                    "trimul_terransoul.json"))
    args = ap.parse_args()

    base = measure(None, args.model)
    ref_lat = base["ref_latency_ms"]
    gpu = base["gpu"]
    print(f"[ref] fp32 einsum baseline: {ref_lat} ms on {gpu}")

    history, iters_log, best = [], [], None
    for it in range(args.iters):
        print(f"\n=== iter {it+1}/{args.iters} : asking {args.model} ===")
        t0 = time.time()
        try:
            if args.provider == "deepseek":
                from _actor import deepseek_chat
                reply = deepseek_chat(args.model, build_messages(history))
            else:
                reply = ollama_chat(args.model, build_messages(history))
        except Exception as e:
            print("  actor error:", e)
            iters_log.append(dict(iter=it + 1, ok=False, err=f"actor: {e}"))
            break
        gen_s = round(time.time() - t0, 1)
        code = extract_code(reply)
        res = measure(code, args.model)
        # speedup vs the reference measured in the SAME subprocess (same GPU state)
        cand_ref = res.get("ref_latency_ms") or ref_lat
        rec = dict(iter=it + 1, gen_s=gen_s, ok=res["ok"], rel_err=res.get("rel_err"),
                   latency_ms=res.get("latency_ms"), ref_latency_ms=cand_ref,
                   speedup=round(cand_ref / res["latency_ms"], 3) if res["ok"] else None,
                   err=res.get("err"))
        iters_log.append(rec)
        if res["ok"]:
            su = cand_ref / res["latency_ms"]
            print(f"  CORRECT rel_err={res['rel_err']:.2e} {res['latency_ms']} ms "
                  f"speedup={su:.2f}x (gen {gen_s}s)")
            if best is None or su > best["speedup"]:
                best = dict(latency_ms=res["latency_ms"], rel_err=res["rel_err"],
                            ref_latency_ms=cand_ref, speedup=su, code=code)
            fb = (f"Correct (rel_err={res['rel_err']:.2e}) but {res['latency_ms']} ms = "
                  f"{su:.2f}x vs the {cand_ref} ms reference. Make it FASTER while staying "
                  f"within rel-err {REL_TOL:.0e}. Try bf16 tensor cores / a fused Triton "
                  f"kernel / fewer intermediates if you have not already.")
        else:
            print(f"  FAIL: {str(res['err'])[:200]} (gen {gen_s}s)")
            fb = (f"Your code FAILED:\n{res['err']}\nFix it. Return one ```python block "
                  f"defining optimized_trimul(x, mask, p) matching the fp32 reference "
                  f"within rel-err {REL_TOL:.0e}.")
        history.append(dict(code=code, feedback=fb))
        history[:] = history[-2:]

    out = {
        "benchmark": "SIA-AlphaFold-3 TriMul kernel (Triangle Multiplicative Update)",
        "method": f"TerranSoul frozen-model coding agent ({args.model} via {args.provider}, NO weight training)",
        "hardware": gpu,
        "shapes": {"B": B, "N": N, "D": D, "H": H, "dtype_ref": "float32"},
        "rel_tol": REL_TOL,
        "reference_latency_ms": best["ref_latency_ms"] if best else ref_lat,
        "best_latency_ms": best["latency_ms"] if best else None,
        "best_rel_err": best["rel_err"] if best else None,
        "speedup": round(best["speedup"], 3) if best else None,
        "n_iters": len(iters_log),
        "any_correct": best is not None,
        "iters_log": iters_log,
        "best_code": best["code"] if best else None,
        "sia_published": {"speedup": 14.0,
                          "method": "SIA-W+H weight-trained gpt-oss-120b on H100",
                          "note": "runtime reduction 91.9%"},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    outp = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    json.dump(out, open(outp, "w"), indent=2)
    print("\n==== SUMMARY ====")
    print(f"reference {ref_lat} ms | best {out['best_latency_ms']} ms | "
          f"speedup {out['speedup']}x | correct={out['any_correct']}")
    print("wrote", outp)


if __name__ == "__main__":
    main()
