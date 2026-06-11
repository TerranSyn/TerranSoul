"""Patch ZorkGPT's llm_client.py for Ollama compatibility with reasoning models.

Two surgical changes applied at Docker build time:

1. Disable Ollama hidden-reasoning mode by injecting ``"think": false`` into
   the request payload when the base URL targets Ollama. Without this,
   reasoning-capable Gemma 4 models (e.g. ``gemma4:e4b``) consume the entire
   ``max_tokens`` budget on hidden thinking tokens and return an empty
   ``choices[0].message.content`` — causing the upstream EmptyResponseError.

2. Fall back to ``choices[0].message.reasoning`` / ``reasoning_content``
   when ``content`` is empty but reasoning fields exist, so legitimate
   reasoning-only responses are still usable instead of being discarded.

Idempotent — running it twice is a no-op.
"""

from __future__ import annotations

import pathlib
import sys

TARGET = pathlib.Path("/bench/llm_client.py")
src = TARGET.read_text()
original = src

PATCH_1_MARKER = "# TerranSoul: disable Ollama hidden reasoning"
PATCH_2_MARKER = "# TerranSoul: reasoning-field fallback"

# Patch 1 — inject think:false for Ollama just before payload is sent.
anchor1 = "        # Add any additional kwargs\n        payload.update(kwargs)\n"
inject1 = (
    "        # Add any additional kwargs\n"
    "        payload.update(kwargs)\n"
    "\n"
    "        " + PATCH_1_MARKER + " so reasoning-capable models (gemma4:e4b)\n"
    "        # emit real content tokens instead of consuming the whole\n"
    "        # max_tokens budget on hidden chain-of-thought.\n"
    "        if (\n"
    "            self.base_url\n"
    "            and (\"11434\" in self.base_url or \"ollama\" in self.base_url.lower())\n"
    "        ):\n"
    "            payload.setdefault(\"think\", False)\n"
    "            # `think:false` is honoured by Ollama's native /api/chat but NOT\n"
    "            # by the OpenAI-compatible /v1/chat/completions endpoint ZorkGPT\n"
    "            # uses — there, gemma4:12b-it-qat streams its whole max_tokens\n"
    "            # budget into the `reasoning` field and returns empty `content`.\n"
    "            # `reasoning_effort:\"none\"` IS honoured on that endpoint and\n"
    "            # makes the model emit the action directly.\n"
    "            payload.setdefault(\"reasoning_effort\", \"none\")\n"
)
if PATCH_1_MARKER not in src:
    if anchor1 not in src:
        sys.stderr.write("llm_client_patch: anchor 1 not found; bailing.\n")
        sys.exit(2)
    src = src.replace(anchor1, inject1, 1)

# Patch 2 — fall back to reasoning fields when content is empty.
anchor2 = (
    "            if \"choices\" in response_data and len(response_data[\"choices\"]) > 0:\n"
    "                # Standard chat completion format\n"
    "                content = response_data[\"choices\"][0][\"message\"][\"content\"]\n"
)
inject2 = (
    "            if \"choices\" in response_data and len(response_data[\"choices\"]) > 0:\n"
    "                # Standard chat completion format\n"
    "                _msg = response_data[\"choices\"][0][\"message\"]\n"
    "                content = _msg.get(\"content\")\n"
    "                " + PATCH_2_MARKER + ": some Ollama builds still place all\n"
    "                # output into reasoning/reasoning_content even with think=false.\n"
    "                if (content is None or (isinstance(content, str) and not content.strip())):\n"
    "                    for _alt in (\"reasoning_content\", \"reasoning\"):\n"
    "                        _val = _msg.get(_alt)\n"
    "                        if isinstance(_val, str) and _val.strip():\n"
    "                            content = _val\n"
    "                            break\n"
)
if PATCH_2_MARKER not in src:
    if anchor2 not in src:
        sys.stderr.write("llm_client_patch: anchor 2 not found; bailing.\n")
        sys.exit(3)
    src = src.replace(anchor2, inject2, 1)

