#!/usr/bin/env python
"""Local browser chat backend for a trained TinyGPT checkpoint.

"Runs on your machine" (design notes): a plain stdlib HTTP server (no
external APIs, no third-party web framework) that serves a single-page chat
UI and answers it by loading the checkpoint through the exact same
`tinygpt.infer.Generator` that `chat.py` uses — the CLI and the browser
backend can never drift apart, because they share one code path.

Usage:
    python interface/server.py --ckpt checkpoints/gpt_sft.pt --port 8000

Then open http://127.0.0.1:8000/ in a browser. Everything happens on
localhost; nothing here opens an outbound connection.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional

# interface/ is one level below the tinygpt package; make sure the package
# root is importable regardless of how this script is invoked (`python
# interface/server.py`, `python3 server.py` from inside interface/, ...).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tinygpt.data import build_chat_prompt
from tinygpt.infer import Generator, load_generator

_INDEX_HTML = b"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TinyGPT</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e6e6e6; font-family: system-ui, sans-serif;
         height: 100vh; display: flex; flex-direction: column; }
  #header { padding: 10px 16px; border-bottom: 1px solid #2a2a2a; font-size: 13px;
            color: #888; display: flex; justify-content: space-between; }
  #chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 75%; padding: 8px 12px; border-radius: 6px; line-height: 1.45; font-size: 14px; }
  .user { align-self: flex-end; background: #1e3a5f; }
  .bot { align-self: flex-start; background: #1a1a1a; border: 1px solid #2a2a2a; }
  .err { align-self: center; color: #ff6b6b; font-size: 12px; }
  #bar { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #2a2a2a; }
  #in { flex: 1; background: #111; border: 1px solid #333; color: #eee; padding: 10px 12px;
        border-radius: 6px; font-size: 14px; }
  #send { background: #1e3a5f; color: #fff; border: none; padding: 10px 18px;
          border-radius: 6px; cursor: pointer; font-size: 14px; }
  #send:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<div id="header"><span>TinyGPT (local, no external APIs)</span><span id="status">loading...</span></div>
<div id="chat"></div>
<div id="bar">
  <input id="in" placeholder="Say something..." autofocus>
  <button id="send">Send</button>
</div>
<script>
  const chat = document.getElementById('chat');
  const input = document.getElementById('in');
  const send = document.getElementById('send');
  const status = document.getElementById('status');

  function addMsg(cls, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
    return d;
  }

  fetch('/api/status').then(r => r.json()).then(s => {
    status.textContent = `${s.parameters.toLocaleString()} params on ${s.device}`;
  }).catch(() => { status.textContent = 'offline'; });

  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send.disabled = true;
    addMsg('user', text);
    const thinking = addMsg('bot', '...');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: text}),
      });
      const data = await res.json();
      thinking.textContent = data.reply || '(empty reply)';
      if (data.error) { thinking.className = 'msg err'; thinking.textContent = data.error; }
    } catch (e) {
      thinking.className = 'msg err';
      thinking.textContent = 'request failed: ' + e;
    } finally {
      send.disabled = false;
      input.focus();
    }
  }
  send.onclick = submit;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
</script>
</body>
</html>
"""


class ChatSession:
    """One conversation's history, so /api/chat can build a proper multi-turn
    prompt the same way core.py's zip-loop memory / chat.py's history do."""

    def __init__(self, max_turns: int = 16):
        self.max_turns = max_turns
        self.history: List[Dict[str, str]] = []

    def add(self, role: str, content: str) -> None:
        self.history.append({"role": role, "content": content})
        if len(self.history) > self.max_turns:
            self.history = self.history[-self.max_turns:]


class ChatServer:
    """Owns the loaded model and a single shared conversation (this is a local,
    single-user tool — the design's "runs on your machine" — not a multi-tenant
    service, so one session is the right amount of state)."""

    def __init__(self, generator: Generator, gen_kwargs: dict):
        self.generator = generator
        self.gen_kwargs = gen_kwargs
        self.session = ChatSession()
        self.lock = threading.Lock()  # a single small model; serialize generation

    def status(self) -> dict:
        return self.generator.stats() | {"device": self.generator.device}

    def reset(self) -> None:
        with self.lock:
            self.session = ChatSession()

    def reply(self, message: str) -> str:
        with self.lock:
            self.session.add("user", message)
            prompt = build_chat_prompt(self.session.history, self.generator.tokenizer)
            prompt += "<|assistant|>\n"
            reply = self.generator.generate(prompt, paragraph=True, **self.gen_kwargs)
            self.session.add("assistant", reply)
            return reply


def _make_handler(server_state: ChatServer):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quieter default logging
            pass

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(_INDEX_HTML)))
                self.end_headers()
                self.wfile.write(_INDEX_HTML)
            elif self.path == "/api/status":
                self._json(200, server_state.status())
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "invalid JSON body"})
                return

            if self.path == "/api/chat":
                message = str(body.get("message", "")).strip()
                if not message:
                    self._json(400, {"error": "empty message"})
                    return
                try:
                    reply = server_state.reply(message)
                    self._json(200, {"reply": reply})
                except Exception as e:  # a bad generation must never crash the server
                    self._json(500, {"error": f"generation failed: {e}"})
            elif self.path == "/api/reset":
                server_state.reset()
                self._json(200, {"ok": True})
            else:
                self._json(404, {"error": "not found"})

    return Handler


def parse_args():
    ap = argparse.ArgumentParser(description="Local browser chat backend for TinyGPT.")
    ap.add_argument("--ckpt", default="checkpoints/gpt_sft.pt")
    ap.add_argument("--tokenizer", default=None)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--max-new-tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--repetition-penalty", type=float, default=1.1)
    return ap.parse_args()


def main():
    args = parse_args()
    generator = load_generator(args.ckpt, device=args.device, tokenizer_path=args.tokenizer)
    gen_kwargs = dict(
        max_new_tokens=args.max_new_tokens, temperature=args.temperature,
        top_k=args.top_k, top_p=args.top_p, repetition_penalty=args.repetition_penalty,
    )
    state = ChatServer(generator, gen_kwargs)
    httpd = ThreadingHTTPServer((args.host, args.port), _make_handler(state))
    print(f"TinyGPT browser backend on http://{args.host}:{args.port}/ "
         f"(model: {args.ckpt}, device: {generator.device})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
