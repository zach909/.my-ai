"""Browser backend that generates real text from a trained TinyGPT checkpoint.

Serves the terminal UI (interface/index.html) on http://127.0.0.1:7860 and,
on POST /api/chat, generates a multi-sentence reply by sampling from the model
whose core computation IS the elastic mesh (all-to-all connectivity, vale-gated
settle, MoE routing, quantum-interference QIL) when the checkpoint was trained
with --use-elastic-mesh. This replaces the earlier bridge that proxied to a
TypeScript pipeline whose output was a fixed intent-analysis template — the
words now come from the model, not a template.

Honest scope: this is a small model trained locally on CPU. It produces fluent
multi-sentence prose in the style of its training text, not factual answers or
original reasoning. No external APIs are used.

Run:
    python interface/server.py [--ckpt PATH] [--port 7860]
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import subprocess
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Optional

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The trained model + its inference helper live in the tinygpt package.
_TINYGPT = os.path.join(_ROOT, "tinygpt")
if _TINYGPT not in sys.path:
    sys.path.insert(0, _TINYGPT)

# Default to the elastic-mesh generator; fall back to the plain transformer if
# the mesh checkpoint hasn't been trained yet.
_DEFAULT_CKPTS = [
    os.path.join(_TINYGPT, "checkpoints_mesh_v2", "gpt_mesh_v2.pt"),
    os.path.join(_TINYGPT, "checkpoints_v2", "gpt_v2.pt"),
]

_generator = None  # lazily-loaded tinygpt.infer.Generator

# The TypeScript pipeline (all-to-all mesh, MoE, hyperdimensional, quantum
# interference, NeuroLang/extension builder, plugins) runs as a sibling backend;
# the dashboard's subsystem panels are proxied to it. Chat is NOT proxied — it
# is served by the trained model above.
_TS_PORT = 7861
_ts_process = None
# Subsystem endpoints proxied to the TS backend (everything except /api/chat and
# the model-status/health endpoints this server owns).
_PROXY_PATHS = {"/api/systems", "/api/neuri", "/api/neurons", "/api/plugins",
                "/api/thorns", "/api/train",
                "/api/extension/build", "/api/extension/list"}
# /api/systems is the dashboard's name for the TS backend's own /api/status.
_PROXY_REWRITE = {"/api/systems": "/api/status"}


def _start_ts_backend() -> None:
    """Spawn the compiled TS pipeline and wait for it to accept connections."""
    global _ts_process
    main_js = os.path.join(_ROOT, "dist", "interface", "main.js")
    if not os.path.exists(main_js):
        print("[server] dist/interface/main.js missing — run `npm run build`; "
              "subsystem panels will be unavailable.")
        return
    try:
        _ts_process = subprocess.Popen(
            ["node", main_js, "web", str(_TS_PORT)], cwd=_ROOT,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(30):
            time.sleep(0.5)
            try:
                c = http.client.HTTPConnection("localhost", _TS_PORT, timeout=1)
                c.request("GET", "/api/status")
                c.getresponse().read()
                c.close()
                print(f"[server] TS subsystem backend ready on :{_TS_PORT}")
                return
            except Exception:
                continue
        print("[server] TS backend did not come up in time; panels may be empty.")
    except Exception as e:
        print(f"[server] could not start TS backend: {e}")


def _proxy(method: str, path: str, body: Optional[bytes]) -> tuple[int, bytes]:
    """Forward a request to the TS backend; return (status, body)."""
    target = _PROXY_REWRITE.get(path, path)
    try:
        c = http.client.HTTPConnection("localhost", _TS_PORT, timeout=30)
        headers = {"Content-Type": "application/json"} if body else {}
        c.request(method, target, body, headers)
        resp = c.getresponse()
        data = resp.read()
        status = resp.status
        c.close()
        return status, data
    except Exception as e:
        return 503, json.dumps({"error": f"subsystem backend unavailable: {e}"}).encode()


def _resolve_ckpt(explicit: Optional[str]) -> Optional[str]:
    if explicit:
        return explicit if os.path.exists(explicit) else None
    for path in _DEFAULT_CKPTS:
        if os.path.exists(path):
            return path
    return None


def _load_generator(ckpt_path: str):
    global _generator
    from tinygpt.infer import load_generator
    print(f"[server] loading model: {os.path.relpath(ckpt_path, _ROOT)} ...")
    _generator = load_generator(ckpt_path, device="cpu")
    s = _generator.stats()
    core = "elastic-mesh" if s["use_elastic_mesh"] else "standard-transformer"
    print(f"[server] ready: {s['parameters']/1e6:.1f}M params, {core} core, "
          f"vocab {s['vocab_size']}")


class NeuroClaw(BaseHTTPRequestHandler):
    log_message = lambda self, fmt, *args: None

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html", ""):
            self._serve_file(os.path.join(os.path.dirname(__file__), "index.html"), "text/html")
        elif path == "/health":
            self._json({"status": "ok", "ts": time.time()})
        elif path in ("/api/status", "/api/model"):
            # The generator model this server owns (the thing that writes replies).
            if _generator is None:
                self._json({"running": False, "model": None})
                return
            s = _generator.stats()
            self._json({
                "running": True,
                "model": {
                    "core": "elastic-mesh" if s["use_elastic_mesh"] else "standard-transformer",
                    "parameters": s["parameters"],
                    "n_layer": s["n_layer"],
                    "n_embd": s["n_embd"],
                    "block_size": s["block_size"],
                    "vocab_size": s["vocab_size"],
                    "mesh_experts": s["mesh_num_experts"],
                    "mesh_neurons": s["mesh_n_neurons"],
                    "mesh_qubits": s["mesh_n_qubits"],
                },
            })
        elif path in _PROXY_PATHS:
            status, data = _proxy("GET", path, None)
            self._raw_json(status, data)
        else:
            self.send_error(404, "Not found")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except json.JSONDecodeError:
            self._json({"error": "invalid JSON"})
            return
        path = urllib.parse.urlparse(self.path).path
        if path in _PROXY_PATHS:
            status, data = _proxy("POST", path, json.dumps(body).encode())
            self._raw_json(status, data)
            return
        if path != "/api/chat":
            self.send_error(404, "Not found")
            return

        query = str(body.get("message", "")).strip()
        if not query:
            self._json({"error": "empty message"})
            return
        if _generator is None:
            self._json({"response": "(no model loaded — train a checkpoint first)",
                        "timestamp": int(time.time() * 1000)})
            return

        t0 = time.time()
        try:
            reply = _generator.generate(
                query, max_new_tokens=140, temperature=0.8, top_k=40,
                top_p=0.95, repetition_penalty=1.15, paragraph=True,
            ).strip()
        except Exception as e:  # generation must never take the server down
            self._json({"error": f"generation failed: {e}"})
            return
        if not reply:
            reply = "(the model produced no continuation for that prompt)"
        self._json({"response": reply, "ms": round((time.time() - t0) * 1000),
                    "timestamp": int(time.time() * 1000)})

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _serve_file(self, path: str, ctype: str) -> None:
        if not os.path.exists(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _json(self, data: Any) -> None:
        payload = json.dumps(data, ensure_ascii=False, default=str).encode()
        self._raw_json(200, payload)

    def _raw_json(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self) -> None:
        # Security: restricted CORS; the AI endpoint stays localhost-only.
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def run(host: str = "127.0.0.1", port: int = 7860, ckpt: Optional[str] = None) -> None:
    ckpt_path = _resolve_ckpt(ckpt)
    if ckpt_path is None:
        looked = ckpt or " or ".join(os.path.relpath(p, _ROOT) for p in _DEFAULT_CKPTS)
        print(f"[server] no checkpoint found ({looked}).")
        print("[server] train one first, e.g.:")
        print("    cd tinygpt && python3 build_corpus.py && "
              "python3 train_tokenizer.py --data-dir data/pretrain --vocab-size 8000 "
              "--model-prefix checkpoints_v2/spm")
        print("    python3 pretrain.py --use-elastic-mesh --tokenizer checkpoints_v2/spm.model "
              "... --out-dir checkpoints_mesh_v2 --ckpt-name gpt_mesh_v2.pt")
        sys.exit(1)
    _load_generator(ckpt_path)
    _start_ts_backend()
    server = HTTPServer((host, port), NeuroClaw)
    print(f"Neuroclaw ready on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nNeuroclaw shutdown")
    finally:
        if _ts_process is not None:
            _ts_process.terminate()


def parse_args():
    ap = argparse.ArgumentParser(description="Neuroclaw browser backend (real generation).")
    ap.add_argument("--ckpt", default=None,
                    help="Checkpoint to serve (default: mesh_v2, then v2 transformer)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7860)
    return ap.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(host=args.host, port=args.port, ckpt=args.ckpt)