# Patch 3 — hard-kill timeout wrapper.
# The 120s requests timeout doesn't fire when Ollama drips data (reasoning
# models). Wrap requests.post in a ThreadPoolExecutor with a 180s absolute
# deadline so no single call blocks forever.
PATCH_3_MARKER = "# TerranSoul: hard-kill timeout wrapper"
anchor3 = "        try:\n            response = requests.post(\n                url,\n                headers=headers,\n                json=payload,\n                timeout=self.retry_config.timeout_seconds,\n            )\n"
inject3 = (
    "        try:\n"
    "            " + PATCH_3_MARKER + " — absolute 180s deadline\n"
    "            # prevents Ollama reasoning models from blocking forever\n"
    "            import concurrent.futures as _cf\n"
    "            def _do_post():\n"
    "                return requests.post(\n"
    "                    url,\n"
    "                    headers=headers,\n"
    "                    json=payload,\n"
    "                    timeout=(10, self.retry_config.timeout_seconds),\n"
    "                )\n"
    "            with _cf.ThreadPoolExecutor(max_workers=1) as _ex:\n"
    "                _fut = _ex.submit(_do_post)\n"
    "                try:\n"
    "                    response = _fut.result(timeout=180)\n"
    "                except _cf.TimeoutError:\n"
    "                    raise LLMTimeoutError(\n"
    "                        'Hard timeout (180s) exceeded — Ollama may be stuck on reasoning'\n"
    "                    )\n"
)
if PATCH_3_MARKER not in src:
    if anchor3 not in src:
        sys.stderr.write("llm_client_patch: anchor 3 not found; bailing.\n")
        sys.exit(4)
    src = src.replace(anchor3, inject3, 1)

# Patch 4 — strip inline reasoning (thinking>) from content.
# gemma4:e4b with think=false still emits CoT as a "thinking>...\n\naction"
# prefix in the content field.  This confuses Jericho (the Z-machine parser
# sees "thinking>" as the first word) and breaks critic/extractor JSON parsing.
# We strip everything before the last double-newline boundary when the content
# starts with "thinking>" or contains "<think>...</think>" XML tags.
PATCH_4_MARKER = "# TerranSoul: strip inline reasoning from content"
anchor4 = "            return LLMResponse(content=content, model=model, usage=usage)\n"
inject4 = (
    "            " + PATCH_4_MARKER + "\n"
    "            import re as _re\n"
    "            if isinstance(content, str) and content.strip():\n"
    "                # Strip <think>...</think> XML-style reasoning blocks\n"
    "                content = _re.sub(r'<think>.*?</think>\\s*', '', content, flags=_re.DOTALL).strip()\n"
    "                # Strip thinking>...\\n\\n prefix (gemma4 inline CoT)\n"
    "                if content.lower().startswith('thinking>'):\n"
    "                    # Take everything after the last \\n\\n separator\n"
    "                    parts = content.rsplit('\\n\\n', 1)\n"
    "                    if len(parts) == 2:\n"
    "                        content = parts[1].strip()\n"
    "                    else:\n"
    "                        # Single block — try last line\n"
    "                        lines = content.strip().splitlines()\n"
    "                        if len(lines) > 1:\n"
    "                            content = lines[-1].strip()\n"
    "            return LLMResponse(content=content, model=model, usage=usage)\n"
)
if PATCH_4_MARKER not in src:
    if anchor4 not in src:
        sys.stderr.write("llm_client_patch: anchor 4 not found; bailing.\n")
        sys.exit(5)
    src = src.replace(anchor4, inject4, 1)

