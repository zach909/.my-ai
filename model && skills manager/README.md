<<<<<<< HEAD
# Prometheus Elastic Core — mesh AI

<<<<<<<< HEAD:model && skills manager/README.md
> **Note:** the decoder-only GPT transformer described below has been **retired**.
> The model is now the **all-to-all neuron mesh** (`tinygpt/mesh.py`, §1), which
> the same training/inference infrastructure trains unchanged (`build_model()`
> returns the mesh; `arch` defaults to `"mesh"`). See the repository root
> `README.md` for the nine mechanisms and honest limitations. The
> tokenizer / data loader / AdamW loop / sampling below all still apply; only the
> core computation block changed from attention to the mesh.
========
A complete, from-scratch **decoder-only GPT** language model in Python + PyTorch
— no Hugging Face Transformers, no Lightning, no distributed training. It trains
a small (a few hundred K to a few M parameter) model on a local Markdown corpus
and runs on CPU or a single consumer GPU.

It also ships an **experimental elastic-mesh model core** (Prometheus Elastic
Core, Section 5.2): the standard position-wise MLP sublayer can be swapped for a
vale-gated, all-to-all, MoE-routed block whose interference step is a *perfect
classical simulation* of a small variational quantum circuit (via PennyLane's
statevector simulator). Attention is unchanged; only the feed-forward core is
swapped, so the two can be compared apples-to-apples through the same training
loop.
>>>>>>>> origin/main:tinygpt/README.md

No Hugging Face Transformers, no Lightning, no distributed training. Runs locally
on a single consumer GPU (e.g. an RTX 5070); `python test_core.py` runs 52 checks
with no checkpoint needed.

## Infrastructure (applies to the mesh unchanged)

- **SentencePiece tokenizer** with training, save/load, encode/decode (BPE).
- **Markdown dataset loader** with train/validation split and packed token blocks.
<<<<<<<< HEAD:model && skills manager/README.md
- **The mesh** (retired transformer detail follows for reference): token + positional embeddings, pre-LayerNorm
  blocks, causal multi-head self-attention (fused FlashAttention when available,
  explicit masked fallback otherwise), GELU MLP, weight-tied LM head.
- **Configurable hyperparameters** via `tinygpt/config.py` and CLI flags.
========
- **GPT transformer built by hand**: token + positional embeddings, pre-LayerNorm
  blocks, causal multi-head self-attention (fused when available, masked fallback
  otherwise), GELU MLP, weight-tied LM head.
- **Elastic-mesh core** (`--use-elastic-mesh`): vale-gated settle dynamics,
  dense all-to-all internal connectivity, MoE expert routing, and a
  PennyLane-simulated quantum interference layer, as a drop-in for the MLP.
>>>>>>>> origin/main:tinygpt/README.md
- **Pretraining** with AdamW, linear-warmup + cosine LR decay, automatic mixed
  precision (on CUDA), gradient accumulation, gradient clipping, checkpoints.
- **Overfitting mitigation**: dropout, decoupled weight decay, early stopping.
- **Supervised fine-tuning** on chat JSON/JSONL with assistant-only loss masking.
- **CLI chat inference** with temperature, top-k, top-p, and repetition penalty.

## Layout

```
tinygpt/
├── tinygpt/                # library package (the only implementation)
│   ├── config.py           # ModelConfig / TrainConfig / TokenizerConfig
│   ├── tokenizer.py        # SentencePiece wrapper (train / encode / decode)
│   ├── data.py             # pretrain stream + chat SFT dataset (loss masking)
│   ├── model.py            # GPT transformer from scratch
│   ├── elastic_mesh.py     # Section 5.2 elastic-mesh core (quantum-simulated QIL)
│   ├── sampling.py         # temperature / top-k / top-p / repetition penalty
│   └── utils.py            # seeding, device, LR schedule, checkpoint I/O
├── train_tokenizer.py      # step 1: train the tokenizer
├── pretrain.py             # step 2: pretrain on Markdown (--use-elastic-mesh optional)
├── finetune.py             # step 3: supervised fine-tune on chat data
├── chat.py                 # step 4: interactive / one-shot inference (the interface)
├── test_elastic_mesh.py    # smoke test for the elastic-mesh core
├── data/pretrain/          # .md corpus (build your own; see below)
├── data/sft/chat.jsonl     # chat fine-tuning data (sample included)
└── requirements.txt
```

