"""TerranSoul: upstream ZorkGPT bug patches.

Three idempotent in-place patches applied at image-build time to fix
chronic upstream errors that pollute bench logs and (occasionally) crash
mid-episode. Each patch is marker-gated so re-runs are no-ops.

Per `rules/coding-standards.md` bench-discipline rule: every ERROR/WARN
line observed during a bench run must be root-caused and fixed at source
or wrapped. These three fixes target the errors seen in iter-K:

  E1. context_manager.add_reasoning: `len(reasoning)` crashes when the
      agent returns {"reasoning": null}. Coerce None -> "" at function
      entry so the downstream debug log and history append both work.

  E2. episode_synthesizer.generate_episode_summary: GameConfiguration
      types `analysis_sampling` as a `dict` (dataclass field) but the
      synthesizer reads it with attribute access (`.temperature`). Wrap
      each access with a dict-safe getter.

  E3. jericho_interface.send_command: LLM-emitted actions sometimes
      contain trailing newline + markdown ticks (e.g. "examine door\n`").
      Jericho rejects these silently. Sanitize: strip control chars,
      surrounding ticks/quotes/asterisks, and clamp to one line.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path("/bench")

# -------- E1: context_manager.add_reasoning --------------------------------
CTX_PATH = ROOT / "managers" / "context_manager.py"
CTX_MARKER = "# TerranSoul-E1: coerce None reasoning"
CTX_ANCHOR = (
    "    def add_reasoning(self, reasoning: str, agent_action: str = \"\") -> None:\n"
    "        \"\"\"Add agent reasoning to reasoning history.\"\"\"\n"
    "        try:\n"
)
CTX_REPLACEMENT = (
    "    def add_reasoning(self, reasoning: str, agent_action: str = \"\") -> None:\n"
    "        \"\"\"Add agent reasoning to reasoning history.\"\"\"\n"
    "        " + CTX_MARKER + "\n"
    "        if reasoning is None:\n"
    "            reasoning = \"\"\n"
    "        if agent_action is None:\n"
    "            agent_action = \"\"\n"
    "        try:\n"
)

# -------- E2: episode_synthesizer dict-vs-attr -----------------------------
SYN_PATH = ROOT / "managers" / "episode_synthesizer.py"
SYN_MARKER = "# TerranSoul-E2: dict-safe sampling access"
SYN_ANCHOR = (
    "            messages = [{\"role\": \"user\", \"content\": prompt}]\n"
    "            response = self.llm_client.chat.completions.create(\n"
    "                model=self.config.analysis_model,\n"
    "                messages=messages,\n"
    "                temperature=self.config.analysis_sampling.temperature,\n"
    "                top_p=self.config.analysis_sampling.top_p,\n"
    "                top_k=self.config.analysis_sampling.top_k,\n"
    "                min_p=self.config.analysis_sampling.min_p,\n"
    "                max_tokens=self.config.analysis_sampling.max_tokens,\n"
    "                name=\"EpisodeSynthesizer\",\n"
    "            )\n"
)
SYN_REPLACEMENT = (
    "            messages = [{\"role\": \"user\", \"content\": prompt}]\n"
    "            " + SYN_MARKER + "\n"
    "            _samp = self.config.analysis_sampling\n"
    "            def _sg(key, default):\n"
    "                if _samp is None:\n"
    "                    return default\n"
    "                if isinstance(_samp, dict):\n"
    "                    return _samp.get(key, default)\n"
    "                return getattr(_samp, key, default)\n"
    "            response = self.llm_client.chat.completions.create(\n"
    "                model=self.config.analysis_model,\n"
    "                messages=messages,\n"
    "                temperature=_sg(\"temperature\", 0.3),\n"
    "                top_p=_sg(\"top_p\", 0.9),\n"
    "                top_k=_sg(\"top_k\", 40),\n"
    "                min_p=_sg(\"min_p\", 0.0),\n"
    "                max_tokens=_sg(\"max_tokens\", 512),\n"
    "                name=\"EpisodeSynthesizer\",\n"
    "            )\n"
)

# -------- E3: jericho_interface.send_command sanitization ------------------
JER_PATH = ROOT / "game_interface" / "core" / "jericho_interface.py"
JER_MARKER = "# TerranSoul-E3: sanitize action before jericho.step"
JER_ANCHOR = (
    "        if self.env is None:\n"
    "            raise RuntimeError(\"Environment not started. Call start() first.\")\n"
    "\n"
    "        observation, reward, done, info = self.env.step(cmd)\n"
)
JER_REPLACEMENT = (
    "        if self.env is None:\n"
    "            raise RuntimeError(\"Environment not started. Call start() first.\")\n"
    "\n"
    "        " + JER_MARKER + "\n"
    "        if cmd is None:\n"
    "            cmd = \"\"\n"
    "        cmd = str(cmd).replace(\"\\r\", \" \").replace(\"\\n\", \" \")\n"
    "        cmd = cmd.strip().strip(\"`*_'\\\"\").strip()\n"
    "        if len(cmd) > 200:\n"
    "            cmd = cmd[:200]\n"
    "        if not cmd:\n"
    "            cmd = \"look\"\n"
    "        observation, reward, done, info = self.env.step(cmd)\n"
)


def _apply(path: Path, marker: str, anchor: str, replacement: str, label: str) -> bool:
    if not path.exists():
        sys.stderr.write(f"upstream_bug_patches[{label}]: missing target {path}\n")
        return False
    src = path.read_text()
    if marker in src:
        print(f"upstream_bug_patches[{label}]: already applied")
        return True
    if anchor not in src:
        sys.stderr.write(f"upstream_bug_patches[{label}]: anchor not found in {path}; bailing\n")
        return False
    path.write_text(src.replace(anchor, replacement, 1))
    print(f"upstream_bug_patches[{label}]: applied")
    return True


def main() -> int:
    ok = True
    ok &= _apply(CTX_PATH, CTX_MARKER, CTX_ANCHOR, CTX_REPLACEMENT, "E1-add_reasoning")
    ok &= _apply(SYN_PATH, SYN_MARKER, SYN_ANCHOR, SYN_REPLACEMENT, "E2-analysis_sampling")
    ok &= _apply(JER_PATH, JER_MARKER, JER_ANCHOR, JER_REPLACEMENT, "E3-cmd_sanitize")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
