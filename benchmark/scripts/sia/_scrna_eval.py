"""Score an Opus-authored denoise() candidate on the same PBMC3k molecular-CV
protocol the 12B run used (imports the harness's data prep + scorer verbatim)."""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scrna_bench import load_counts, prepare, score

counts = load_counts()
train, test = prepare(counts)
base = score(train, train, test)
ns = {"np": np, "numpy": np}
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_scrna_cand.py")).read(), ns)
denoise = ns["denoise"]
t0 = time.time()
d = np.asarray(denoise(train.copy()), dtype=np.float64)
dt = time.time() - t0
mse = score(d, train, test)
print(f"SCRNA baseline={base:.5f} mse={mse:.5f} impr={(base-mse)/base*100:+.1f}% "
      f"secs={dt:.1f} shape={tuple(d.shape)} train={tuple(train.shape)}")
