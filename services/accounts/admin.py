"""Local operator CLI. Never pass passwords on the command line."""
import argparse
import getpass
import os

from .store import AccountStore


def main():
    parser = argparse.ArgumentParser(description="Oceanseo internal beta account administration")
    parser.add_argument("--database", required=True)
    parser.add_argument("--control-database")
    parser.add_argument("--environment", choices=["preview", "live"])
    commands = parser.add_subparsers(dest="command", required=True)
    invite = commands.add_parser("invite")
    invite.add_argument("--hours", type=int, default=72)
    reset = commands.add_parser("reset-password")
    reset.add_argument("username")
    role = commands.add_parser("role")
    role.add_argument("username")
    role.add_argument("role", choices=["member", "operator", "owner"])
    bootstrap = commands.add_parser("bootstrap-owner")
    bootstrap.add_argument("username")
    bootstrap.add_argument("--hours", type=int, default=72)
    args = parser.parse_args()
    os.umask(0o077)
    store = AccountStore(args.database)
    if args.command == "invite":
        print(store.create_invite(args.hours))
    elif args.command in ("role", "bootstrap-owner"):
        if not args.control_database or not args.environment:
            parser.error("Role bootstrap requires --control-database and --environment")
        from .control import ControlStore
        control = ControlStore(args.control_database, store, args.environment)
        if args.command == "role":
            control.grant_role(args.username, args.role)
            print("Role updated; no workspace ownership or business content was changed.")
        else:
            import json
            print(json.dumps(control.prepare_owner_invite(args.username, args.hours)))
    else:
        first = getpass.getpass("New password (12-128 characters): ")
        if first != getpass.getpass("Repeat new password: "):
            parser.error("Passwords do not match")
        store.reset_password(args.username, first)
        print("Password changed. All device sessions revoked; user must sign in again.")


if __name__ == "__main__":
    main()
