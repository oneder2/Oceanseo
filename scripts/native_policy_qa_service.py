"""Private native-acceptance HTTP fixture; never imported by deployed services."""
import json
import os
from pathlib import Path
import time

from services.accounts.server import Handler, create_server

root = Path(os.environ["QA_ROOT"])
original_reply = Handler.reply


def reply_with_delayed_sync_ack(self, status, value):
    hold = root / "sync-hold"
    if self.path == "/v2/vault" and status == 200 and hold.exists() and hold.read_text() == self.command:
        (root / "sync-received").write_text(self.command)
        deadline = time.monotonic() + 15
        while hold.read_text() == self.command and time.monotonic() < deadline:
            time.sleep(0.05)
    return original_reply(self, status, value)


if __name__ == "__main__":
    Handler.reply = reply_with_delayed_sync_ack
    server = create_server(("127.0.0.1", 0), root / "accounts.sqlite3",
                           control_database=root / "control.sqlite3", environment="preview")
    server.store.register("qa-owner", "Synthetic-policy-native-123!", server.store.create_invite(), "HTTP peer", "linux")
    server.control.grant_role("qa-owner", "owner")
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()
