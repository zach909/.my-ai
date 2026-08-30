#!/usr/bin/env bash
# Robot Builder browser interface.
#   ./run_app.sh                 # http://127.0.0.1:7860
#   ROBOT_PORT=8000 ./run_app.sh
#   ROBOT_SHARE=1 ./run_app.sh   # public gradio share link
set -euo pipefail
cd "$(dirname "$0")"
exec ./.venv/bin/python -m pipeline.app