# Patch 5 — force Ollama JSON mode for any request that asks for structured
# output. ZorkGPT's critic + extractor pass response_format=create_json_schema(...)
# but gemma4:e4b ignores json_schema enforcement and emits prose ("Thinking
# Process:\n1. Analyze...") instead of JSON, causing every critic/extractor
# parse to fail (-> score=0, empty exits -> agent flails -> turn counter
# explodes past max_turns). Two complementary forces fix this:
#   (a) downgrade response_format to {"type": "json_object"} (universally
#       supported by Ollama's OpenAI-compat endpoint, grammar-constrained), and
#   (b) inject Ollama-native top-level `format: "json"` as belt-and-suspenders.
PATCH_5_MARKER = "# TerranSoul: force Ollama JSON mode"
anchor5 = "            payload.setdefault(\"think\", False)\n"
inject5 = (
    "            payload.setdefault(\"think\", False)\n"
    "            " + PATCH_5_MARKER + " when caller requested structured output.\n"
    "            _rf = payload.get(\"response_format\")\n"
    "            if isinstance(_rf, dict) and _rf.get(\"type\") in (\"json_schema\", \"json_object\"):\n"
    "                payload[\"response_format\"] = {\"type\": \"json_object\"}\n"
    "                payload.setdefault(\"format\", \"json\")\n"
)
if PATCH_5_MARKER not in src:
    if anchor5 not in src:
        sys.stderr.write("llm_client_patch: anchor 5 not found; bailing.\n")
        sys.exit(6)
    src = src.replace(anchor5, inject5, 1)

# Patch 6 — last-resort JSON extraction. If Patch 5 fails (older Ollama, model
# bug) and content still contains prose like "Thinking Process: ... {valid json}",
# extract the first balanced {...} block so json.loads succeeds. Inserted at
# the tail of Patch 4's injection (just before `return LLMResponse(...)`).
PATCH_6_MARKER = "# TerranSoul: balanced-brace JSON extractor"
anchor6 = "            return LLMResponse(content=content, model=model, usage=usage)\n"
inject6 = (
    "            " + PATCH_6_MARKER + "\n"
    "            if isinstance(content, str) and content.strip() and not content.lstrip().startswith('{'):\n"
    "                _s = content\n"
    "                _start = _s.find('{')\n"
    "                if _start >= 0:\n"
    "                    _depth = 0\n"
    "                    _in_str = False\n"
    "                    _esc = False\n"
    "                    _end = -1\n"
    "                    for _i in range(_start, len(_s)):\n"
    "                        _ch = _s[_i]\n"
    "                        if _esc:\n"
    "                            _esc = False\n"
    "                            continue\n"
    "                        if _ch == '\\\\':\n"
    "                            _esc = True\n"
    "                            continue\n"
    "                        if _ch == '\"':\n"
    "                            _in_str = not _in_str\n"
    "                            continue\n"
    "                        if _in_str:\n"
    "                            continue\n"
    "                        if _ch == '{':\n"
    "                            _depth += 1\n"
    "                        elif _ch == '}':\n"
    "                            _depth -= 1\n"
    "                            if _depth == 0:\n"
    "                                _end = _i\n"
    "                                break\n"
    "                    if _end > _start:\n"
    "                        content = _s[_start:_end + 1]\n"
    "            return LLMResponse(content=content, model=model, usage=usage)\n"
)
if PATCH_6_MARKER not in src:
    if anchor6 not in src:
        sys.stderr.write("llm_client_patch: anchor 6 not found; bailing.\n")
        sys.exit(7)
    src = src.replace(anchor6, inject6, 1)

