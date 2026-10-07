"""Password hashing uses OpenSSL scrypt, not a custom cryptographic algorithm."""
import hashlib
import hmac
import re
import secrets
import threading

HASH_SLOTS = threading.BoundedSemaphore(2)
SCRYPT_N = 131072
SCRYPT_R = 8
SCRYPT_P = 1


def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def new_token():
    return secrets.token_urlsafe(32)


def username_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,63}", value):
        raise ValueError("username")
    return value.lower()


def valid_password(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 128 or len(value.encode("utf-8")) > 512:
        raise ValueError("password")
    return value


def password_digest(password, salt):
    with HASH_SLOTS:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N,
                              r=SCRYPT_R, p=SCRYPT_P, dklen=32, maxmem=256 * 1024 * 1024)


def hash_password(password):
    valid_password(password)
    salt = secrets.token_bytes(16)
    return f"scrypt-v1${salt.hex()}${password_digest(password, salt).hex()}"


def verify_password(password, encoded):
    try:
        valid_password(password)
        version, salt, digest = encoded.split("$")
        if version != "scrypt-v1" or len(salt) != 32 or len(digest) != 64:
            return False
        return hmac.compare_digest(password_digest(password, bytes.fromhex(salt)), bytes.fromhex(digest))
    except (ValueError, UnicodeError):
        return False