## Install

```bash
cd tinygpt
pip install -r requirements.txt
```

## Quickstart

```bash
# 0) Build a prose-heavy corpus from in-repo text (Shakespeare + War and Peace
#    test fixtures + repo docs; ~1.5M words). No external downloads.
python build_corpus.py

# 1) Train the tokenizer on the corpus
python train_tokenizer.py --data-dir data/pretrain --vocab-size 8000 \
    --model-prefix checkpoints_v2/spm

# 2) Pretrain the standard transformer
python pretrain.py --data-dir data/pretrain --tokenizer checkpoints_v2/spm.model \
    --n-layer 6 --n-head 6 --n-embd 384 --block-size 256 --dropout 0.1 \
    --batch-size 16 --grad-accum-steps 4 --max-steps 4000 \
    --early-stopping-patience 8 \
    --out-dir checkpoints_v2 --ckpt-name gpt_v2.pt --device cpu --no-amp

# 3) Chat with the trained binary checkpoint (the interface)
python chat.py --ckpt checkpoints_v2/gpt_v2.pt --chat --device cpu
```

The prose corpus matters far more than model size for fluency: on CPU this
~14M-param model reaches recognizable dramatic English — character speech tags
and stage directions — within ~1500 steps, where an earlier 2.2M-param model on
82K words of terse Markdown only produced disconnected keywords. A smaller/faster
smoke config (`--vocab-size 2000`, `--n-layer 4 --n-head 4 --n-embd 192
--block-size 128 --max-steps 2500`, default `checkpoints/`) still works for a
quick end-to-end check.

To train the experimental elastic-mesh core instead, add `--use-elastic-mesh`
to the `pretrain.py` command (optionally `--mesh-num-experts`, `--mesh-top-k`,
`--mesh-n-neurons`, `--mesh-settle-steps`, `--mesh-n-qubits`). Everything else —
tokenizer, data loading, optimizer, schedule, checkpointing, and inference
sampling — is identical, which is the point: it isolates the model core as the
only variable when comparing the two.

<<<<<<<< HEAD:model && skills manager/README.md
## Unified core (`core.py`)

`core.py` runs the whole thing as **one system**: the real TinyGPT model as the
language engine, wrapped by the genuinely-applicable Prometheus mechanisms as
real, working layers.

```bash
python core.py --ckpt checkpoints/gpt_sft.pt --candidates 5
```

- **Zip-loop memory** (§2) — a persistent ring buffer of the conversation
  (`tinygpt/memory.py`), reloaded across restarts.
- **Predict-before-commit** (§11) — generates N candidate replies and commits
  the one the model is most confident in (`tinygpt/selection.py`).
- **Alignment veto** (§3) + **human-in-the-loop action layer** — the model may
  propose `ACTION: time | system_info | list_dir <p> | read_file <p>`; each is
  vetoed and must be **approved by you** before it runs (`tinygpt/veto.py`,
  `tinygpt/actions.py`). Read-only actions only by default; there is **no
  autonomous execution** — this is the safe basis for computer control, not
  unattended control.
- **Terminal / gnome control** — pass `--enable-shell` to register an
  `ACTION: terminal <command>` action (covers gnome/desktop via
  `gsettings`/`wmctrl`/`xdotool`). It is **off by default** and **always
  requires your explicit confirmation** before running anything.
- **Live guidance** (§7) — `tinygpt/live_guide.py` steers generation *while it
  runs*: when the model drifts into sustained low confidence, sampling tightens
  (lower temperature, tighter nucleus) to pull it back on track instead of
  stopping. A tolerance band means a single noisy token doesn't over-correct.
  On by default; `--no-guide` to disable.
