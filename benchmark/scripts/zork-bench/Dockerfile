# benchmark/scripts/zork-bench/Dockerfile
#
# Linux container for the ZorkGPT bench. jericho builds cleanly on
# Linux (needs make + gcc) but not on Windows due to POSIX C functions
# (fmemopen, strndup). We use Docker to provide the correct build env.
#
# Build:  docker build -t zork-bench -f benchmark/scripts/zork-bench/Dockerfile .
# Run:    docker run --rm -v ./target-copilot-bench/bench-results:/out zork-bench --arm all --episodes 3

FROM python:3.11-slim AS base

# Build dependencies for jericho (frotz C code)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git && \
    rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution
RUN pip install --no-cache-dir uv

WORKDIR /bench

# Clone ZorkGPT at the pinned commit
ARG ZORKGPT_PIN=4c80f401a17b5f25b3c183d35ac171bf20268864
RUN git clone --no-checkout https://github.com/stickystyle/ZorkGPT /bench && \
    git fetch --depth=1 origin ${ZORKGPT_PIN} && \
    git checkout ${ZORKGPT_PIN}

# Install Python dependencies (jericho builds from source in Linux cleanly).
# We install deps from pyproject.toml without installing ZorkGPT itself as a
# package — run_bench.py imports from the local tree via sys.path.
# Note: deliberately NOT installing langfuse — ZorkGPT imports it under
# try/except and sets LANGFUSE_AVAILABLE=False when missing. Avoids 401s
# trying to reach cloud.langfuse.com and the background thread that
# raises KeyboardInterrupt-like shutdowns on connection failures.
RUN pip install --no-cache-dir \
    'openai>=1.79.0' \
    'pydantic>=2.11.4' \
    'requests>=2.31.0' \
    'python-dotenv>=1.0.0' \
    'jericho>=3.3.0' \
    'filelock>=3.20.0' \
    tiktoken toml \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy the bench bridge + runner
COPY benchmark/scripts/zork-bench/terransoul_brain_bridge.py /bench/terransoul_brain_bridge.py
COPY benchmark/scripts/zork-bench/run_bench.py /bench/run_bench.py
COPY benchmark/scripts/zork-bench/llm_client_patch.py /bench/llm_client_patch.py
COPY benchmark/scripts/zork-bench/upstream_bug_patches.py /bench/upstream_bug_patches.py
COPY benchmark/scripts/zork-bench/zork_critic_patch.py /bench/zork_critic_patch.py
COPY benchmark/scripts/zork-bench/zork_agent_patch.py /bench/zork_agent_patch.py
COPY benchmark/scripts/zork-bench/zork_agent_recency_patch.py /bench/zork_agent_recency_patch.py
# taughtLocalLLM demo — the orchestrator-fork patch + the taught solution it
# serves (demo bench only; gated on TAUGHT_SOLUTION_DEMO=1 at runtime).
COPY benchmark/scripts/zork-bench/zork_orchestrator_patch.py /bench/zork_orchestrator_patch.py
COPY benchmark/terransoul/zorkgpt/taughtLocalLLM/zork_solution_knowledge.txt /bench/taught_solution.txt
# ZADOPT-TEST — Jericho golden-replay validation (run: --entrypoint python
# zork-bench /bench/test_jericho_walkthrough.py). Deterministic, no LLM.
COPY benchmark/scripts/zork-bench/test_jericho_walkthrough.py /bench/test_jericho_walkthrough.py

# Patch upstream llm_client.py for Ollama reasoning-model compatibility
# (disable hidden think mode so gemma4:e4b returns real content).
RUN python /bench/llm_client_patch.py

# Patch upstream ZorkGPT bugs surfaced by iter-K (per bench-discipline rule).
# E1: add_reasoning crashes on None. E2: episode synth uses .attr on dict.
# E3: jericho action sanitization for stray newline/backtick from LLM output.
RUN python /bench/upstream_bug_patches.py

# Spec 014 K15 — brain-gate critic patch (Principle 7). Hard-reject any
# proposed_action not on the brain shortlist so rejection sampling
# converges on the brain's top-ranked entry.
RUN python /bench/zork_critic_patch.py

# Spec 014 K17 — brain-pin agent patch (Principle 7, proposal layer).
# The orchestrator's rejection loop caps at max_rejections=3 and then
# accepts the rejected action. Patching the agent's
# get_action_with_reasoning to clamp off-list outputs to shortlist[0]
# bypasses that cap entirely — the LLM's choice is forced into the
# brain-ranked candidate set BEFORE the critic ever sees it.
RUN python /bench/zork_agent_patch.py

