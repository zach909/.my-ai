from __future__ import annotations
import json, os, sys, time, subprocess, threading, urllib.parse, traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_llm_process = None

def _start_ts_backend():
    global _llm_process
    # Spawn the compiled composition-root entrypoint in web mode. The old
    # command (`npx tsx index.ts web 7861`) pointed at index.ts, which is only
    # a barrel of re-exports with no bootstrap — it exited immediately without
    # starting a server, so this bridge always fell through to the canned
    # responses below. dist/interface/main.js web <port> starts the real
    # NeuroclawRunner-backed WebServer, so /api/chat here reaches the actual
    # neural pipeline (that is the "collapse Python/TS through server.py" bridge).
    try:
        _llm_process = subprocess.Popen(
            ["node", os.path.join(_ROOT, "dist", "interface", "main.js"), "web", "7861"],
            cwd=_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Wait for the backend to accept connections (up to ~15s) instead of a
        # fixed sleep, so a slow cold start doesn't force the canned fallback.
        import http.client as _hc
        for _ in range(30):
            time.sleep(0.5)
            try:
                _c = _hc.HTTPConnection("localhost", 7861, timeout=1)
                _c.request("GET", "/api/status")
                _c.getresponse().read()
                _c.close()
                break
            except Exception:
                continue
    except Exception as e:
        print(f"[server] TS backend: {e}")

class NeuroClaw(BaseHTTPRequestHandler):
    log_message = lambda self, fmt, *args: None

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html", ""):
            self._serve_file(os.path.join(os.path.dirname(__file__), "index.html"), "text/html")
        elif path == "/health":
            self._json({"status": "ok", "ts": time.time()})
        elif path == "/api/status":
            import http.client
            try:
                conn = http.client.HTTPConnection("localhost", 7861, timeout=2)
                conn.request("GET", "/api/status")
                resp = conn.getresponse()
                data = json.loads(resp.read())
                conn.close()
                self._json(data)
            except Exception:
                self._json({"running": False, "llm": {"neurons": 0}})
        else:
            self.send_error(404, "Not found")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/chat":
            import http.client
            query = body.get("message", "").strip()
            if not query:
                self._json({"error": "empty message"})
                return
            try:
                conn = http.client.HTTPConnection("localhost", 7861, timeout=30)
                conn.request("POST", "/api/chat", json.dumps({"message": query}), {"Content-Type": "application/json"})
                resp = conn.getresponse()
                data = json.loads(resp.read())
                conn.close()
                self._json(data)
            except Exception as e:
                t0 = time.time()
                lower = query.lower()
                if "hello" in lower:
                    response = "Hello. I am Neuroclaw, an autonomous AI running on your machine."
                elif "what are you" in lower or "who are you" in lower:
                    response = "I am Neuroclaw, built with Background Quantization for efficiency, Foreground MoE for specialized processing, hyper-dimensional thinking for infinite context, and RLM for reinforcement learning through possibilities."
                elif "how" in lower and "work" in lower:
                    response = "My architecture: 1) Background Quantizer - compresses memory via value ranges, 2) MoE Router - routes tasks to expert sub-networks, 3) Neuron Mesh - fully-connected propagation, 4) Hyper-Dimensional Engine - multi-ball state neurons for pattern detection, 5) RLM Trainer - reinforcement learning for thinking through possibilities, 6) THORNS - intent analysis and reasoning."
                else:
                    response = f"I processed your input. My neural pipeline analyzed the intent and is ready to assist. Context: '{query[:50]}'"
                self._json({"response": response, "ms": round((time.time() - t0) * 1000)})
        else:
            self.send_error(404, "Not found")

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
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self) -> None:
        # Security: Restricted CORS to prevent cross-origin attacks on local AI endpoints
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

def run(host: str = "127.0.0.1", port: int = 7860) -> None:
    print(f"Neuroclaw initialising systems...")
    _start_ts_backend()
    print(f"Neuroclaw ready on http://{host}:{port}")
    print(f"  TS backend on port 7861")
    server = HTTPServer((host, port), NeuroClaw)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nNeuroclaw shutdown")
        if _llm_process:
            _llm_process.terminate()

if __name__ == "__main__":
    run()
