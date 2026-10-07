"""Ephemeral localhost fixture. Never use production credentials/data."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/sync"))
from server import create_server

TOKEN = "tideplan-local-test-token-not-for-production-123456"
TASK_ID = "11111111-1111-4111-8111-111111111111"

with tempfile.TemporaryDirectory(prefix="tideplan-sync-qa-") as directory:
    server = create_server(("127.0.0.1", 4789), Path(directory) / "qa.sqlite3", TOKEN)
    initial = server.store.get()
    task = dict(schema_version="1.0.0", id=TASK_ID, title="同步验收：电脑记录的计划", notes="电脑笔记", horizon="short", priority="normal", start_date="2026-09-29", due_date="2026-10-01", created_at="2026-09-29T09:00:00Z", updated_at="2026-09-29T09:00:00Z", completed_at=None, origin=dict(kind="local", label=None, reference=None))
    if "--empty" not in sys.argv:
        server.store.put(dict(protocol=1, vaultId=initial["vaultId"], expectedRevision=0, records={"task:" + TASK_ID: task}))
    print("Local synthetic sync fixture ready on 127.0.0.1:4789", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