# ODY-9 — PAC2026 recency-zone brain directive (proposal layer, prompt side).
# Appends the brain's #1 action to the LAST user message so the weak model
# PROPOSES the brain choice directly (LLMs attend most to prompt recency),
# instead of relying on the hard-pin + critic to override a bad proposal.
RUN python /bench/zork_agent_recency_patch.py

# taughtLocalLLM demo — fork the orchestrator loop so the brain's taught move
# is served reliably on EVERY turn, keyed by the orchestrator's own turn_count
# (the bridge hooks fire only intermittently and rejection-sampling desyncs a
# blind pointer). Demo bench only; gated on TAUGHT_SOLUTION_DEMO=1 at runtime.
RUN python /bench/zork_orchestrator_patch.py

# Host where Ollama is reachable FROM the container. Default host.docker.internal
# (Docker Desktop -> Windows host) works when Ollama runs natively on Windows or
# under WSL mirrored networking. When Ollama runs in a WSL NAT distro it is only
# reachable at the Docker bridge gateway, so build with
#   --build-arg OLLAMA_BASE_HOST=172.17.0.1
# MCP (--mcp-host) stays on host.docker.internal independently of this.
ARG OLLAMA_BASE_HOST=host.docker.internal
ENV OLLAMA_BASE_HOST=${OLLAMA_BASE_HOST}
# Write .env pointing at host Ollama
ARG BENCH_MODEL=gemma4:e4b
RUN echo "CLIENT_BASE_URL=http://${OLLAMA_BASE_HOST}:11434/v1" > /bench/.env && \
    echo 'CLIENT_API_KEY=ollama' >> /bench/.env && \
    echo 'ZORKGPT_CLIENT_API_KEY=ollama' >> /bench/.env && \
    echo "AGENT_MODEL=${BENCH_MODEL}" >> /bench/.env && \
    echo "CRITIC_MODEL=${BENCH_MODEL}" >> /bench/.env && \
    echo "INFO_EXT_MODEL=${BENCH_MODEL}" >> /bench/.env && \
    echo "ANALYSIS_MODEL=${BENCH_MODEL}" >> /bench/.env && \
    echo 'MAX_TURNS_PER_EPISODE=300' >> /bench/.env && \
    echo 'LANGFUSE_PUBLIC_KEY=' >> /bench/.env && \
    echo 'LANGFUSE_SECRET_KEY=' >> /bench/.env

# Patch pyproject.toml to use local Ollama instead of OpenRouter.
# ZorkGPT reads base_url and models from TOML, not from env vars.
RUN python -c "import re, pathlib, os; \
model = os.environ.get('BENCH_MODEL', 'gemma4:e4b'); \
host = os.environ.get('OLLAMA_BASE_HOST', 'host.docker.internal'); \
p = pathlib.Path('pyproject.toml'); \
t = p.read_text(); \
t = re.sub(r'client_base_url\s*=\s*\"[^\"]*\"', f'client_base_url = \"http://{host}:11434/v1\"', t); \
t = re.sub(r'agent_model\s*=\s*\"[^\"]*\"', f'agent_model = \"{model}\"', t); \
t = re.sub(r'info_ext_model\s*=\s*\"[^\"]*\"', f'info_ext_model = \"{model}\"', t); \
t = re.sub(r'critic_model\s*=\s*\"[^\"]*\"', f'critic_model = \"{model}\"', t); \
t = re.sub(r'analysis_model\s*=\s*\"[^\"]*\"', f'analysis_model = \"{model}\"', t); \
t = re.sub(r'memory_model\s*=\s*\"[^\"]*\"', f'memory_model = \"{model}\"', t); \
t = re.sub(r'condensation_model\s*=\s*\"[^\"]*\"', f'condensation_model = \"{model}\"', t); \
p.write_text(t)" 
ENV BENCH_MODEL=${BENCH_MODEL}

# Unbuffer Python stdout/stderr so crashes/tracebacks reach the log even
# when the container terminates abruptly (per bench-discipline rule —
# we must be able to root-cause every ERROR/crash).
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1

# Default game: zork1.z5 from jericho-game-suite
ENV ZORK_ROM_PATH=/bench/jericho-game-suite/zork1.z5

# Output dir (mount a host volume here)
RUN mkdir -p /out

ENTRYPOINT ["python", "run_bench.py", "--out-dir", "/out", "--resume"]
# Default: all arms, 3 episodes. Override with docker run args.
# --resume is baked into ENTRYPOINT so `docker restart` picks up
# where the last run left off (skips completed episodes).
CMD ["--arm", "none", "--episodes", "1"]
