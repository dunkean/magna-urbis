"""python -m illustration --port 8794 (loopback only)."""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from .service import IllustrationService


def origin_allowed(origin):
    if not origin:
        return True  # Native clients and command-line tools.
    parsed = urlsplit(origin)
    return (parsed.scheme in ("http", "https") and parsed.hostname in ("127.0.0.1", "localhost", "::1")) or origin in {
        "https://dunkean.github.io", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
        *os.environ.get("MAGNA_ILLUSTRATION_ORIGINS", "").split(",")}


def handler_for(service):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value, content_type="application/json"):
            raw = json.dumps(value, ensure_ascii=False).encode() if content_type == "application/json" else value
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin and origin_allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self.reply(204 if origin_allowed(self.headers.get("Origin")) else 403, b"", "text/plain")

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def do_DELETE(self):
            self.dispatch()

        def dispatch(self):
            if not origin_allowed(self.headers.get("Origin")):
                self.reply(403, {"error": "Origine non autorisée."})
                return
            # Reject DNS rebinding even when the browser omits Origin.
            if urlsplit("http://" + self.headers.get("Host", "")).hostname not in ("localhost", "127.0.0.1", "::1"):
                self.reply(403, {"error": "Hôte non autorisé."})
                return
            path = urlsplit(self.path).path.rstrip("/")
            try:
                if self.command == "GET" and path in ("/status", "/v1/illustrations/capabilities"):
                    self.reply(200, service.capabilities())
                elif path == "/v1/illustrations/jobs" and self.command == "GET":
                    self.reply(200, {"jobs": service.history()})
                elif path in ("/v1/illustrations/jobs", "/v1/illustrations/prompt") and self.command == "POST":
                    length = int(self.headers.get("Content-Length", "0"))
                    limit = (2 if path.endswith("/prompt") else 48) * 1024 * 1024
                    if not 0 < length <= limit:
                        self.reply(413, {"error": "Capture trop volumineuse."})
                        return
                    if self.headers.get_content_type() != "application/json":
                        raise ValueError("Le service attend application/json.")
                    body = json.loads(self.rfile.read(length))
                    if path.endswith("/prompt"):
                        self.reply(200, service.preview_prompt(body))
                    else:
                        self.reply(202, service.submit(body))
                elif path.startswith("/v1/illustrations/jobs/"):
                    tail = path.removeprefix("/v1/illustrations/jobs/").split("/")
                    if len(tail) == 1 and self.command == "GET":
                        self.reply(200, service.get(tail[0]))
                    elif len(tail) == 1 and self.command == "DELETE":
                        service.delete(tail[0]); self.reply(200, {"deleted": True})
                    elif len(tail) == 2 and tail[1] == "cancel" and self.command == "POST":
                        self.reply(200, service.cancel(tail[0]))
                    elif len(tail) == 2 and self.command == "GET":
                        asset = service.asset(*tail)
                        self.reply(200, asset.read_bytes(), "application/json" if asset.suffix == ".json" else "image/png")
                    else:
                        raise KeyError("Route inconnue.")
                else:
                    raise KeyError("Route inconnue.")
            except KeyError:
                self.reply(404, {"error": "Travail ou fichier introuvable."})
            except (ValueError, TypeError) as error:
                self.reply(400, {"error": str(error)[:500]})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.reply(500, {"error": "Le service ne peut pas traiter cette requête."})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8794)
    parser.add_argument("--output")
    args = parser.parse_args()
    service = IllustrationService(args.output)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(service))
    print(json.dumps({"ready": True, "port": server.server_port, "service": "magna-illustration"}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()


if __name__ == "__main__":
    main()
