"""Reproduce-first regression test — reflect-time brain_summarize timeout.

Origin: 2026-06-16 validation-bench root-cause. Both 12B self-improvement
benches (zork-12b-selfimprove-stack / -v2) reported reflections_ingested=0 in
ALL 6 episodes — INCLUDING the clean ones (stack-v2 ep1: 20 errors, score 10;
stack ep2: 12 errors, score 10). The bench JSONL shows the episode-end
`reflect` call hitting repeated `"error": "timed out"` then `"skipped":
"empty_summary"`: the real 12B summarization of a multi-thousand-char trajectory
tail exceeds the McpClient's single shared 20s HTTP timeout, returns empty, and
the ingest block (with its top_reflection_ingested=1 counter) is skipped. The
one historical success (reflexion ep1) measured 11.8s — just under the 20s wall.
Because brain_search / brain_ingest_lesson are fast they finish under 20s, which
is why room_reflections (short trace inputs) sometimes landed while the long
trajectory / conjecturer / aspect / contrastive summaries never did. The whole
iter-1..iter-6 generative stack shared that one wall.

The earlier K-EMPTY-SUMMARY (shorter tail + 1 retry) and K-DECOUPLE (iter-6
deterministic fallback) mitigations could not fix it: both retries hit the same
20s wall, and iter-1/iter-2/iter-5 have no fallback — they need the real text.

The fix is pure transport/wiring (no game content, AGI-pure): McpClient.call /
McpClient.tool take an optional per-call timeout, and the five EPISODE-END
brain_summarize calls in reflect_on_episode pass REFLECT_SUMMARIZE_TIMEOUT
(180s). Per-turn calls keep the snappy 20s default so a slow brain never stalls
the turn loop.

Proves, in <0.1s with NO bench run and NO real MCP call:
  1. McpClient honours a per-call timeout override and otherwise keeps the 20s
     default (lightweight calls stay snappy).
  2. EVERY brain_summarize call inside reflect_on_episode passes
     timeout=REFLECT_SUMMARIZE_TIMEOUT (AST contract — guards against a future
     reflect-time summarize being added without the long ceiling).
  3. The constant is a sane long ceiling (>= 120s and strictly greater than the
     McpClient default), and encodes no game content.
"""
import ast
import sys
import urllib.request
from pathlib import Path

BRIDGE = Path(__file__).with_name("terransoul_brain_bridge.py")
sys.path.insert(0, str(BRIDGE.parent))

import terransoul_brain_bridge as tbb  # noqa: E402
from terransoul_brain_bridge import McpClient, REFLECT_SUMMARIZE_TIMEOUT  # noqa: E402

fails: list[str] = []


# --- 1. McpClient honours a per-call timeout override -----------------------
class _FakeResp:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._payload


_seen_timeouts: list = []


def _fake_urlopen(req, timeout=None):
    _seen_timeouts.append(timeout)
    # A valid JSON-RPC tools/call envelope with no isError.
    body = b'{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}]}}'
    return _FakeResp(body)


# Isolate from the filesystem token + the network.
tbb._load_token = lambda _repo_root: None  # type: ignore[assignment]
_orig_urlopen = urllib.request.urlopen
urllib.request.urlopen = _fake_urlopen  # type: ignore[assignment]
try:
    mcp = McpClient(port=7423, repo_root=BRIDGE.parent, host="127.0.0.1")

    if mcp.timeout != 20.0:
        fails.append(f"McpClient default timeout changed from 20.0 to {mcp.timeout} "
                     "(lightweight per-turn calls must stay snappy)")

    # default path -> self.timeout (20s)
    _seen_timeouts.clear()
    mcp.tool("brain_search", {"query": "x"})
    if _seen_timeouts != [20.0]:
        fails.append(f"default tool() did not use the 20s client timeout: {_seen_timeouts}")

    # explicit override on tool() threads through to urlopen
    _seen_timeouts.clear()
    mcp.tool("brain_summarize", {"text": "x"}, timeout=REFLECT_SUMMARIZE_TIMEOUT)
    if _seen_timeouts != [REFLECT_SUMMARIZE_TIMEOUT]:
        fails.append(f"tool(timeout=...) override not honoured: {_seen_timeouts} "
                     f"(expected [{REFLECT_SUMMARIZE_TIMEOUT}])")

    # override on the lower-level call() too
    _seen_timeouts.clear()
    mcp.call("tools/call", {"name": "brain_summarize", "arguments": {"text": "x"}}, timeout=55.0)
    if _seen_timeouts != [55.0]:
        fails.append(f"call(timeout=...) override not honoured: {_seen_timeouts}")
finally:
    urllib.request.urlopen = _orig_urlopen  # type: ignore[assignment]


# --- 2. CONTRACT: every brain_summarize in reflect_on_episode is long-timeout -
tree = ast.parse(BRIDGE.read_text(encoding="utf-8"))
reflect_fn = next(
    (n for n in ast.walk(tree)
     if isinstance(n, ast.FunctionDef) and n.name == "reflect_on_episode"),
    None,
)
if reflect_fn is None:
    fails.append("could not find reflect_on_episode to audit its summarize calls")
else:
    summarize_calls = []
    for node in ast.walk(reflect_fn):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        # match self.mcp.tool("brain_summarize", ...)
        if (isinstance(fn, ast.Attribute) and fn.attr == "tool"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == "brain_summarize"):
            summarize_calls.append(node)

    if len(summarize_calls) < 5:
        fails.append(f"expected >=5 reflect-time brain_summarize calls, found "
                     f"{len(summarize_calls)} (trajectory/aspect/conjecturer/"
                     "contrastive/room) — did a path get dropped?")
    for i, node in enumerate(summarize_calls):
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        tv = kw.get("timeout")
        ok = isinstance(tv, ast.Name) and tv.id == "REFLECT_SUMMARIZE_TIMEOUT"
        if not ok:
            fails.append(
                f"reflect-time brain_summarize call #{i + 1} (line {node.lineno}) does "
                "NOT pass timeout=REFLECT_SUMMARIZE_TIMEOUT — it will share the 20s "
                "wall and silently zero reflections_ingested again")


# --- 3. The constant is a sane long ceiling, seed-free ----------------------
if not isinstance(REFLECT_SUMMARIZE_TIMEOUT, (int, float)):
    fails.append("REFLECT_SUMMARIZE_TIMEOUT must be numeric")
elif REFLECT_SUMMARIZE_TIMEOUT < 120:
    fails.append(f"REFLECT_SUMMARIZE_TIMEOUT={REFLECT_SUMMARIZE_TIMEOUT} too short — "
                 "a 12B summarize under load needs a wide margin over the ~12-50s norm")
elif REFLECT_SUMMARIZE_TIMEOUT <= 20.0:
    fails.append("REFLECT_SUMMARIZE_TIMEOUT must strictly exceed the 20s default")


if fails:
    print("FAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)

print(
    "PASS: McpClient honours a per-call timeout override (default stays 20s for "
    "snappy per-turn calls); all 5 episode-end brain_summarize calls in "
    f"reflect_on_episode pass timeout=REFLECT_SUMMARIZE_TIMEOUT (={REFLECT_SUMMARIZE_TIMEOUT}s); "
    "the iter-1..iter-6 generative stack no longer shares the 20s wall that zeroed "
    "reflections_ingested across every 2026-06-16 bench episode. Transport-only, AGI-pure."
)
sys.exit(0)
