"""Local operator CLI. Never pass passwords on the command line."""
import argparse
import getpass
import os

from .store import AccountStore


def main():
    parser = argparse.ArgumentParser(description="Oceanseo internal beta account administration")
    parser.add_argument("--database", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    invite = commands.add_parser("invite")
    invite.add_argument("--hours", type=int, default=72)
    reset = commands.add_parser("reset-password")
    reset.add_argument("username")
    args = parser.parse_args()
    os.umask(0o077)
    store = AccountStore(args.database)
    if args.command == "invite":
        print(store.create_invite(args.hours))
    else:
        first = getpass.getpass("New password (12-128 characters): ")
        if first != getpass.getpass("Repeat new password: "):
            parser.error("Passwords do not match")
        store.reset_password(args.username, first)
        print("Password changed. All device sessions revoked; user must sign in again.")


if __name__ == "__main__":
    main()
