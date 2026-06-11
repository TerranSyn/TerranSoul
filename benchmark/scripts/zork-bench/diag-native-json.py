"""Test Ollama-native /api/chat strict format:json against a realistic
critic-style prompt that triggers gemma4:e4b's reasoning mode."""
from __future__ import annotations
import json, sys, time, urllib.request

HOST = "http://127.0.0.1:11434"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "gemma4:e4b"

# Realistic ZorkGPT critic prompt (mimics zork_critic.py shape)
SYSTEM = (
    "You are a Critic for an LLM agent playing Zork. Evaluate the proposed action.\n"
    "Think step by step through these criteria:\n"
    "1. Context Relevance: Is the action relevant to the current game state?\n"
    "2. Progress Potential: Will this action advance the agent toward solving the game?\n"
    "3. Safety: Could this action waste turns or cause harm?\n"
    "4. Novelty: Has this action been tried before in this location?\n"
    "\nThen respond with a JSON object: {\"score\": <0.0-1.0>, \"justification\": <one sentence>}"
)
USER = (
    "Current Inventory: empty\n"
    "Available Exits: north, south, west\n"
    "Location: West of House (Open field west of a white house, with a boarded front door. There is a small mailbox here.)\n"
    "Recent action history:\n"
    "  Turn 1: 'examine mailbox' -> 'There is a small mailbox here.'\n"
    "  Turn 2: 'open mailbox' -> 'Opening the small mailbox reveals a leaflet.'\n"
    "Proposed action: 'take leaflet'\n"
    "\nEvaluate this action."
)

def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        HOST + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())

variants = [
    ("V1_v1_shim_json_object", "/v1/chat/completions", {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}],
        "response_format": {"type": "json_object"},
        "think": False,
        "temperature": 0.0,
    }),
    ("V2_native_format_json", "/api/chat", {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}],
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"temperature": 0.0, "num_predict": 512},
    }),
]

for name, path, body in variants:
    t0 = time.time()
    try:
        resp = post(path, body)
    except Exception as e:
        print(f"=== [{name}]  FAIL  err={e!r}", flush=True)
        continue
    dt = time.time() - t0
    if path.startswith("/v1"):
        content = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
    else:
        content = resp.get("message", {}).get("content", "")
    try:
        parsed = json.loads(content)
        is_json = True
        keys = list(parsed.keys()) if isinstance(parsed, dict) else []
    except Exception:
        is_json = False
        keys = []
    head = (content or "")[:300].replace("\n", "\\n")
    print(f"=== [{name}]  {dt:.1f}s  is_json={is_json}  keys={keys}  len={len(content or '')} ===", flush=True)
    print(head, flush=True)
    print(flush=True)
