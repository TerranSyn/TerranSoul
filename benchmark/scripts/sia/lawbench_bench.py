"""LawBench charge-prediction with SIA's EXACT data + their official exact-match metric.

Pool = training_data/train.csv (5332 labeled); test = public/test.csv (facts) scored
vs private/test.csv (gold); 191 charge classes from classes.json. embeddinggemma
retrieves k similar labeled cases; a frozen actor (ollama 12B or deepseek via API)
predicts ONE of the 191 charges from the fact + retrieved examples. Pool embeddings
are cached to .npy. Metric == SIA's evaluate.py (exact-match accuracy). Same-subset:
run --provider ollama & deepseek on the SAME seed-42 test split. No weight training.
"""
import argparse, csv, json, os, sys, time, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DATA = os.path.join(HERE, "..", "..", "..", "scratchpad", "sia-lawbench")
EMBED_MODEL = "embeddinggemma:latest"
csv.field_size_limit(10 ** 7)


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load():
    pool = [{"fact": " ".join(r["text"].split()), "charge": r["label"]}
            for r in read_csv(os.path.join(DATA, "training_data", "train.csv"))
            if r.get("text") and r.get("label")]
    facts = {r["id"]: " ".join(r["text"].split()) for r in read_csv(os.path.join(DATA, "public", "test.csv"))}
    gold = {r["id"]: r["label"] for r in read_csv(os.path.join(DATA, "private", "test.csv"))}
    test = [{"id": i, "fact": facts[i], "charge": gold[i]} for i in facts if i in gold]
    classes = json.load(open(os.path.join(DATA, "public", "classes.json"), encoding="utf-8"))
    return pool, test, classes


def embed_one(text):
    body = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(OLLAMA + "/api/embed", data=body, headers={"Content-Type": "application/json"})
    return np.array(json.loads(urllib.request.urlopen(req, timeout=120).read())["embeddings"][0], dtype=np.float32)


def embed_many(texts, prefix):
    out = []
    for i, t in enumerate(texts):
        out.append(embed_one(prefix + t[:1500]))
        if (i + 1) % 500 == 0:
            print(f"  embed {i+1}/{len(texts)}", flush=True)
    return np.stack(out)


def ollama_chat(model, prompt):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                       "stream": False, "keep_alive": 0, "think": False,
                       "options": {"temperature": 0.0, "num_ctx": 8192, "num_predict": 48}}).encode()
    req = urllib.request.Request(OLLAMA + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())["message"]["content"]


def parse_charge(text, classes):
    text = text.strip()
    if text in classes:
        return text
    hits = [c for c in classes if c in text]
    if hits:
        return max(hits, key=len)
    return text.split("\n")[0].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="deepseek")
    ap.add_argument("--model", default="deepseek-v4-pro")
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "results", "sia", "lawbench_deepseek.json"))
    args = ap.parse_args()

    pool, test, classes = load()
    rng = np.random.default_rng(42)
    test = [test[i] for i in rng.permutation(len(test))[:args.n]]
    print(f"[data] pool {len(pool)}, test {len(test)} (of full 913), {len(classes)} classes", flush=True)

    cache = os.path.join(DATA, f"pool_emb_{len(pool)}.npy")
    if os.path.exists(cache):
        pe = np.load(cache)
        print(f"[embed] loaded cached pool {pe.shape}", flush=True)
    else:
        print(f"[embed] embedding {len(pool)} pool facts (one-time, cached after)...", flush=True)
        pe = embed_many([it["fact"] for it in pool], "title: none | text: ")
        np.save(cache, pe)
    te = embed_many([it["fact"] for it in test], "task: search result | query: ")
    pe = pe / (np.linalg.norm(pe, axis=1, keepdims=True) + 1e-9)
    te = te / (np.linalg.norm(te, axis=1, keepdims=True) + 1e-9)

    if args.provider == "deepseek":
        from _actor import deepseek_chat

    correct = knn_correct = 0
    log = []
    for i, it in enumerate(test):
        top = np.argsort(-(pe @ te[i]))[:args.k]
        ex = "\n".join(f"{n+1}. 罪名: {pool[j]['charge']}  事实: {pool[j]['fact'][:140]}" for n, j in enumerate(top))
        cand = [pool[j]["charge"] for j in top]
        knn_pred = max(set(cand), key=cand.count)
        prompt = ("你是中国刑事法官。根据本案事实预测罪名。罪名必须从相似案例中出现过的罪名里选择，"
                  "只输出罪名（与示例完全一致的写法，不要解释、不要标点）。\n\n"
                  f"相似案例:\n{ex}\n\n本案事实: {it['fact'][:700]}\n\n罪名:")
        t0 = time.time()
        try:
            reply = deepseek_chat(args.model, [{"role": "user", "content": prompt}]) if args.provider == "deepseek" \
                else ollama_chat(args.model, prompt)
        except Exception as e:
            log.append({"id": it["id"], "err": str(e)[:80]})
            print(f"  {i+1}/{len(test)} ERR {str(e)[:50]}", flush=True)
            continue
        pred = parse_charge(reply, classes)
        ok, knn_ok = pred == it["charge"], knn_pred == it["charge"]
        correct += ok
        knn_correct += knn_ok
        log.append({"id": it["id"], "gold": it["charge"], "pred": pred, "ok": bool(ok), "knn": knn_pred, "secs": round(time.time() - t0, 1)})
        print(f"  {i+1}/{len(test)} gold={it['charge']} pred={pred} {'OK' if ok else 'X'} ({round(time.time()-t0)}s)", flush=True)

    n = len([l for l in log if "pred" in l])
    acc = correct / n if n else 0.0
    out = {"benchmark": "SIA-LawBench charge prediction (SIA exact data, 191 classes, official exact-match metric)",
           "method": f"TerranSoul memory-RAG (embeddinggemma k={args.k} over {len(pool)}-case pool) + {args.model} via {args.provider}, frozen, NO weight training",
           "n": n, "k": args.k, "accuracy_exact_match": round(acc, 4),
           "knn_majority_acc": round(knn_correct / n, 4) if n else None,
           "sia_published_top1": 0.701, "gemma12b_full913_top1": 0.7634, "log": log,
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")}
    json.dump(out, open(os.path.abspath(args.out), "w"), ensure_ascii=False, indent=2)
    print(f"\n==== {args.model}/{args.provider}: exact-match {acc:.3f} (n={n}); kNN-base {knn_correct/n if n else 0:.3f}; SIA 0.701; 12B-full 0.763 ====", flush=True)


if __name__ == "__main__":
    main()