# Patch 7 — reroute to Ollama-native /api/chat when caller requested JSON.
# Ollama's /v1/chat/completions OpenAI shim silently accepts response_format
# {"type":"json_object"} and extra top-level format:"json" but does NOT
# grammar-constrain sampling for gemma4:e4b — the model still emits markdown
# reasoning prose ("**Game State Analysis:**\n* Location: ..."). The native
# /api/chat endpoint DOES grammar-constrain when format:"json" is set, making
# JSON output mandatory at the sampler level. We intercept _do_post and
# rewrite request/response when (a) base_url is Ollama, (b) format:"json"
# was injected by Patch 5.
PATCH_7_MARKER = "# TerranSoul: route JSON requests to Ollama-native /api/chat"
anchor7 = (
    "            " + PATCH_3_MARKER + " — absolute 180s deadline\n"
    "            # prevents Ollama reasoning models from blocking forever\n"
    "            import concurrent.futures as _cf\n"
    "            def _do_post():\n"
    "                return requests.post(\n"
    "                    url,\n"
    "                    headers=headers,\n"
    "                    json=payload,\n"
    "                    timeout=(10, self.retry_config.timeout_seconds),\n"
    "                )\n"
)
inject7 = (
    "            " + PATCH_3_MARKER + " — absolute 180s deadline\n"
    "            # prevents Ollama reasoning models from blocking forever\n"
    "            import concurrent.futures as _cf\n"
    "            " + PATCH_7_MARKER + "\n"
    "            def _do_post():\n"
    "                _native = False\n"
    "                _url = url\n"
    "                _body = payload\n"
    "                if payload.get(\"format\") == \"json\" and self.base_url and (\"11434\" in self.base_url or \"ollama\" in self.base_url.lower()):\n"
    "                    _native = True\n"
    "                    # Strip /v1 suffix from base_url and append /api/chat\n"
    "                    _host = self.base_url.rstrip(\"/\")\n"
    "                    if _host.endswith(\"/v1\"):\n"
    "                        _host = _host[:-3]\n"
    "                    _url = _host + \"/api/chat\"\n"
    "                    _options = {}\n"
    "                    for _k in (\"temperature\", \"top_p\", \"top_k\", \"min_p\", \"stop\"):\n"
    "                        if _k in payload:\n"
    "                            _options[_k] = payload[_k]\n"
    "                    if \"max_tokens\" in payload:\n"
    "                        _options[\"num_predict\"] = payload[\"max_tokens\"]\n"
    "                    _body = {\n"
    "                        \"model\": payload[\"model\"],\n"
    "                        \"messages\": payload[\"messages\"],\n"
    "                        \"stream\": False,\n"
    "                        \"format\": \"json\",\n"
    "                        \"think\": payload.get(\"think\", False),\n"
    "                        \"keep_alive\": \"30m\",\n"
    "                    }\n"
    "                    if _options:\n"
    "                        _body[\"options\"] = _options\n"
    "                _resp = requests.post(\n"
    "                    _url,\n"
    "                    headers=headers,\n"
    "                    json=_body,\n"
    "                    timeout=(10, self.retry_config.timeout_seconds),\n"
    "                )\n"
    "                if _native and _resp.ok:\n"
    "                    # Translate native response to OpenAI-compat shape so\n"
    "                    # the rest of _execute_request stays unchanged.\n"
    "                    try:\n"
    "                        _raw = _resp.json()\n"
    "                        _msg = _raw.get(\"message\") or {}\n"
    "                        _content = _msg.get(\"content\", \"\")\n"
    "                        _shim = {\n"
    "                            \"choices\": [{\"message\": {\"role\": \"assistant\", \"content\": _content, \"reasoning\": \"\", \"reasoning_content\": \"\"}, \"finish_reason\": \"stop\"}],\n"
    "                            \"usage\": {\n"
    "                                \"prompt_tokens\": _raw.get(\"prompt_eval_count\", 0),\n"
    "                                \"completion_tokens\": _raw.get(\"eval_count\", 0),\n"
    "                                \"total_tokens\": _raw.get(\"prompt_eval_count\", 0) + _raw.get(\"eval_count\", 0),\n"
    "                            },\n"
    "                            \"model\": _raw.get(\"model\", payload[\"model\"]),\n"
    "                        }\n"
    "                        # Mutate the response object in place so callers see shim JSON.\n"
    "                        _resp._content = (\n"
    "                            __import__(\"json\").dumps(_shim).encode(\"utf-8\")\n"
    "                        )\n"
    "                    except Exception:\n"
    "                        pass\n"
    "                return _resp\n"
)
if PATCH_7_MARKER not in src:
    if anchor7 not in src:
        sys.stderr.write("llm_client_patch: anchor 7 not found; bailing.\n")
        sys.exit(8)
    src = src.replace(anchor7, inject7, 1)

if src != original:
    TARGET.write_text(src)
    print("llm_client_patch: applied")
else:
    print("llm_client_patch: already applied, no changes")
