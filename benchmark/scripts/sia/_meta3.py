"""TriMul 3-round accumulating self-improvement.

Actor: deepseek-v4-pro (frozen, via API). The seeded TerranSoul memory lives in
trimul_bench.TASK. Each ROUND starts from the prior rounds' BEST kernel (the
champion) and is told to beat it; the champion accumulates across rounds, so run
N inherits everything runs 1..N-1 learned. Demonstrates cross-run learning.
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trimul_bench as T
from _actor import deepseek_chat

MODEL = "deepseek-v4-pro"
ROUNDS = 3
ITERS = 4
HERE = os.path.dirname(os.path.abspath(__file__))


def run_round(champion_code, champion_su, rno):
    champ = None
    if champion_code:
        champ = {"code": champion_code,
                 "feedback": (f"CURRENT BEST kernel so far: {champion_su:.2f}x speedup, correct. "
                              "Make it FASTER while staying within rel-err 3e-2. Build on it; "
                              "do not regress to slower approaches (no explicit permute/reshape/bmm).")}
    best, last, log = None, None, []
    for it in range(ITERS):
        hist = [h for h in (champ, last) if h]
        try:
            reply = deepseek_chat(MODEL, T.build_messages(hist))
        except Exception as e:
            log.append({"iter": it + 1, "ok": False, "err": "actor:" + str(e)[:80]})
            print(f"  R{rno} iter{it+1}: actor error {str(e)[:60]}", flush=True)
            time.sleep(2)
            continue
        code = T.extract_code(reply)
        res = T.measure(code, MODEL)
        ok = res["ok"]
        su = (res["ref_latency_ms"] / res["latency_ms"]) if ok else None
        if ok and (best is None or su > best["speedup"]):
            best = {"speedup": su, "code": code, "latency_ms": res["latency_ms"],
                    "rel_err": res["rel_err"], "ref_latency_ms": res["ref_latency_ms"]}
        fb = (f"Correct but only {su:.2f}x ({res['latency_ms']} ms vs {res['ref_latency_ms']} ms ref). "
              "Make it faster, rel-err < 3e-2."
              if ok else
              f"FAILED: {str(res.get('err'))[:200]}. Output exactly ONE ```python block "
              "defining optimized_trimul(x, mask, p).")
        last = {"code": code, "feedback": fb}
        log.append({"iter": it + 1, "ok": ok, "speedup": round(su, 3) if su else None})
        print(f"  R{rno} iter{it+1}: ok={ok} su={round(su,3) if su else None}", flush=True)
    return best, log


champion_code, champion_su = None, 0.0
rounds = []
for r in range(ROUNDS):
    print(f"=== ROUND {r+1}/{ROUNDS} (champion so far {champion_su:.3f}x) ===", flush=True)
    best, log = run_round(champion_code, champion_su, r + 1)
    rb = best["speedup"] if best else None
    if best and best["speedup"] > champion_su:
        champion_code, champion_su = best["code"], best["speedup"]
    rounds.append({"round": r + 1, "round_best_speedup": round(rb, 3) if rb else None,
                   "champion_after_round": round(champion_su, 3), "iters": log})
    print(f"=== ROUND {r+1} done: round-best {rb}  champion {champion_su:.3f}x ===", flush=True)

out = {
    "benchmark": "SIA-TriMul 3-round accumulating self-improvement",
    "actor": "deepseek-v4-pro (frozen, via API) + TerranSoul seeded memory",
    "rounds": ROUNDS, "iters_per_round": ITERS,
    "champion_per_round": [r["champion_after_round"] for r in rounds],
    "final_champion_speedup": round(champion_su, 3),
    "rounds_detail": rounds,
    "final_champion_code": champion_code,
    "note": "per-iter speedups are single-shot (GPU-noisy); the final champion is re-measured stably afterward.",
}
outp = os.path.join(HERE, "..", "..", "results", "sia", "trimul_deepseek_3round.json")
os.makedirs(os.path.dirname(outp), exist_ok=True)
json.dump(out, open(outp, "w"), indent=2)
print(f"FINAL champion {champion_su:.3f}x across {ROUNDS} rounds; per-round: "
      f"{[r['champion_after_round'] for r in rounds]}", flush=True)