- **Idle power-save** (the kill switch) — when there's nothing to do, the core
  releases GPU memory to save power and wakes instantly on the next input
  (`--idle-timeout`, default 120s; type `sleep` to trigger now). It only stops
  to save power when idle — never on drift.

- **Mixture-of-Experts / skills** (§1.5) — enable `--use-moe` to replace each
  block's MLP with a sparse MoE of named experts ("skills") routed top-k
  (`tinygpt/moe.py`), with a load-balancing auxiliary loss and per-skill usage
  tracking. Train with `python pretrain.py --use-moe --n-experts 8 --moe-top-k 2`.
- **Extension builder** (§4) — teach the model declarative *definishon*
  contracts (`tinygpt/extension_builder.py`): `when "X" then it must reply "Y"`,
  trained with a constraint loss plus a don't-forget weight penalty, with
  contradiction detection. Batch-teach with `extend.py`, or live in the core:
  `teach: <prompt> => <required reply>`.

Run the core's tests (no checkpoint needed) with:

```bash
python test_core.py
```

### Teaching the model new behaviour (extension builder)

```bash
# batch: teach a JSON list of contracts and save an extended model
python extend.py --ckpt checkpoints/gpt_sft.pt --contracts data/contracts.json \
    --out checkpoints/gpt_extended.pt

# live, inside the core chat:
#   you> teach: who are you? => I am TinyGPT.
# the model trains on the contract, saves, and now answers that way.
```

A contract holds when the model actually produces the required continuation
(verified by greedy generation). Contradictory contracts (same prompt, different
required replies) are detected and reported instead of looping forever.

## Model size
========
## Checkpoints are self-describing binaries
>>>>>>>> origin/main:tinygpt/README.md

Each `.pt` checkpoint stores the full `ModelConfig`, so `chat.py` and
`finetune.py` reconstruct the exact architecture (standard *or* elastic-mesh)
automatically — you only pass the `.pt` path.

## Notes

- Use `--device cpu --no-amp` on CPU; `--device cuda --dtype bfloat16` on a
  recent GPU.
- A small model produces fluent, on-topic text after enough training, not
  factual accuracy or reasoning at the level of large models. This is an
  educational / research implementation.
- The elastic-mesh core is experimental and unproven — it is meant to be tested
  against the standard transformer baseline, not assumed superior to it.
=======
<p align="center">
  <a href="https://ollama.com">
    <img src="https://github.com/ollama/ollama/assets/3325447/0d0b44e2-8f4a-4e99-9b52-a5c1c741c8f7" alt="ollama" width="200"/>
  </a>
</p>

# Ollama

Start building with open models.

## Download

### macOS

```shell
curl -fsSL https://ollama.com/install.sh | sh
```

