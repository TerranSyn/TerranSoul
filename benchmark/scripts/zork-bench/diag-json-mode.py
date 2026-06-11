"""Surgical diagnostic: does gemma4:e4b honor JSON-output modes on Ollama?

Sends 4 variants of the same critic-style prompt and prints the first
80 chars of the response so we can see which mode (if any) actually
forces JSON output instead of "Thinking Process: ..." prose.

Variants:
  V1  bare              — no JSON mode, just the prompt
  V2  json_schema       — OpenAI-style {"type":"json_schema", "json_schema":{...}}  (ZorkGPT's current)
  V3  json_object       — OpenAI-style {"type":"json_object"}
  V4  ollama_format     — Ollama-native top-level {"format":"json"}
  V5  both              — V3 + V4 combined

Run from host (Windows/macOS/Linux) against the local Ollama at :11434.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request

URL = "http://127.0.0.1:11434/v1/chat/completions"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "gemma4:e4b"

# Minimal critic-style prompt (drastically shorter than ZorkGPT's real
# system prompt, but the same structural ask: emit a JSON object).
SYSTEM = (
    "You are a Zork action critic. You evaluate a proposed action and "
    "return STRICT JSON with two fields:\n"
    "  - score: float in [-1.0, 1.0]\n"
    "  - justification: short string\n"
    "Return ONLY the JSON object. No prose, no markdown, no thinking."
)
USER = (
    "Location: West of House. The player is at an open field with a "
    "white house and a small mailbox.\n"
    "Proposed action: examine mailbox\n"
    "Return the JSON."
)

CRITIC_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "CriticResponse",
        "schema": {
            "type": "object",
            "properties": {
                "score": {"type": "number"},
                "justification": {"type": "string"},
            },
            "required": ["score", "justification"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}

BASE = {
    "model": MODEL,
    "messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": USER},
    ],
    "temperature": 0.0,
    "max_tokens": 400,
    "think": False,  # Patch 1 — disable Gemma reasoning mode
}


def call(label: str, extra: dict) -> None:
    payload = dict(BASE)
    payload.update(extra)
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer ollama"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[{label}] EXCEPTION after {time.monotonic() - t0:.1f}s: {e}")
        return
    dt = time.monotonic() - t0
    try:
        msg = data["choices"][0]["message"]
        content = msg.get("content") or msg.get("reasoning_content") or msg.get("reasoning") or ""
    except Exception:
        content = json.dumps(data)[:200]
    # Try parsing as JSON.
    is_json = False
    parsed = None
    try:
        parsed = json.loads(content.strip())
        is_json = isinstance(parsed, dict)
    except Exception:
        is_json = False
    first_brace = content.find("{")
    print(f"\n=== [{label}]  {dt:.1f}s  is_json={is_json}  first_brace_at={first_brace}  len={len(content)} ===")
    print(content[:400])


print(f"Model: {MODEL}  URL: {URL}", flush=True)
call("V1_bare", {})
call("V2_json_schema", {"response_format": CRITIC_SCHEMA})
call("V3_json_object", {"response_format": {"type": "json_object"}})
call("V4_ollama_format", {"format": "json"})
call("V5_both", {"response_format": {"type": "json_object"}, "format": "json"})

# V6: Ollama-native structured-output (pass JSON Schema as the `format` value
# instead of the string "json"). This is the documented Ollama way to force
# strict schema-grammar JSON output.
OLLAMA_NATIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "number"},
        "justification": {"type": "string"},
    },
    "required": ["score", "justification"],
}
call("V6_ollama_schema", {"format": OLLAMA_NATIVE_SCHEMA})

# V7: XML instead of JSON. Ask the model for XML (which Gemma family is
# trained to emit reliably) and we'll convert XML→JSON in the patch.
XML_SYSTEM = (
    "You are a Zork action critic. Return your verdict as XML in this exact "
    "shape and NOTHING else:\n"
    "<critic><score>FLOAT_BETWEEN_-1_AND_1</score>"
    "<justification>SHORT_STRING</justification></critic>"
)
call("V7_xml_prose", {"messages": [
    {"role": "system", "content": XML_SYSTEM},
    {"role": "user", "content": USER},
]})
