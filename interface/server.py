"""Browser backend for Neuroclaw.

Serves the terminal UI (interface/index.html) on http://127.0.0.1:7860 and
hands every request to the one network -- the all-to-all mesh in the TypeScript
backend, where a connection carries its own weight and bias plus the whole
network's, in numbers and in waves, and installed skills are neurons grafted
into it.

This used to load a TinyGPT checkpoint and sample it here, with the network
running alongside as a second model whose panels were proxied. TinyGPT is gone:
there is one model, and the words come from it.

No external APIs are used.

Run:
    python interface/server.py [--port 7860]
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


# --- skills built with the extension builder --------------------------------
# Every extension saved by the builder becomes a live skill: a neuron whose name
# is a trigger phrase and whose definition is the response. Chat matches a skill
# before the network answers, so building an extension immediately
# extends what the AI can answer (design doc: skills as router-gated neurons).
_skills: list[dict] = []
_skills_mtime = -1.0


def _extensions_dir() -> str:
    return os.path.join(_ROOT, "extension-builder", "extensions")


def _load_skills() -> None:
    """(Re)load skills from saved extensions, if the directory changed."""
    global _skills, _skills_mtime
    d = _extensions_dir()
    try:
        mtime = os.path.getmtime(d)
    except OSError:
        _skills, _skills_mtime = [], -1.0
        return
    if mtime == _skills_mtime and _skills:
        return
    skills: list[dict] = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".ext.json"):
            continue
        try:
            with open(os.path.join(d, fn), encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        ext_name = (data.get("project") or {}).get("name", fn)
        for n in data.get("neurons", []):
            trigger = str(n.get("name", "")).strip().lower()
            response = str(n.get("definition", "")).strip()
            if trigger and response:
                skills.append({"trigger": trigger, "response": response, "extension": ext_name})
    # longest trigger first, so a more specific skill wins
    skills.sort(key=lambda s: len(s["trigger"]), reverse=True)
    _skills, _skills_mtime = skills, mtime
    if skills:
        print(f"[server] loaded {len(skills)} skill(s) from extensions")


def _match_skill(query: str) -> Optional[dict]:
    """Return the most specific skill whose trigger appears in the query."""
    _load_skills()
    q = f" {query.lower()} "
    for skill in _skills:
        t = skill["trigger"]
        # whole-word / phrase containment
        if f" {t} " in q or f" {t}" in q or f"{t} " in q or t == query.lower():
            return skill
    return None


class NeuroClaw(BaseHTTPRequestHandler):
    log_message = lambda self, fmt, *args: None

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html", ""):
            self._serve_file(os.path.join(os.path.dirname(__file__), "index.html"), "text/html")
        elif path == "/health":
            self._json({"status": "ok", "ts": time.time()})
        elif path in ("/api/status", "/api/model"):
            # There is one model and it is the network, which lives in the
            # TypeScript backend. This server used to own a TinyGPT checkpoint
            # and answer from it; now it says where the real thing is.
            status, data = _proxy("GET", "/api/status", None)
            if status >= 400:
                self._json({"running": False, "model": None,
                            "note": "the network backend is not running (npm run server)"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        elif path in _PROXY_PATHS:
            status, data = _proxy("GET", path, None)
            self._raw_json(status, data)
        else:
            self.send_error(404, "Not found")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0

        # Security Check: Enforce a request body size limit of 1MB to prevent
        # memory exhaustion / DoS attacks.
        if length > 1024 * 1024:
            self.send_error(413, "Request entity too large")
            return

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
        # A built skill (extension) takes precedence over generation.
        skill = _match_skill(query)
        if skill is not None:
            self._json({"response": skill["response"], "skill": skill["trigger"],
                        "extension": skill["extension"], "timestamp": int(time.time() * 1000)})
            return

        # Straight to the one network. This used to sample a TinyGPT checkpoint
        # loaded in this process; TinyGPT is gone, and the words come from the
        # network the rest of the system already is -- all-to-all, one equation,
        # skills grafted into it as neurons rather than a separate model.
        t0 = time.time()
        status, data = _proxy("POST", "/api/chat", json.dumps(body).encode())
        if status >= 400:
            self._json({"error": "the network backend is not answering "
                                 "(start it with `npm run server`)"}, status=502)
            return
        try:
            payload = json.loads(data)
        except (ValueError, TypeError):
            self._json({"error": "the network backend sent something unreadable"}, status=502)
            return
        payload.setdefault("timestamp", int(time.time() * 1000))
        payload.setdefault("ms", round((time.time() - t0) * 1000))
        self._json(payload)

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
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';")


def run(host: str = "127.0.0.1", port: int = 7860) -> None:
    _load_skills()
    _start_ts_backend()
    server = HTTPServer((host, port), NeuroClaw)
    print(f"Neuroclaw ready on http://{host}:{port}")

    # SIGTERM (the default a process manager, `kill`, or a test harness sends
    # to stop this service) has no handler by default and would skip the
    # `finally` below entirely, orphaning the spawned TS subsystem backend.
    # Route it through the same clean-shutdown path as Ctrl+C (SIGINT).
    import signal

    def _on_sigterm(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _on_sigterm)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nNeuroclaw shutdown")
    finally:
        if _ts_process is not None:
            _ts_process.terminate()
            try:
                _ts_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _ts_process.kill()


def parse_args():
    ap = argparse.ArgumentParser(description="Neuroclaw browser backend.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7860)
    return ap.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(host=args.host, port=args.port)
