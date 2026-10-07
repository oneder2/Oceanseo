"""Run with python3 -m services.accounts.server behind an HTTPS reverse proxy."""
import json
import os
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from services.sync.server import MAX_BODY, unique_object
from .store import AccountStore, ApiError


class AccountServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store):
        self.store = store
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(2)
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 24\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{"error":"service_busy"}')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, *_):
        # Do not leak request objects or credential-bearing exception context.
        pass


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def version_string(self):
        return "OceanseoAccounts/2"

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 429:
            self.send_header("Retry-After", "900")
        self.end_headers()
        self.wfile.write(payload)

    def body(self, keys, limit=8192):
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1 or self.headers.get_content_type() != "application/json":
            raise ValueError("content_type")
        size = int(self.headers["Content-Length"])
        if size > limit:
            raise OverflowError("size")
        if size < 1:
            raise ValueError("size")
        raw = self.rfile.read(size)
        if len(raw) != size:
            raise ValueError("incomplete")
        value = json.loads(raw, object_pairs_hook=unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
        if not isinstance(value, dict) or set(value) != set(keys):
            raise ValueError("shape")
        return value

    def token(self):
        headers = self.headers.get_all("Authorization", [])
        if len(headers) != 1 or not headers[0].startswith("Bearer "):
            raise ApiError(401, "session_invalid")
        return headers[0][7:]

    def dispatch(self):
        store = self.server.store
        route = self.path
        if route == "/v2/register" and self.command == "POST":
            v = self.body(["username", "password", "invite", "deviceName", "platform"])
            return 201, store.register(v["username"], v["password"], v["invite"], v["deviceName"], v["platform"])
        if route == "/v2/login" and self.command == "POST":
            v = self.body(["username", "password", "deviceName", "platform"])
            return 200, store.login(v["username"], v["password"], v["deviceName"], v["platform"])
        if route == "/v2/me" and self.command == "GET":
            return 200, store.me(self.token())
        if route == "/v2/sessions" and self.command == "GET":
            return 200, store.sessions(self.token())
        if route.startswith("/v2/sessions/") and self.command == "DELETE":
            return 200, store.revoke(self.token(), route[len("/v2/sessions/"):])
        if route == "/v2/password" and self.command == "POST":
            token = self.token()
            store.me(token)
            v = self.body(["currentPassword", "password"])
            return 200, store.change_password(token, v["currentPassword"], v["password"])
        if route == "/v2/vault" and self.command == "GET":
            return 200, store.get_vault(self.token())
        if route == "/v2/vault" and self.command == "PUT":
            token = self.token()
            store.me(token)
            v = self.body(["protocol", "vaultId", "expectedRevision", "records"], MAX_BODY)
            return 200, store.put_vault(token, v)
        return 404, {"error": "not_found"}

    def run(self):
        try:
            code, result = self.dispatch()
            self.reply(code, result)
        except ApiError as error:
            self.reply(error.status, {"error": error.code})
        except OverflowError:
            self.reply(413, {"error": "too_large"})
        except (ValueError, TypeError, UnicodeError, RecursionError):
            self.reply(400, {"error": "invalid_request"})
        except (sqlite3.Error, OSError):
            try:
                self.reply(503, {"error": "storage_unavailable"})
            except OSError:
                pass

    do_GET = run
    do_POST = run
    do_PUT = run
    do_DELETE = run


def create_server(address, database, clock=None):
    if address[0] not in ("127.0.0.1", "localhost"):
        raise ValueError("Account service must bind to loopback; use an HTTPS proxy")
    os.umask(0o077)
    store = AccountStore(database, **({"clock": clock} if clock else {}))
    return AccountServer(address, store)


if __name__ == "__main__":
    server = create_server(("127.0.0.1", int(os.environ.get("OCEANSEO_ACCOUNTS_PORT", "4791"))),
                           os.environ.get("OCEANSEO_ACCOUNTS_DB", "./private/accounts.sqlite3"))
    print("Oceanseo invitation-only accounts ready on loopback.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
