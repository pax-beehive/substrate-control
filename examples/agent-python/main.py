#!/usr/bin/env python3
"""Minimal Substrate actor: a tiny LLM agent behind the LiteLLM gateway.

Env contract (configure in the ActorTemplate):
  MODEL            LiteLLM model alias, e.g. "claude-sonnet"     (optional)
  LLM_API_KEY      -> set via secretKeyRef to your litellm virtual key
  LLM_BASE_URL     -> "http://litellm.litellm.svc:4000"          (optional)
  STATE_DIR        durableDir mount path, state survives suspend (default /data)

HTTP surface (atenet routes actor traffic to port 80):
  GET  /       -> status + persisted request count
  POST /ask    -> {"answer": "..."} one round-trip to the gateway
  GET  /readyz -> readiness probe used by the template
"""
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MODEL = os.environ.get("MODEL", "claude-sonnet")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://litellm.litellm.svc:4000")
STATE_FILE = Path(os.environ.get("STATE_DIR", "/data")) / "state.json"


def load_count() -> int:
    try:
        return json.loads(STATE_FILE.read_text())["requests"]
    except Exception:
        return 0


def save_count(n: int) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"requests": n}))


COUNT = load_count()


def ask_llm(prompt: str) -> str:
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 256,
    }).encode()
    req = urllib.request.Request(
        f"{LLM_BASE_URL}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, text: str) -> None:
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        global COUNT
        if self.path == "/readyz":
            self._send(200, "ok")
            return
        COUNT += 1
        save_count(COUNT)
        self._send(200, f"agent alive | model={MODEL} | preserved request count: {COUNT}\n")

    def do_POST(self) -> None:  # noqa: N802
        global COUNT
        if self.path != "/ask":
            self._send(404, "not found\n")
            return
        length = int(self.headers.get("Content-Length", 0))
        prompt = self.rfile.read(length).decode() or "say hello in one sentence"
        try:
            answer = ask_llm(prompt)
        except Exception as e:  # surface gateway errors plainly
            self._send(502, f"gateway error: {e}\n")
            return
        COUNT += 1
        save_count(COUNT)
        self._send(200, f"{answer}\n(count: {COUNT})\n")

    def log_message(self, *args) -> None:  # keep stdout quiet
        pass


if __name__ == "__main__":
    print(f"listening on :80, model={MODEL}, gateway={LLM_BASE_URL}")
    HTTPServer(("0.0.0.0", 80), Handler).serve_forever()
