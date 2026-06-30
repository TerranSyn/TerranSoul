"""GPU measurement subprocess for the TriMul bench.

Runs in a short-lived process so it owns the GPU alone (the 12B coder model is
unloaded by the orchestrator via keep_alive:0 before this is launched). Measures
the fp32 reference latency and, if a candidate code file is given, the
candidate's correctness (relative max-error vs the fp32 reference) and latency.
Writes a JSON result and exits (freeing the GPU for the next generation).
"""
from __future__ import annotations
import argparse, json, os, sys, time, traceback
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trimul_ref import make_params, reference_trimul, make_inputs  # noqa: E402

B, N, D, H = 1, 256, 128, 128
REL_TOL = 3e-2


def bench(fn, iters=50, warmup=15):
    for _ in range(warmup):
        fn()
    torch.cuda.synchronize()
    t = time.time()
    for _ in range(iters):
        fn()
    torch.cuda.synchronize()
    return (time.time() - t) / iters * 1e3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = {"gpu": None, "ref_latency_ms": None, "ok": False, "rel_err": None,
           "latency_ms": None, "err": None}
    if not torch.cuda.is_available():
        out["err"] = "no CUDA"
        json.dump(out, open(args.out, "w"))
        return

    # bounded wait for GPU memory to free (12B unloading), max ~30s
    for _ in range(6):
        free, total = torch.cuda.mem_get_info()
        if free > 3 * 1024**3:
            break
        time.sleep(5)

    out["gpu"] = torch.cuda.get_device_name(0)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    p = make_params(D, H, "cuda")
    x, mask = make_inputs(B, N, D, "cuda")
    ref = reference_trimul(x, mask, p)
    out["ref_latency_ms"] = round(bench(lambda: reference_trimul(x, mask, p)), 4)

    if args.code:
        code = open(args.code, encoding="utf-8").read()
        ns = {"torch": torch, "F": F, "nn": torch.nn}
        try:
            import triton
            import triton.language as tl
            ns["triton"] = triton
            ns["tl"] = tl
        except Exception:
            pass
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("_cand_mod", args.code)
            _mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(_mod)  # import as a real module: @triton.jit needs a source file (exec'd strings break triton's inspect.getsourcelines)
            fn = getattr(_mod, "optimized_trimul", None)
            if fn is None:
                out["err"] = "no function named optimized_trimul defined"
            else:
                o = fn(x, mask, p)
                torch.cuda.synchronize()
                o = o.float()
                if tuple(o.shape) != tuple(ref.shape):
                    out["err"] = f"wrong shape {tuple(o.shape)} vs {tuple(ref.shape)}"
                else:
                    rel = (o - ref).abs().max().item() / (ref.abs().max().item() + 1e-9)
                    out["rel_err"] = rel
                    if rel < REL_TOL:
                        out["latency_ms"] = round(bench(lambda: fn(x, mask, p)), 4)
                        out["ok"] = True
                    else:
                        out["err"] = f"incorrect: rel_err={rel:.3e} >= tol {REL_TOL:.0e}"
        except Exception:
            out["err"] = "exec/runtime error:\n" + traceback.format_exc(limit=5)

    json.dump(out, open(args.out, "w"))


if __name__ == "__main__":
    main()
