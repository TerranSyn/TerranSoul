#!/usr/bin/env bash
# Run TerranSoul against Terminal-Bench 2.1 through Harbor.
#
# Usage:
#   ./run-tb.sh oracle                      # $0 infra smoke, no model
#   ./run-tb.sh terransoul fix-git          # one task, local 12B
#   ./run-tb.sh terransoul '' 5             # first 5 tasks
#
# Env:
#   TB21_DIR       clone of harbor-framework/terminal-bench-2-1 (required)
#   TERRANSOUL_CLI path to the terransoul binary (default: release build)
#   TS_MODEL       model name passed to the agent (default: unset -> CLI resolves)
#   TS_MODE        thinking mode (default: max)
set -euo pipefail

# Harbor's CLI renders tables with U+2713 / U+2717. Without these, the Windows
# console codepage raises UnicodeEncodeError and the command dies BEFORE running
# anything -- a crash that looks like a harness bug and is purely encoding.
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${1:-terransoul}"
TASK="${2:-}"
LIMIT="${3:-}"

: "${TB21_DIR:?set TB21_DIR to a clone of harbor-framework/terminal-bench-2-1}"
if [ ! -d "$TB21_DIR/tasks" ]; then
  echo "TB21_DIR=$TB21_DIR has no tasks/ subdirectory" >&2
  exit 2
fi

# The 2.1 tasks reach Harbor ONLY through -p. Resolving them by dataset name
# would pull `terminal-bench-core`, a DIFFERENT and partly contaminated
# benchmark that runs cleanly and produces a plausible, wrong number.
args=(run -p "$TB21_DIR/tasks" --env docker -o "$HERE/jobs" -y)

if [ "$AGENT" = "oracle" ]; then
  args+=(-a oracle --job-name "oracle-$(date +%Y%m%d-%H%M%S)")
else
  # The directory name has a hyphen, so it cannot be a Python package. Putting
  # it on PYTHONPATH lets Harbor import the module by bare name instead.
  #
  # PYTHONPATH is parsed by the WINDOWS python even under Git Bash, and its
  # separator there is ';' -- a ':' silently yields one unusable path and a
  # ModuleNotFoundError that looks like the agent is missing.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      HERE_NATIVE="$(cygpath -w "$HERE")"
      export PYTHONPATH="$HERE_NATIVE${PYTHONPATH:+;$PYTHONPATH}"
      ;;
    *)
      export PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}"
      ;;
  esac
  args+=(-a terransoul_agent:TerranSoulAgent --job-name "terransoul-$(date +%Y%m%d-%H%M%S)")
  [ -n "${TS_MODEL:-}" ] && args+=(-m "$TS_MODEL")
  args+=(--ak "mode=${TS_MODE:-max}")
fi

[ -n "$TASK" ]  && args+=(-i "$TASK")
[ -n "$LIMIT" ] && args+=(-l "$LIMIT")

echo "harbor ${args[*]}"
harbor "${args[@]}"
