"""Harbor agent that runs TerranSoul against Terminal-Bench 2.1.

WHY HOST-SIDE, NOT INSTALLED-IN-CONTAINER
-----------------------------------------
Harbor offers two agent shapes. ``BaseInstalledAgent`` installs a CLI *into* the
task container and runs it there -- that is how ``claude-code`` and ``codex``
work. ``BaseAgent`` runs on the HOST and drives the container through
``environment.exec(...)``; the built-in ``oracle`` agent is one of these.

TerranSoul takes the second shape, for two reasons that are not preferences:

1. The binary is built for Windows and the task containers are Linux. Installing
   it would mean cross-compiling the whole workspace per run.
2. More importantly, TerranSoul's reasoning core wants the HOST -- it talks to a
   local Ollama with GPU offload. Shipping it into a 1-CPU/2 GB task container
   would measure the container's CPU, not the model.

So the brain stays here and only the shell commands cross into the container.
That is also what keeps ``rules/one-path-three-surfaces.md`` satisfied: the
agentic loop, tool schema, exit gate and reasoning core are the SAME ones the
desktop and CLI surfaces run. The only substitution is the ``CommandHost``
implementation behind the ``run_command`` tool -- host shell becomes
``environment.exec``. Transport differs; the reasoning path does not.

THE PROTOCOL
------------
Line-delimited JSON over the child's stdio (see ``crates/coding/src/exec_bridge.rs``).
The child owns stdout for protocol frames and writes human progress to stderr::

    child  -> stdout   {"type":"exec_request","id":1,"args":{...}}
    us     -> stdin    {"type":"exec_response","id":1,"result":{...}}
                   or  {"type":"exec_response","id":1,"error":"..."}

``args`` is the raw ``run_command`` tool-call JSON and ``result`` is the tool
result that re-enters the model's context. Neither side reinterprets the other's
schema, so a tool-schema change does not require a change here.
"""

from __future__ import annotations

import asyncio
import json
import os
import shlex
from pathlib import Path
from typing import Any

try:  # `typing.override` is 3.12+; Harbor's own venv has it, a bare 3.11 does not.
    from typing import override
except ImportError:  # pragma: no cover - exercised only on <3.12
    try:
        from typing_extensions import override
    except ImportError:
        def override(fn):  # type: ignore[misc]
            """No-op fallback. The decorator is documentation, not behaviour."""
            return fn

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

# The container path Terminal-Bench tasks are rooted at.
_TASK_ROOT = "/app"


