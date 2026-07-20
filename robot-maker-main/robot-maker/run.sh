#!/usr/bin/env bash
# Robot Maker - Node.js + Three.js + DeepSeek-Janus-Pro-7B
set -euo pipefail
cd "$(dirname "$0")"
nohup node server.js > /tmp/robot-maker.log 2>&1 &
echo "Robot Maker running at http://localhost:3000"
echo "PID: $!"
echo "Logs: tail -f /tmp/robot-maker.log"
