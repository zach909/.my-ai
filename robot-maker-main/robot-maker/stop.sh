#!/usr/bin/env bash
# Stop Robot Maker
kill $(cat /tmp/robot-maker.pid 2>/dev/null) 2>/dev/null || pkill -f "node.*robot-maker/server.js" 2>/dev/null
echo "Stopped."
