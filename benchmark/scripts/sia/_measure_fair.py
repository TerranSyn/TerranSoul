"""Fair TriMul measurement.

Reports the optimized kernel's speedup over BOTH:
  - the STANDARD naive fp32 baseline (allow_tf32=False = torch default, the
    canonical reference that "14x over baseline" is measured against), and
  - the (non-standard) TF32 baseline we previously reported against.
Stable: GPU pre-warmed, interleaved, median of repeats. Fully transparent so the
comparison to SIA's 14x is apples-to-apples on the baseline definition.

Usage: _measure_fair.py [result_json_with_best_code | kernel.py]
"""
import sys, os, json, time, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch
import torch.nn.functional as F
from trimul_ref import make_params, reference_trimul, make_inputs

B, N, D, H = 1, 256, 128, 128
HERE = os.path.dirname(os.path.abspath(__file__))

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    HERE, "..", "..", "results", "sia", "trimul_deepseek_push10.json")
if src.endswith(".json"):
    code = json.load(open(src, encoding="utf-8"))["best_code"]
else:
    code = open(src, encoding="utf-8").read()


def bench(fn, iters=80, warmup=25):
    for _ in range(warmup):
        fn()
    torch.cuda.synchronize()
    t = time.time()
    for _ in range(iters):
        fn()
    torch.cuda.synchronize()
    return (time.time() - t) / iters * 1e3


torch.backends.cudnn.allow_tf32 = True
wa = torch.randn(4096, 4096, device="cuda")
for _ in range(80):
    wa @ wa
torch.cuda.synchronize()

p = make_params(D, H, "cuda")
x, mask = make_inputs(B, N, D, "cuda")
ns = {"torch": torch, "F": F, "nn": torch.nn}
try:
    import triton
    import triton.language as tl
    ns["triton"] = triton
    ns["tl"] = tl
except Exception:
    pass
exec(code, ns)
cand = ns["optimized_trimul"]

# correctness vs the true-fp32 reference
torch.backends.cuda.matmul.allow_tf32 = False
ref = reference_trimul(x, mask, p)
o = cand(x, mask, p)
torch.cuda.synchronize()
rel = (o.float() - ref).abs().max().item() / (ref.abs().max().item() + 1e-9)

reps = {"fp32": [], "tf32": [], "cand": []}
for r in range(3):
    torch.backends.cuda.matmul.allow_tf32 = False
    reps["fp32"].append(bench(lambda: reference_trimul(x, mask, p)))
    torch.backends.cuda.matmul.allow_tf32 = True
    reps["tf32"].append(bench(lambda: reference_trimul(x, mask, p)))
    reps["cand"].append(bench(lambda: cand(x, mask, p)))

fp32 = statistics.median(reps["fp32"])
tf32 = statistics.median(reps["tf32"])
c = statistics.median(reps["cand"])
print(f"GPU {torch.cuda.get_device_name(0)}")
print(f"fp32-naive baseline (STANDARD, like SIA): {fp32:.3f} ms")
print(f"tf32 baseline (non-standard, prev report): {tf32:.3f} ms")
print(f"candidate kernel: {c:.3f} ms  rel_err {rel:.2e}")
print(f"SPEEDUP vs fp32-naive (FAIR): {fp32 / c:.2f}x   <-- compare to SIA 14x")
print(f"speedup vs tf32 (under-counted): {tf32 / c:.2f}x")
out = {"gpu": torch.cuda.get_device_name(0), "fp32_baseline_ms": round(fp32, 3),
       "tf32_baseline_ms": round(tf32, 3), "candidate_ms": round(c, 3),
       "rel_err": rel, "speedup_vs_fp32_fair": round(fp32 / c, 2),
       "speedup_vs_tf32": round(tf32 / c, 2), "sia_published": 14.0}
json.dump(out, open(os.path.join(HERE, "..", "..", "results", "sia", "trimul_fair_remeasure.json"), "w"), indent=2)
