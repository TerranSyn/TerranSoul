"""LawBench charge-prediction (open-compass task 3-3) with TerranSoul memory-RAG.

embeddinggemma retrieves k similar labeled cases from a pool; a frozen actor
(deepseek via API, or local ollama 12B) predicts the charge (罪名) from the fact +
retrieved examples. Fair same-subset: run with --provider deepseek and ollama on
the SAME seed-42 split. No weight training.
"""
import argparse, json, os, re, sys, time, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DATA = os.path.join(HERE, "..", "..", "..", "scratchpad", "lawbench", "3-3.json")
EMBED_MODEL = "embeddinggemma:latest"


def load_items():
    d = json.load(open(DATA, encoding="utf-8"))
    items = []
    for x in d:
        fact = " ".join(x["question"].split())
        charge = re.sub(r"^[\s\S]*罪名[:：]", "", x["answer"]).replace("<eoa>", "").strip()
        if fact and charge:
            items.append({"fact": fact, "charge": charge})
    return items


def embed_one(text):
    body = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(OLLAMA + "/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    return np.array(json.loads(urllib.request.urlopen(req, timeout=120).read())["embeddings"][0], dtype=np.float32)


def embed_many(texts, prefix):
    return np.stack([embed_one(prefix + t) for t in texts])


def ollama_chat(model, prompt):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                       "stream": False, "keep_alive": 0, "think": False,
                       "options": {"temperature": 0.0, "num_ctx": 8192, "num_predict": 64}}).encode()
    req = urllib.request.Request(OLLAMA + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())["message"]["content"]


def parse_charge(text, valid):
    for c in sorted(valid, key=len, reverse=True):
        if c and c in text:
            return c
    t = re.sub(r"[\s\S]*罪名[:：]", "", text).replace("<eoa>", "").strip()
    return t.split()[0] if t.split() else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="deepseek")
    ap.add_argument("--model", default="deepseek-v4-pro")
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--pool", type=int, default=300)
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "results", "sia", "lawbench_deepseek.json"))
    args = ap.parse_args()

    items = load_items()
    rng = np.random.default_rng(42)
    idx = rng.permutation(len(items))
    test = [items[i] for i in idx[:args.n]]
    pool = [items[i] for i in idx[args.n:args.n + args.pool]]
    valid = sorted({it["charge"] for it in items})
    print(f"[data] {len(items)} cases, {len(valid)} charges; pool {len(pool)}, test {len(test)}", flush=True)

    print("[embed] embeddinggemma pool+test...", flush=True)
    pe = embed_many([it["fact"] for it in pool], "title: none | text: ")
    te = embed_many([it["fact"] for it in test], "task: search result | query: ")
    pe /= (np.linalg.norm(pe, axis=1, keepdims=True) + 1e-9)
    te /= (np.linalg.norm(te, axis=1, keepdims=True) + 1e-9)

    if args.provider == "deepseek":
        from _actor import deepseek_chat

    correct = knn_correct = 0
    log = []
    for i, it in enumerate(test):
        top = np.argsort(-(pe @ te[i]))[:args.k]
        ex = "\n".join(f"- 事实: {pool[j]['fact'][:160]} → 罪名: {pool[j]['charge']}" for j in top)
        cand = [pool[j]["charge"] for j in top]
        knn_pred = max(set(cand), key=cand.count)
        prompt = (f"你是法官。参考下面相似案例的罪名，预测本案的罪名，只输出罪名名称（不要解释）。\n\n"
                  f"相似案例:\n{ex}\n\n本案事实: {it['fact'][:600]}\n\n罪名:")
        t0 = time.time()
        try:
            reply = deepseek_chat(args.model, [{"role": "user", "content": prompt}]) if args.provider == "deepseek" \
                else ollama_chat(args.model, prompt)
        except Exception as e:
            log.append({"i": i, "err": str(e)[:80]})
            print(f"  {i+1}/{len(test)} ERR {str(e)[:50]}", flush=True)
            continue
        pred = parse_charge(reply, valid)
        ok, knn_ok = pred == it["charge"], knn_pred == it["charge"]
        correct += ok
        knn_correct += knn_ok
        log.append({"i": i, "gold": it["charge"], "pred": pred, "ok": bool(ok), "knn": knn_pred, "secs": round(time.time() - t0, 1)})
        print(f"  {i+1}/{len(test)} gold={it['charge']} pred={pred} {'OK' if ok else 'X'} ({round(time.time()-t0)}s)", flush=True)

    n = len([l for l in log if "pred" in l])
    acc = correct / n if n else 0.0
    out = {"benchmark": "SIA-LawBench charge prediction (open-compass 3-3)",
           "method": f"TerranSoul memory-RAG (embeddinggemma k={args.k}) + {args.model} via {args.provider}, frozen, NO weight training",
           "n": n, "pool": len(pool), "k": args.k, "accuracy_top1": round(acc, 4),
           "knn_majority_acc": round(knn_correct / n, 4) if n else None,
           "sia_published_top1": 0.701, "gemma12b_full913_top1": 0.7634, "log": log,
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")}
    json.dump(out, open(os.path.abspath(args.out), "w"), indent=2)
    print(f"\n==== {args.model}/{args.provider}: acc {acc:.3f} (n={n}); kNN-base {knn_correct/n if n else 0:.3f}; SIA 0.701; 12B-full 0.763 ====", flush=True)


if __name__ == "__main__":
    main()
