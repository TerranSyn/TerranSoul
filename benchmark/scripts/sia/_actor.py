"""Provider-agnostic chat actor for the SIA-suite harnesses.

DeepSeek is OpenAI-compatible. The API key is read from the DEEPSEEK_API_KEY
environment variable AT RUNTIME and is never stored in the repo or in any
result file. This module contains no key.
"""
import json
import os
import urllib.request


def deepseek_chat(model, messages, temperature=0.3, max_tokens=48000):  # v4-pro reasons ~31k tokens; needs room for code after
    key = os.environ["DEEPSEEK_API_KEY"]
    body = json.dumps({
        "model": model, "messages": messages,
        "temperature": temperature, "max_tokens": max_tokens, "stream": False,
    }).encode()
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]
