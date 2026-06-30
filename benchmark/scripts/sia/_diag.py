"""Diagnose deepseek-v4-pro empty-content: replicate an iter>=2 prompt (seeded
TASK + a champion 'beat it' turn) and report finish_reason + the content vs
reasoning_content token split + usage, at a large max_tokens."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trimul_bench as T

key = os.environ["DEEPSEEK_API_KEY"]
champ = ("import torch\nimport torch.nn.functional as F\n@torch.compile\n"
         "def optimized_trimul(x, mask, p):\n    return F.layer_norm(x, (x.shape[-1],), p['norm_in_w'], p['norm_in_b'])  # placeholder")
msgs = [
    {"role": "system", "content": T.SYSTEM},
    {"role": "user", "content": T.TASK},
    {"role": "assistant", "content": "```python\n" + champ + "\n```"},
    {"role": "user", "content": "CURRENT BEST: 2.61x, correct. Beat it with a fused Triton kernel that avoids "
     "materializing the [B,N,N,H] intermediates. Output exactly one ```python block defining optimized_trimul(x, mask, p)."},
]
mt = 32768
body = json.dumps({"model": "deepseek-v4-pro", "messages": msgs, "max_tokens": mt, "stream": False}).encode()
req = urllib.request.Request("https://api.deepseek.com/chat/completions", data=body,
                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
d = json.loads(urllib.request.urlopen(req, timeout=1200).read())
m = d["choices"][0]
msg = m["message"]
c = msg.get("content") or ""
rc = msg.get("reasoning_content") or ""
print(f"max_tokens={mt} finish_reason={m.get('finish_reason')}", flush=True)
print(f"content_len={len(c)} reasoning_content_len={len(rc)} usage={d.get('usage')}", flush=True)
print(f"def_in_content={'def optimized_trimul' in c} def_in_reasoning={'def optimized_trimul' in rc}", flush=True)
print("content_head:", c[:300].replace(chr(10), " "), flush=True)
