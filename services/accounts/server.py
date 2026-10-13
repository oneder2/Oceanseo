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

    def __init__(self, address, store, control=None):
        self.store = store
        self.control = control
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
        control = self.server.control
        if control is not None:
            result = self.dispatch_control(control, route)
            if result is not None:
                return result
        if route == "/v2/health" and self.command == "GET":
            return 200, store.health()
        if route == "/v2/register" and self.command == "POST":
            v = self.body(["username", "password", "invite", "deviceName", "platform"])
            if control:
                control.validate_registration(v["username"], v["invite"])
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
        if route == "/v2/account" and self.command == "DELETE":
            v = self.body(["password", "confirmation"])
            result = store.delete_account(self.token(), v["password"], v["confirmation"])
            if control:
                control.purge_deleted_users()
            return 200, result
        if route == "/v2/vault" and self.command == "GET":
            return 200, store.get_vault(self.token())
        if route == "/v2/vault" and self.command == "PUT":
            token = self.token()
            store.me(token)
            v = self.body(["protocol", "vaultId", "expectedRevision", "records"], MAX_BODY)
            return 200, control.put_legacy_vault(token, v) if control else store.put_vault(token, v)
        return 404, {"error": "not_found"}

    def dispatch_control(self, control, route):
        if route == "/v2/control/health" and self.command == "GET":
            return 200, control.health()
        if route == "/v2/capabilities" and self.command == "GET":
            return 200, control.capabilities(self.token())
        if route == "/v2/workspaces":
            if self.command == "GET":
                return 200, control.list_workspaces(self.token())
            if self.command == "POST":
                token = self.token()
                control.capabilities(token)
                v = self.body(["edition", "name"])
                return 201, control.create_workspace(token, v["edition"], v["name"])
        if route.startswith("/v2/workspaces/"):
            parts = route.split("/")
            if len(parts) == 5:
                workspace_id, action = parts[3:]
                if action == "capabilities" and self.command == "GET":
                    return 200, control.capabilities(self.token(), workspace_id)
                if action == "vault":
                    if self.command == "GET":
                        return 200, control.vault(self.token(), workspace_id)
                    if self.command == "PUT":
                        token = self.token()
                        control.capabilities(token, workspace_id)
                        v = self.body(["protocol", "vaultId", "expectedRevision", "records"], MAX_BODY)
                        return 200, control.vault(token, workspace_id, v)
        if route == "/v2/admin/overview" and self.command == "GET":
            return 200, control.overview(self.token())
        if route == "/v2/admin/users" and self.command == "GET":
            return 200, control.users(self.token())
        if route in ("/v2/admin/module-policies", "/v2/admin/module-policies/restore") and self.command == "POST":
            token = self.token()
            control.overview(token)
            restore = route.endswith("/restore")
            v = self.body(["scope", "subject", "edition", "expectedRevision", "restoreRevision" if restore else "rules"])
            return 200, control.publish(token, v["scope"], v["subject"], v["edition"], v["expectedRevision"],
                                        {} if restore else v["rules"], v["restoreRevision"] if restore else None)
        if route == "/v2/admin/cohorts" and self.command == "POST":
            token = self.token()
            control.overview(token)
            v = self.body(["userId", "cohortId", "member"])
            return 200, control.cohort(token, v["userId"], v["cohortId"], v["member"])
        return None

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


def create_server(address, database, clock=None, backup_status=None, control_database=None, environment=None):
    if address[0] not in ("127.0.0.1", "localhost"):
        raise ValueError("Account service must bind to loopback; use an HTTPS proxy")
    os.umask(0o077)
    options = {"clock": clock} if clock else {}
    if backup_status:
        options["backup_status"] = backup_status
    store = AccountStore(database, **options)
    control = None
    if control_database is not None:
        from .control import ControlStore
        control = ControlStore(control_database, store, environment)
    return AccountServer(address, store, control)


if __name__ == "__main__":
    database = os.environ.get("OCEANSEO_ACCOUNTS_DB", "./private/accounts.sqlite3")
    backup_status = os.environ.get("OCEANSEO_ACCOUNTS_BACKUP_STATUS") or os.path.join(os.path.dirname(database), "backup-audit-status.json")
    server = create_server(("127.0.0.1", int(os.environ.get("OCEANSEO_ACCOUNTS_PORT", "4791"))),
                           database, backup_status=backup_status,
                           control_database=os.environ.get("OCEANSEO_CONTROL_DB"),
                           environment=os.environ.get("OCEANSEO_ENVIRONMENT"))
    print("Oceanseo invitation-only accounts ready on loopback.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
