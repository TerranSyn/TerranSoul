"""Stable, fair TriMul measurement: unload Ollama (free the GPU), warm the
clocks globally, then time the reference + each candidate INTERLEAVED across
several repeats and report the MEDIAN speedup. Controls for the GPU-contention +
clock-boost-order noise that made single-shot speedups unreliable."""
import sys, os, json, time, urllib.request, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch
import torch.nn.functional as F
from trimul_ref import make_params, reference_trimul, make_inputs

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
B, N, D, H = 1, 256, 128, 128


def unload_all():
    try:
        ps = json.loads(urllib.request.urlopen(OLLAMA + "/api/ps", timeout=10).read())
        for m in ps.get("models", []):
            body = json.dumps({"model": m["name"], "keep_alive": 0, "prompt": "",
                               "stream": False}).encode()
            try:
                urllib.request.urlopen(urllib.request.Request(
                    OLLAMA + "/api/generate", data=body,
                    headers={"Content-Type": "application/json"}), timeout=30).read()
            except Exception:
                pass
        print("unloaded:", [m["name"] for m in ps.get("models", [])])
    except Exception as e:
        print("unload skipped:", e)


def bench(fn, iters=100, warmup=30):
    for _ in range(warmup):
        fn()
    torch.cuda.synchronize()
    t = time.time()
    for _ in range(iters):
        fn()
    torch.cuda.synchronize()
    return (time.time() - t) / iters * 1e3


unload_all()
time.sleep(3)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
p = make_params(D, H, "cuda")
x, mask = make_inputs(B, N, D, "cuda")
ref = reference_trimul(x, mask, p)

# global GPU warmup so clocks are boosted before any timing
wa = torch.randn(4096, 4096, device="cuda")
for _ in range(80):
    wa @ wa
torch.cuda.synchronize()

cand_files = [f for f in sys.argv[1:]] or ["_cand2.py", "_cand3.py"]
fns = {"reference": (lambda: reference_trimul(x, mask, p), 0.0)}
for cf in cand_files:
    ns = {"torch": torch, "F": F, "nn": torch.nn}
    try:
        import triton
        import triton.language as tl
        ns["triton"] = triton
        ns["tl"] = tl
    except Exception:
        pass
    exec(open(cf, encoding="utf-8").read(), ns)
    fn = ns["optimized_trimul"]
    o = fn(x, mask, p)
    torch.cuda.synchronize()
    rel = (o.float() - ref).abs().max().item() / (ref.abs().max().item() + 1e-9)
    fns[cf] = ((lambda f=fn: f(x, mask, p)), rel)

names = list(fns.keys())
reps = {n: [] for n in names}
for r in range(3):
    for n in names:
        reps[n].append(bench(fns[n][0]))
refmed = statistics.median(reps["reference"])
print(f"GPU {torch.cuda.get_device_name(0)}")
print(f"reference median {refmed:.4f} ms  runs={[round(v,3) for v in reps['reference']]}")
for n in names:
    if n == "reference":
        continue
    med = statistics.median(reps[n])
    print(f"{n}: median {med:.4f} ms  speedup {refmed/med:.3f}x  rel_err {fns[n][1]:.2e}  "
          f"runs={[round(v,3) for v in reps[n]]}")
