"""Isolated browser fixture; prints no synthetic session or password values."""
import argparse
import json
import os
from pathlib import Path
from services.accounts.server import create_server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=4798)
    parser.add_argument("--owner-invite", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    if list(args.root.iterdir()):
        raise ValueError("QA directory must be empty")
    server = create_server(("127.0.0.1", args.port), args.root / "accounts.sqlite3",
                           control_database=args.root / "control.sqlite3", environment="preview")
    for username in ("qa-owner", "qa-member"):
        server.store.register(username, "Synthetic-ui-only-password-123!", server.store.create_invite(), "QA", "test")
    server.control.grant_role("qa-owner", "owner")
    if args.owner_invite:
        setup = server.control.prepare_owner_invite("qa-invited-owner")
        print(json.dumps({"syntheticOwnerInvite": setup["invite"]}), flush=True)
    print(f"Isolated control QA server ready on 127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
