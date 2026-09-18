#!/bin/bash
# NeuroClaw — Enable Conversation Training
#
# Opt-in installer for the one dependency the real "learns by talking to
# you" pipeline needs: PyTorch, used by extension-builder/pytorch_trainer.py
# for genuine torch.autograd gradient descent on the neurons that actually
# produce chat replies (see docs/CONVERSATION_TRAINING_LOG.md, Finding 2/3).
#
# requirements.txt deliberately ships with zero PyPI dependencies -- torch is
# roughly 2.5 GB installed, with a CUDA build to match your GPU, and forcing
# it on everyone for a mesh that mostly never calls it "would be the single
# largest cost in getting this running, paid by everyone, for nothing" (see
# requirements.txt's own header). This script is the other half of that
# trade-off: a single opt-in step for the people who do want it.
#
# What "enabling training" actually buys you: scripts/conversation-learning-agent.mjs
# already runs on its own every ~20 minutes whenever the server is running
# (disable with NEUROCLAW_CONVERSATION_LEARNING=0), reading every real turn
# you've had with NeuroClaw from the local, gitignored
# extension-builder/conversation-log.jsonl and training on it. Without torch
# installed, every cycle degrades honestly to "neurons kept as untrained
# definitions" and chat replies stay on the fixed fallback line. This script
# doesn't change that loop at all -- it just makes the one dependency it
# needs to actually converge available.

set -e

BLUE='\033[0;34m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

echo ""
echo -e "    ${BLUE}Enable Conversation Training${NC}"
echo -e "    ${GRAY}Installs PyTorch so real conversations can train OneBrain's chat replies${NC}"
echo ""

if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Please run this script from the Neuroclaw directory${NC}"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo -e "    ${RED}✗ Python 3 is not installed. Please install Python 3.11+ first.${NC}"
    exit 1
fi

if python3 -c "import torch" &> /dev/null; then
    TORCH_VERSION="$(python3 -c 'import torch; print(torch.__version__)')"
    echo -e "    ${GREEN}✓ PyTorch is already installed (${TORCH_VERSION}) — nothing to do.${NC}"
    echo -e "    ${GRAY}→ The conversation-learning loop already trains with it as it runs.${NC}"
    echo ""
    exit 0
fi

echo -e "    ${YELLOW}This downloads PyTorch (~2.5 GB, CUDA build if you have a GPU).${NC}"
echo -e "    ${GRAY}→ Installing for python3: $(command -v python3)${NC}"
echo ""

if ! python3 -m pip install torch; then
    echo ""
    echo -e "    ${RED}✗ pip install torch failed.${NC}"
    echo -e "    ${GRAY}→ See https://pytorch.org/get-started/locally/ for a command matched${NC}"
    echo -e "    ${GRAY}  to your OS/GPU, then re-run this script.${NC}"
    exit 1
fi

if ! python3 -c "import torch" &> /dev/null; then
    echo -e "    ${RED}✗ torch installed but failed to import. Check the pip output above.${NC}"
    exit 1
fi

TORCH_VERSION="$(python3 -c 'import torch; print(torch.__version__)')"
echo ""
echo -e "    ${GREEN}✓ PyTorch ${TORCH_VERSION} installed.${NC}"
echo ""
echo -e "    ${CYAN}What happens next:${NC}"
echo -e "      ${BLUE}•${NC} If the server is already running, the next scheduled"
echo -e "        conversation-learning cycle (every ~20 min) will pick this up"
echo -e "        automatically -- no restart required."
echo -e "      ${BLUE}•${NC} To train on whatever real conversations are already logged"
echo -e "        right now instead of waiting: ${CYAN}node scripts/conversation-learning-agent.mjs --once${NC}"
echo -e "      ${BLUE}•${NC} Replies only actually improve once there's enough real"
echo -e "        conversation history to train on -- this makes training possible,"
echo -e "        it doesn't retroactively rewrite past replies."
echo ""
