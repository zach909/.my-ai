# AGENTS.md

## Building & testing

This directory is the Python core (`tinygpt/`): the trainable all-to-all
neuron mesh, tokenizer, pretrain/finetune loops, and the unified `core.py`
CLI with the alignment veto, empathy engine, and reasoning ledger wired in.
No external APIs.

```sh
pip install -r requirements.txt
python build_corpus.py                  # build a local corpus (no downloads)
python train_tokenizer.py --vocab-size 8000
python pretrain.py --device cuda        # trains the mesh -> checkpoints/gpt.pt
python core.py --ckpt checkpoints/gpt.pt --candidates 5   # talk to it

python test_core.py                     # full unit/smoke suite (198 checks)
python test_elastic_mesh.py             # mesh + expert-core smoke checks
python main.py demo                     # end-to-end integration demo (test_integration.py):
                                         # proves NeuroLang, elastic values,
                                         # extension save/install, live
                                         # plugin/skill building, a real
                                         # core.py session, the browser
                                         # backend, and the Python<->TS
                                         # bridge all work as ONE system
```

The repo root `README.md` documents the other two layers (the TypeScript
runtime backend and the React web UI) and how this Python core connects to
them via `interface/server.py`.
