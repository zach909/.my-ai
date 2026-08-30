#!/usr/bin/env bash
# Body-generation chain wrapper. Uses the project venv (agno, pillow, ollama).
#   ./run_chain.sh --sex m
#   ./run_chain.sh                 # interactive m/f prompt
#   ./run_chain.sh --sex f --model qwen2.5-coder:latest
set -euo pipefail
cd "$(dirname "$0")"
exec ./.venv/bin/python -m pipeline.chain "$@"