class TerranSoulAgent(BaseAgent):
    """Drives the TerranSoul agentic loop against a Harbor environment."""

    SUPPORTS_WINDOWS: bool = True

    def __init__(
        self,
        logs_dir: Path,
        model_name: str | None = None,
        extra_env: dict[str, str] | None = None,
        agent_timeout_sec: float | None = None,
        binary: str | None = None,
        mode: str = "max",
        workdir: str = _TASK_ROOT,
        **kwargs: Any,
    ):
        super().__init__(
            logs_dir=logs_dir,
            model_name=model_name,
            extra_env=extra_env,
            **kwargs,
        )
        self._agent_timeout_sec = agent_timeout_sec
        # Resolved at call time rather than import time so a run can point at a
        # freshly built binary without reinstalling the agent.
        # The CLI is the `terransoul` bin target, not a separate `terransoul-cli`.
        _exe = "terransoul.exe" if os.name == "nt" else "terransoul"
        self._binary = binary or os.environ.get(
            "TERRANSOUL_CLI",
            str(Path(__file__).resolve().parents[2] / "src-tauri" / "target" / "release" / _exe),
        )
        self._mode = mode
        self._workdir = workdir
        self._exec_count = 0
        self._failed_execs = 0

    @staticmethod
    @override
    def name() -> str:
        return "terransoul"

    @override
    def version(self) -> str:
        return "0.1.0"

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        # Nothing to install: the agent runs on the host. Kept explicit rather
        # than inherited so it is obvious this is deliberate.
        return

    async def _serve_one(
        self,
        frame: dict[str, Any],
        environment: BaseEnvironment,
    ) -> dict[str, Any]:
        """Execute one ``exec_request`` inside the environment."""
        req_id = frame.get("id")
        args = frame.get("args") or {}

        # `run_command`'s tool schema carries the script under `code`, with the
        # interpreter under `language`. Only shell crosses into the container as
        # a command; anything else is written to a temp file and interpreted, so
        # a python/node tool call behaves the same way it would on the host.
        code = args.get("code") or ""
        language = (args.get("language") or "shell").strip().lower()
        cwd = args.get("cwd") or self._workdir
        timeout = args.get("timeout_secs")

        if language in ("shell", "bash", "sh", ""):
            command = code
        else:
            interpreter = {"python": "python3", "node": "node", "ruby": "ruby"}.get(
                language, language
            )
            # Heredoc keeps the payload out of argv, so quoting inside the script
            # is the script's business and never ours.
            command = f"{interpreter} <<'__TS_EOF__'\n{code}\n__TS_EOF__"

        try:
            result = await environment.exec(
                command=command,
                cwd=cwd,
                timeout_sec=int(timeout) if timeout else None,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the loop as a tool error
            self._failed_execs += 1
            return {"type": "exec_response", "id": req_id, "error": f"{type(exc).__name__}: {exc}"}

        self._exec_count += 1
        exit_code = getattr(result, "exit_code", None)
        if exit_code is None:
            exit_code = getattr(result, "returncode", 0)
        if exit_code != 0:
            self._failed_execs += 1

        return {
            "type": "exec_response",
            "id": req_id,
            "result": {
                # `status` is what BridgeCommandHost counts on for the
                # verify-on-stop evidence set -- it must mirror what
                # AgentCommandHost produces on the host path.
                "status": "success" if exit_code == 0 else "error",
                "exit_code": exit_code,
                "stdout": getattr(result, "stdout", "") or "",
                "stderr": getattr(result, "stderr", "") or "",
                "cwd": cwd,
            },
        }

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext | None = None,
        **kwargs: Any,
    ) -> Any:
        # `--agent-task` TAKES the prompt as its value; there is no `--prompt`.
        argv = [
            self._binary,
            "--agent-task",
            instruction,
            "--exec-bridge",
            "stdio",
            "--grant-dir",
            self._workdir,
            "--mode",
            self._mode,
        ]
        if self.model_name:
            argv += ["--model", self.model_name]

        env = {**os.environ, **(self.extra_env or {})}
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        transcript: list[dict[str, Any]] = []
        stderr_path = Path(self.logs_dir) / "terransoul-stderr.log"
        outcome: dict[str, Any] | None = None

        async def pump_stderr() -> None:
            with stderr_path.open("wb") as fh:
                assert proc.stderr is not None
                async for line in proc.stderr:
                    fh.write(line)
                    fh.flush()

        stderr_task = asyncio.create_task(pump_stderr())

        try:
            assert proc.stdout is not None and proc.stdin is not None
            async for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    # Not a protocol frame. Record it rather than discarding --
                    # a silently dropped line is how a protocol drift becomes a
                    # mysterious hang.
                    transcript.append({"unparsed": line})
                    continue

                kind = frame.get("type")
                if kind == "exec_request":
                    reply = await self._serve_one(frame, environment)
                    transcript.append({"request": frame, "reply": reply})
                    proc.stdin.write((json.dumps(reply) + "\n").encode("utf-8"))
                    await proc.stdin.drain()
                else:
                    # The terminal frame (the agent-task outcome).
                    outcome = frame
                    transcript.append({"outcome": frame})
        finally:
            if proc.stdin and not proc.stdin.is_closing():
                proc.stdin.close()
            await proc.wait()
            await stderr_task

        (Path(self.logs_dir) / "bridge-transcript.json").write_text(
            json.dumps(transcript, indent=2), encoding="utf-8"
        )

        if proc.returncode != 0 and outcome is None:
            raise RuntimeError(
                f"terransoul agent-task exited {proc.returncode} without an outcome; "
                f"see {stderr_path}"
            )
        return outcome
