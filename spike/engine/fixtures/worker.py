# Copyright (c) 2026 the Zuke contributors
# SPDX-License-Identifier: MIT
"""A Zuke worker in Python, for the engine's end-to-end test.

It speaks protocol 1 over the loopback socket the engine names in
ZUKE_ENGINE_ADDR: newline-delimited JSON-RPC 2.0, both directions. The build
it describes has three targets; two run a subprocess through the engine, one
of them proving that the environment this process sends in `hello` is what
the engine spawns with.

This is a test fixture for the engine, not the start of the Python SDK.
"""

import json
import os
import socket
import sys
import threading

PROTOCOL = 1

TARGETS = [
    {"name": "hello", "description": "print from a child", "dependsOn": []},
    {"name": "env", "description": "prove the env reached the child",
     "dependsOn": []},
    {"name": "default", "description": "both", "dependsOn": ["hello", "env"]},
]


class Peer:
    """A symmetric JSON-RPC peer over one socket."""

    def __init__(self, sock):
        self.sock = sock
        self.reader = sock.makefile("r", encoding="utf-8")
        self.lock = threading.Lock()
        self.next_id = 1
        self.pending = {}
        self.handlers = {}

    def send(self, message):
        data = (json.dumps(message) + "\n").encode("utf-8")
        with self.lock:
            self.sock.sendall(data)

    def request(self, method, params):
        with self.lock:
            request_id = self.next_id
            self.next_id += 1
            box = {"event": threading.Event()}
            self.pending[request_id] = box
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method,
                   "params": params})
        box["event"].wait()
        if "error" in box:
            raise RuntimeError(box["error"].get("message", "error"))
        return box.get("result")

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def serve(self):
        for line in self.reader:
            line = line.strip()
            if not line:
                continue
            message = json.loads(line)
            if "method" in message:
                threading.Thread(target=self.handle, args=(message,),
                                 daemon=True).start()
            elif "id" in message:
                box = self.pending.pop(message["id"], None)
                if box is None:
                    continue
                if "error" in message:
                    box["error"] = message["error"]
                else:
                    box["result"] = message.get("result")
                box["event"].set()

    def handle(self, message):
        handler = self.handlers.get(message["method"])
        request_id = message.get("id")
        try:
            if handler is None:
                raise RuntimeError("unknown method " + message["method"])
            result = handler(message.get("params"))
            if request_id is not None:
                self.send({"jsonrpc": "2.0", "id": request_id,
                           "result": result if result is not None else {}})
        except Exception as error:  # noqa: BLE001 - every failure is reported
            if request_id is not None:
                self.send({"jsonrpc": "2.0", "id": request_id,
                           "error": {"code": -32000, "message": str(error)}})


def exec_in_engine(peer, target, argv):
    return peer.request("exec", {"target": target, "argv": argv})


def run_target(peer, params):
    name = params["target"]
    if name == "hello":
        result = exec_in_engine(peer, name, [
            sys.executable, "-c", "print('hello from a python child')"])
        if result["code"] != 0:
            raise RuntimeError("hello child failed")
    elif name == "env":
        result = exec_in_engine(peer, name, [
            sys.executable, "-c",
            "import os; print(os.environ.get('ZUKE_PY_MARK'))"])
        if "from-python" not in result["stdout"]:
            raise RuntimeError("env not propagated: " + result["stdout"])
    return {}


def main():
    host, port = os.environ["ZUKE_ENGINE_ADDR"].split(":")
    os.environ["ZUKE_PY_MARK"] = "from-python"
    sock = socket.create_connection((host, int(port)))
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    peer = Peer(sock)
    peer.handlers["build.describe"] = lambda _: {"name": "PyBuild",
                                                "targets": TARGETS}
    peer.handlers["target.run"] = lambda params: run_target(peer, params)
    peer.handlers["run.cancel"] = lambda _: None
    peer.handlers["run.exit"] = lambda _: os._exit(0)
    print("python worker started", flush=True)
    threading.Thread(target=peer.request, args=("hello", {
        "sdk": "zuke-python-fixture",
        "protocol": PROTOCOL,
        "token": os.environ["ZUKE_ENGINE_TOKEN"],
        "env": dict(os.environ),
        "cwd": os.getcwd(),
    }), daemon=True).start()
    peer.serve()


if __name__ == "__main__":
    main()
