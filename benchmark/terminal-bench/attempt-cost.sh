#!/usr/bin/env bash
# COST-side attribution: do attempts 2..k cost less than attempt 1?
#
#   usage: attempt-cost.sh <jobs-dir> <prefix>
#
# Owner's expectation, and the most tangible benefit a memory can deliver:
# "run 2-5 will be much cheaper since everything is taught in first k". Cost is
# continuous, so it resolves at a far smaller n than pass rate does.
#
# MEASURED on the archived k=5 job dg-20260804-182446:
#     attempt 1   mean 58,057 output tokens / 2,094,774 in(+cache)   n=10
#     attempts 2+ mean 35,282 output tokens / 1,711,113 in(+cache)   n=9
#     -> output 0.61x, input 0.82x
#
# ⚠️ TREAT 0.61x AS A FLOOR, NOT A RESULT. That job ran before every memory fix:
# 34% of lessons were markup-corrupted with their tags destroyed, and failing
# tasks wrote nothing at all. Later attempts were reading a damaged corpus, and
# whether any of them actually received attempt 1's lesson is unverifiable there
# (memory ids were reused across brain resets). A working pipeline should do
# better; this script is how we find out instead of assuming either way.
set -uo pipefail
JOBS="${1:?usage: attempt-cost.sh <jobs-dir> <prefix>}"
PREFIX="${2:?usage: attempt-cost.sh <jobs-dir> <prefix>}"

python - "$JOBS" "$PREFIX" <<'PY'
import json, os, sys, glob
from collections import defaultdict

jobs_dir, prefix = sys.argv[1], sys.argv[2]

def trial_tokens(d):
    out = inp = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            if not f.endswith('.jsonl'):
                continue
            try:
                fh = open(os.path.join(root, f), encoding='utf-8', errors='replace')
            except OSError:
                continue
            for ln in fh:
                if '"usage"' not in ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                u = ((rec.get('message') or {}).get('usage')) or rec.get('usage') or {}
                if isinstance(u, dict):
                    out += u.get('output_tokens', 0) or 0
                    inp += (u.get('input_tokens', 0) or 0) + (u.get('cache_read_input_tokens', 0) or 0)
    return out, inp

# Attempt order is recoverable only from file mtimes -- harbor's trial ids carry
# a random suffix and no index.
bytask = defaultdict(list)
for job in glob.glob(os.path.join(jobs_dir, prefix + "*")):
    for tdir in glob.glob(os.path.join(job, "*__*")):
        if not os.path.isdir(tdir):
            continue
        tid = os.path.basename(tdir)
        starts = [os.path.getmtime(os.path.join(r, f))
                  for r, _d, fs in os.walk(tdir) for f in fs]
        if not starts:
            continue
        out, inp = trial_tokens(tdir)
        if out == 0:
            continue
        bytask[tid.rsplit('__', 1)[0]].append((min(starts), out, inp))

a_out = a_in = l_out = l_in = 0
n_a = n_l = 0
for _task, rows in bytask.items():
    rows.sort()
    for idx, (_s, out, inp) in enumerate(rows, start=1):
        if idx == 1: a_out += out; a_in += inp; n_a += 1
        else:        l_out += out; l_in += inp; n_l += 1

if not (n_a and n_l):
    print(f"  need >1 attempt per task to compare (attempt1 n={n_a}, later n={n_l})")
    sys.exit(0)

r_o = (l_out/n_l)/(a_out/n_a)
r_i = (l_in/n_l)/(a_in/n_a)
print(f"  attempt 1   : n={n_a}  {a_out/n_a:,.0f} out / {a_in/n_a:,.0f} in")
print(f"  attempts 2+ : n={n_l}  {l_out/n_l:,.0f} out / {l_in/n_l:,.0f} in")
print(f"  COST RATIO  : output {r_o:.2f}x   input {r_i:.2f}x")
print(f"  -> a later attempt costs roughly {r_o*100:.0f}% of the first")
print("")
print("  Output tokens drive cost; input is largely cache reads. If memory works,")
print("  this ratio IS the benefit -- and it is measurable long before pass rate moves.")
PY