or [download manually](https://ollama.com/download/Ollama.dmg)

### Windows

```shell
irm https://ollama.com/install.ps1 | iex
```

or [download manually](https://ollama.com/download/OllamaSetup.exe)

### Linux

```shell
curl -fsSL https://ollama.com/install.sh | sh
```

[Manual install instructions](https://docs.ollama.com/linux#manual-install)

### Docker

The official [Ollama Docker image](https://hub.docker.com/r/ollama/ollama) `ollama/ollama` is available on Docker Hub.

### Libraries

- [ollama-python](https://github.com/ollama/ollama-python)
- [ollama-js](https://github.com/ollama/ollama-js)

### Community

- [Discord](https://discord.gg/ollama)
- [𝕏 (Twitter)](https://x.com/ollama)
- [Reddit](https://reddit.com/r/ollama)

## Get started

```
ollama
```

You'll be prompted to run a model or connect Ollama to your existing agents or applications such as `Claude Code`, `OpenClaw`, `OpenCode` , `Codex`, `Copilot`,  and more.

### Coding

To launch a specific integration:

```
ollama launch claude
```

Supported integrations include [Claude Code](https://docs.ollama.com/integrations/claude-code), [Codex](https://docs.ollama.com/integrations/codex), [Copilot CLI](https://docs.ollama.com/integrations/copilot-cli), [Droid](https://docs.ollama.com/integrations/droid), and [OpenCode](https://docs.ollama.com/integrations/opencode).

### AI assistant

Use [OpenClaw](https://docs.ollama.com/integrations/openclaw) to turn Ollama into a personal AI assistant across WhatsApp, Telegram, Slack, Discord, and more:

```
ollama launch openclaw
```

### Chat with a model

Run and chat with [Gemma 4](https://ollama.com/library/gemma4):

```
ollama run gemma4
```

See [ollama.com/library](https://ollama.com/library) for the full list.

See the [quickstart guide](https://docs.ollama.com/quickstart) for more details.

## REST API

Ollama has a REST API for running and managing models.

```
curl http://localhost:11434/api/chat -d '{
  "model": "gemma4",
  "messages": [{
    "role": "user",
    "content": "Why is the sky blue?"
  }],
  "stream": false
}'
```

See the [API documentation](https://docs.ollama.com/api) for all endpoints.

### Python

```
pip install ollama
```

```python
from ollama import chat

response = chat(model='gemma4', messages=[
  {
    'role': 'user',
    'content': 'Why is the sky blue?',
  },
])
print(response.message.content)
```

### JavaScript

```
npm i ollama
```

```javascript
import ollama from "ollama";

const response = await ollama.chat({
  model: "gemma4",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
});
console.log(response.message.content);
```

## Supported backends

- [llama.cpp](https://github.com/ggml-org/llama.cpp) project founded by Georgi Gerganov.

## Documentation

- [CLI reference](https://docs.ollama.com/cli)
- [REST API reference](https://docs.ollama.com/api)
- [Importing models](https://docs.ollama.com/import)
- [Modelfile reference](https://docs.ollama.com/modelfile)
- [Building from source](https://github.com/ollama/ollama/blob/main/docs/development.md)

## Community Integrations

> Want to add your project? Open a pull request.

### Chat Interfaces

#### Web

- [Open WebUI](https://github.com/open-webui/open-webui) - Extensible, self-hosted AI interface
- [Onyx](https://github.com/onyx-dot-app/onyx) - Connected AI workspace
- [LibreChat](https://github.com/danny-avila/LibreChat) - Enhanced ChatGPT clone with multi-provider support
- [Lobe Chat](https://github.com/lobehub/lobe-chat) - Modern chat framework with plugin ecosystem ([docs](https://lobehub.com/docs/self-hosting/examples/ollama))
- [NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web) - Cross-platform ChatGPT UI ([docs](https://docs.nextchat.dev/models/ollama))
- [Perplexica](https://github.com/ItzCrazyKns/Perplexica) - AI-powered search engine, open-source Perplexity alternative
- [big-AGI](https://github.com/enricoros/big-AGI) - AI suite for professionals
- [Lollms WebUI](https://github.com/ParisNeo/lollms-webui) - Multi-model web interface
- [ChatOllama](https://github.com/sugarforever/chat-ollama) - Chatbot with knowledge bases
- [Bionic GPT](https://github.com/bionic-gpt/bionic-gpt) - On-premise AI platform
- [Chatbot UI](https://github.com/ivanfioravanti/chatbot-ollama) - ChatGPT-style web interface
- [Hollama](https://github.com/fmaclen/hollama) - Minimal web interface
- [Chatbox](https://github.com/Bin-Huang/Chatbox) - Desktop and web AI client
- [chat](https://github.com/swuecho/chat) - Chat web app for teams
- [Ollama RAG Chatbot](https://github.com/datvodinh/rag-chatbot.git) - Chat with multiple PDFs using RAG
- [Tkinter-based client](https://github.com/chyok/ollama-gui) - Python desktop client

#### Desktop

- [Dify.AI](https://github.com/langgenius/dify) - LLM app development platform
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) - All-in-one AI app for Mac, Windows, and Linux
- [Maid](https://github.com/Mobile-Artificial-Intelligence/maid) - Cross-platform mobile and desktop client
- [Witsy](https://github.com/nbonamy/witsy) - AI desktop app for Mac, Windows, and Linux
- [Cherry Studio](https://github.com/kangfenmao/cherry-studio) - Multi-provider desktop client
- [Ollama App](https://github.com/JHubi1/ollama-app) - Multi-platform client for desktop and mobile
- [PyGPT](https://github.com/szczyglis-dev/py-gpt) - AI desktop assistant for Linux, Windows, and Mac
- [Alpaca](https://github.com/Jeffser/Alpaca) - GTK4 client for Linux and macOS
- [SwiftChat](https://github.com/aws-samples/swift-chat) - Cross-platform including iOS, Android, and Apple Vision Pro
- [Enchanted](https://github.com/AugustDev/enchanted) - Native macOS and iOS client
- [RWKV-Runner](https://github.com/josStorer/RWKV-Runner) - Multi-model desktop runner
- [Ollama Grid Search](https://github.com/dezoito/ollama-grid-search) - Evaluate and compare models
- [macai](https://github.com/Renset/macai) - macOS client for Ollama and ChatGPT
- [AI Studio](https://github.com/MindWorkAI/AI-Studio) - Multi-provider desktop IDE
- [Reins](https://github.com/ibrahimcetin/reins) - Parameter tuning and reasoning model support
- [ConfiChat](https://github.com/1runeberg/confichat) - Privacy-focused with optional encryption
- [LLocal.in](https://github.com/kartikm7/llocal) - Electron desktop client
- [MindMac](https://mindmac.app) - AI chat client for Mac
- [Msty](https://msty.app) - Multi-model desktop client
- [BoltAI for Mac](https://boltai.com) - AI chat client for Mac
- [IntelliBar](https://intellibar.app/) - AI-powered assistant for macOS
- [Kerlig AI](https://www.kerlig.com/) - AI writing assistant for macOS
- [Hillnote](https://hillnote.com) - Markdown-first AI workspace
- [Perfect Memory AI](https://www.perfectmemory.ai/) - Productivity AI personalized by screen and meeting history

#### Mobile

- [Ollama Android Chat](https://github.com/sunshine0523/OllamaServer) - One-click Ollama on Android

> SwiftChat, Enchanted, Maid, Ollama App, Reins, and ConfiChat listed above also support mobile platforms.

### Code Editors & Development

- [Cline](https://github.com/cline/cline) - VS Code extension for multi-file/whole-repo coding
- [Continue](https://github.com/continuedev/continue) - Open-source AI code assistant for any IDE
- [Void](https://github.com/voideditor/void) - Open source AI code editor, Cursor alternative
- [Copilot for Obsidian](https://github.com/logancyang/obsidian-copilot) - AI assistant for Obsidian
- [twinny](https://github.com/rjmacarthy/twinny) - Copilot and Copilot chat alternative
- [gptel Emacs client](https://github.com/karthink/gptel) - LLM client for Emacs
- [Ollama Copilot](https://github.com/bernardo-bruning/ollama-copilot) - Use Ollama as GitHub Copilot
- [Obsidian Local GPT](https://github.com/pfrankov/obsidian-local-gpt) - Local AI for Obsidian
- [Ellama Emacs client](https://github.com/s-kostyaev/ellama) - LLM tool for Emacs
- [orbiton](https://github.com/xyproto/orbiton) - Config-free text editor with Ollama tab completion
- [AI ST Completion](https://github.com/yaroslavyaroslav/OpenAI-sublime-text) - Sublime Text 4 AI assistant
- [VT Code](https://github.com/vinhnx/vtcode) - Rust-based terminal coding agent with Tree-sitter
- [QodeAssist](https://github.com/Palm1r/QodeAssist) - AI coding assistant for Qt Creator
- [AI Toolkit for VS Code](https://aka.ms/ai-tooklit/ollama-docs) - Microsoft-official VS Code extension
- [Open Interpreter](https://docs.openinterpreter.com/language-model-setup/local-models/ollama) - Natural language interface for computers

### Libraries & SDKs

- [LiteLLM](https://github.com/BerriAI/litellm) - Unified API for 100+ LLM providers
- [Semantic Kernel](https://github.com/microsoft/semantic-kernel/tree/main/python/semantic_kernel/connectors/ai/ollama) - Microsoft AI orchestration SDK
- [LangChain4j](https://github.com/langchain4j/langchain4j) - Java LangChain ([example](https://github.com/langchain4j/langchain4j-examples/tree/main/ollama-examples/src/main/java))
- [LangChainGo](https://github.com/tmc/langchaingo/) - Go LangChain ([example](https://github.com/tmc/langchaingo/tree/main/examples/ollama-completion-example))
- [Spring AI](https://github.com/spring-projects/spring-ai) - Spring framework AI support ([docs](https://docs.spring.io/spring-ai/reference/api/chat/ollama-chat.html))
- [LangChain](https://python.langchain.com/docs/integrations/chat/ollama/) and [LangChain.js](https://js.langchain.com/docs/integrations/chat/ollama/) with [example](https://js.langchain.com/docs/tutorials/local_rag/)
- [Ollama for Ruby](https://github.com/crmne/ruby_llm) - Ruby LLM library
- [any-llm](https://github.com/mozilla-ai/any-llm) - Unified LLM interface by Mozilla
- [OllamaSharp for .NET](https://github.com/awaescher/OllamaSharp) - .NET SDK
- [LangChainRust](https://github.com/Abraxas-365/langchain-rust) - Rust LangChain ([example](https://github.com/Abraxas-365/langchain-rust/blob/main/examples/llm_ollama.rs))
- [Agents-Flex for Java](https://github.com/agents-flex/agents-flex) - Java agent framework ([example](https://github.com/agents-flex/agents-flex/tree/main/agents-flex-llm/agents-flex-llm-ollama/src/test/java/com/agentsflex/llm/ollama))
- [Elixir LangChain](https://github.com/brainlid/langchain) - Elixir LangChain
- [Ollama-rs for Rust](https://github.com/pepperoni21/ollama-rs) - Rust SDK
- [LangChain for .NET](https://github.com/tryAGI/LangChain) - .NET LangChain ([example](https://github.com/tryAGI/LangChain/blob/main/examples/LangChain.Samples.OpenAI/Program.cs))
- [chromem-go](https://github.com/philippgille/chromem-go) - Go vector database with Ollama embeddings ([example](https://github.com/philippgille/chromem-go/tree/v0.5.0/examples/rag-wikipedia-ollama))
- [LangChainDart](https://github.com/davidmigloz/langchain_dart) - Dart LangChain
- [LlmTornado](https://github.com/lofcz/llmtornado) - Unified C# interface for multiple inference APIs
- [Ollama4j for Java](https://github.com/ollama4j/ollama4j) - Java SDK
- [Ollama for Laravel](https://github.com/cloudstudio/ollama-laravel) - Laravel integration
- [Ollama for Swift](https://github.com/mattt/ollama-swift) - Swift SDK
- [LlamaIndex](https://docs.llamaindex.ai/en/stable/examples/llm/ollama/) and [LlamaIndexTS](https://ts.llamaindex.ai/modules/llms/available_llms/ollama) - Data framework for LLM apps
- [Haystack](https://github.com/deepset-ai/haystack-integrations/blob/main/integrations/ollama.md) - AI pipeline framework
- [Firebase Genkit](https://firebase.google.com/docs/genkit/plugins/ollama) - Google AI framework
- [Ollama-hpp for C++](https://github.com/jmont-dev/ollama-hpp) - C++ SDK
- [PromptingTools.jl](https://github.com/svilupp/PromptingTools.jl) - Julia LLM toolkit ([example](https://svilupp.github.io/PromptingTools.jl/dev/examples/working_with_ollama))
- [Ollama for R - rollama](https://github.com/JBGruber/rollama) - R SDK
- [Portkey](https://portkey.ai/docs/welcome/integration-guides/ollama) - AI gateway
- [Testcontainers](https://testcontainers.com/modules/ollama/) - Container-based testing
- [LLPhant](https://github.com/theodo-group/LLPhant?tab=readme-ov-file#ollama) - PHP AI framework

### Frameworks & Agents

- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT/blob/master/docs/content/platform/ollama.md) - Autonomous AI agent platform
- [crewAI](https://github.com/crewAIInc/crewAI) - Multi-agent orchestration framework
- [Strands Agents](https://github.com/strands-agents/sdk-python) - Model-driven agent building by AWS
- [Cheshire Cat](https://github.com/cheshire-cat-ai/core) - AI assistant framework
- [any-agent](https://github.com/mozilla-ai/any-agent) - Unified agent framework interface by Mozilla
- [Stakpak](https://github.com/stakpak/agent) - Open source DevOps agent
- [Hexabot](https://github.com/hexastack/hexabot) - Conversational AI builder
- [Neuro SAN](https://github.com/cognizant-ai-lab/neuro-san-studio) - Multi-agent orchestration ([docs](https://github.com/cognizant-ai-lab/neuro-san-studio/blob/main/docs/user_guide.md#ollama))

### RAG & Knowledge Bases

- [RAGFlow](https://github.com/infiniflow/ragflow) - RAG engine based on deep document understanding
- [R2R](https://github.com/SciPhi-AI/R2R) - Open-source RAG engine
- [MaxKB](https://github.com/1Panel-dev/MaxKB/) - Ready-to-use RAG chatbot
- [Minima](https://github.com/dmayboroda/minima) - On-premises or fully local RAG
- [Chipper](https://github.com/TilmanGriesel/chipper) - AI interface with Haystack RAG
- [ARGO](https://github.com/xark-argo/argo) - RAG and deep research on Mac/Windows/Linux
- [Archyve](https://github.com/nickthecook/archyve) - RAG-enabling document library
- [Casibase](https://casibase.org) - AI knowledge base with RAG and SSO
- [BrainSoup](https://www.nurgo-software.com/products/brainsoup) - Native client with RAG and multi-agent automation

### Bots & Messaging

- [LangBot](https://github.com/RockChinQ/LangBot) - Multi-platform messaging bots with agents and RAG
- [AstrBot](https://github.com/Soulter/AstrBot/) - Multi-platform chatbot with RAG and plugins
- [Discord-Ollama Chat Bot](https://github.com/kevinthedang/discord-ollama) - TypeScript Discord bot
- [Ollama Telegram Bot](https://github.com/ruecat/ollama-telegram) - Telegram bot
- [LLM Telegram Bot](https://github.com/innightwolfsleep/llm_telegram_bot) - Telegram bot for roleplay

### Terminal & CLI

- [aichat](https://github.com/sigoden/aichat) - All-in-one LLM CLI with Shell Assistant, RAG, and AI tools
- [oterm](https://github.com/ggozad/oterm) - Terminal client for Ollama
- [gollama](https://github.com/sammcj/gollama) - Go-based model manager for Ollama
- [tlm](https://github.com/yusufcanb/tlm) - Local shell copilot
- [tenere](https://github.com/pythops/tenere) - TUI for LLMs
- [ParLlama](https://github.com/paulrobello/parllama) - TUI for Ollama
- [llm-ollama](https://github.com/taketwo/llm-ollama) - Plugin for [Datasette's LLM CLI](https://llm.datasette.io/en/stable/)
- [ShellOracle](https://github.com/djcopley/ShellOracle) - Shell command suggestions
- [LLM-X](https://github.com/mrdjohnson/llm-x) - Progressive web app for LLMs
- [cmdh](https://github.com/pgibler/cmdh) - Natural language to shell commands
- [VT](https://github.com/vinhnx/vt.ai) - Minimal multimodal AI chat app

### Productivity & Apps

- [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) - AI collaborative workspace, self-hostable Notion alternative
- [Screenpipe](https://github.com/mediar-ai/screenpipe) - 24/7 screen and mic recording with AI-powered search
- [Vibe](https://github.com/thewh1teagle/vibe) - Transcribe and analyze meetings
- [Page Assist](https://github.com/n4ze3m/page-assist) - Chrome extension for AI-powered browsing
- [NativeMind](https://github.com/NativeMindBrowser/NativeMindExtension) - Private, on-device browser AI assistant
- [Ollama Fortress](https://github.com/ParisNeo/ollama_proxy_server) - Security proxy for Ollama
- [1Panel](https://github.com/1Panel-dev/1Panel/) - Web-based Linux server management
- [Writeopia](https://github.com/Writeopia/Writeopia) - Text editor with Ollama integration
- [QA-Pilot](https://github.com/reid41/QA-Pilot) - GitHub code repository understanding
- [Raycast extension](https://github.com/MassimilianoPasquini97/raycast_ollama) - Ollama in Raycast
- [Painting Droid](https://github.com/mateuszmigas/painting-droid) - Painting app with AI integrations
- [Serene Pub](https://github.com/doolijb/serene-pub) - AI roleplaying app
- [Mayan EDMS](https://gitlab.com/mayan-edms/mayan-edms) - Document management with Ollama workflows
- [TagSpaces](https://www.tagspaces.org) - File management with [AI tagging](https://docs.tagspaces.org/ai/)

### Observability & Monitoring

- [Opik](https://www.comet.com/docs/opik/cookbook/ollama) - Debug, evaluate, and monitor LLM applications
- [OpenLIT](https://github.com/openlit/openlit) - OpenTelemetry-native monitoring for Ollama and GPUs
- [Lunary](https://lunary.ai/docs/integrations/ollama) - LLM observability with analytics and PII masking
- [Langfuse](https://langfuse.com/docs/integrations/ollama) - Open source LLM observability
- [HoneyHive](https://docs.honeyhive.ai/integrations/ollama) - AI observability and evaluation for agents
- [MLflow Tracing](https://mlflow.org/docs/latest/llms/tracing/index.html#automatic-tracing) - Open source LLM observability

### Database & Embeddings

- [pgai](https://github.com/timescale/pgai) - PostgreSQL as a vector database ([guide](https://github.com/timescale/pgai/blob/main/docs/vectorizer-quick-start.md))
- [MindsDB](https://github.com/mindsdb/mindsdb/blob/staging/mindsdb/integrations/handlers/ollama_handler/README.md) - Connect Ollama with 200+ data platforms
- [chromem-go](https://github.com/philippgille/chromem-go/blob/v0.5.0/embed_ollama.go) - Embeddable vector database for Go ([example](https://github.com/philippgille/chromem-go/tree/v0.5.0/examples/rag-wikipedia-ollama))
- [Kangaroo](https://github.com/dbkangaroo/kangaroo) - AI-powered SQL client

### Infrastructure & Deployment

#### Cloud

- [Google Cloud](https://cloud.google.com/run/docs/tutorials/gpu-gemma2-with-ollama)
- [Fly.io](https://fly.io/docs/python/do-more/add-ollama/)
- [Koyeb](https://www.koyeb.com/deploy/ollama)
- [Harbor](https://github.com/av/harbor) - Containerized LLM toolkit with Ollama as default backend

#### Package Managers

- [Pacman](https://archlinux.org/packages/extra/x86_64/ollama/)
- [Homebrew](https://formulae.brew.sh/formula/ollama)
- [Nix package](https://search.nixos.org/packages?show=ollama&from=0&size=50&sort=relevance&type=packages&query=ollama)
- [Helm Chart](https://artifacthub.io/packages/helm/ollama-helm/ollama)
- [Gentoo](https://github.com/gentoo/guru/tree/master/app-misc/ollama)
- [Flox](https://flox.dev/blog/ollama-part-one)
- [Guix channel](https://codeberg.org/tusharhero/ollama-guix)
>>>>>>> origin/main
