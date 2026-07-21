#!/bin/bash
# JARVUS PRO: Complete Robot Generation Pipeline Runner
# Flow: Gender Select -> Jarvus AI -> MakeHuman 3D -> Z-Anatomy -> Simulation -> STL Zip

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  JARVUS PRO PIPELINE RUNNER"
echo "=========================================="

# Activate virtualenv if it exists
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

# Run the pipeline
python3 -m pipeline.jarvus_pro_pipeline "$@"
