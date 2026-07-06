from __future__ import annotations
import json, os, sys, time, subprocess, threading, urllib.parse, traceback, io
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PY_STACK = os.path.join(_ROOT, "model && skills manager")

_llm_process = None
_py_runtime = None   # lazy Python NeuroRuntime instance


def _get_py_runtime():
    """Lazy-load the Python NeuroRuntime so startup stays fast."""
    global _py_runtime
    if _py_runtime is not None:
        return _py_runtime
    try:
        if _PY_STACK not in sys.path:
            sys.path.insert(0, _PY_STACK)
        from main import NeuroRuntime  # type: ignore
        _py_runtime = NeuroRuntime(dims=3)
        return _py_runtime
    except Exception as e:
        print(f"[server] Python runtime unavailable: {e}")
        return None


def _python_chat(query: str) -> dict:
    """
    Fall through to the Python NeuroRuntime when the TS backend is down.
    Encodes the query as an input neuron, runs 5 ticks, returns output state.
    This collapses the Python/TS duplication: same neural semantics, different stack.
    """
    rt = _get_py_runtime()
    if rt is None:
        return {"response": f"Processed: {query[:80]}", "stack": "fallback", "ms": 0}

    t0 = time.time()
    try:
        # Build a minimal query network: one input neuron, one output neuron.
        rt.declare("input")
        rt.declare("output")
        # Encode query length as the input signal (crude but deterministic).
        qlen = len(query)
        rt.inject_input("input", [qlen / 512.0, float(qlen % 16) / 16.0, 0.5])
        results = rt.run(5)
        out_state = rt.neurons.get("output")
        state_vec = out_state.state if out_state else [0.0, 0.0, 0.0]
        ms = round((time.time() - t0) * 1000)
        return {
            "response": f"[Python stack] Neural output: [{', '.join(f'{v:.3f}' for v in state_vec)}] for '{query[:50]}'",
            "stack": "python-neurolang",
            "state": state_vec,
            "ms": ms,
        }
    except Exception as e:
        return {"response": f"Python runtime error: {e}", "stack": "python-error", "ms": 0}

def _start_ts_backend():
    global _llm_process
    try:
        _llm_process = subprocess.Popen(
            ["npx", "tsx", os.path.join(_ROOT, "index.ts"), "web", "7861"],
            cwd=_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        import time as _t
        _t.sleep(2)
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
            except Exception:
                # TS backend down: fall through to Python neural runtime.
                self._json(_python_chat(query))
        elif path == "/api/neurolang":
            # Direct access to the Python NeuroLang interpreter.
            # POST body: {"source": "<.nl program source>"}
            source = body.get("source", "").strip()
            if not source:
                self._json({"error": "empty source"})
                return
            t0 = time.time()
            try:
                if _PY_STACK not in sys.path:
                    sys.path.insert(0, _PY_STACK)
                from main import NeuroRuntime, interpret  # type: ignore
                # Capture stdout from the interpreter (show/print commands).
                buf = io.StringIO()
                old_stdout = sys.stdout
                sys.stdout = buf
                try:
                    rt = interpret(source)
                finally:
                    sys.stdout = old_stdout
                output = buf.getvalue()
                neurons = {
                    name: {"state": n.state, "vale": n.vale, "dims": n.dims}
                    for name, n in rt.neurons.items()
                }
                self._json({
                    "neurons": neurons,
                    "ticks": rt.tick,
                    "output": output,
                    "ms": round((time.time() - t0) * 1000),
                })
            except Exception as e:
                self._json({"error": str(e), "ms": round((time.time() - t0) * 1000)})
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

def run(host: str = "0.0.0.0", port: int = 7860) -> None:
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
