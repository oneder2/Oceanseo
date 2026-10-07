"""Read-only public deployment check; never sends credentials or business data."""
import argparse
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(opener, base, path):
    request = urllib.request.Request(
        base + path,
        headers={"Accept": "application/json", "User-Agent": "Oceanseo-Live-Check/1"},
    )
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, dict(response.headers), response.read(1024 * 1024)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="https://oceanseo.gellaronline.cc")
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.endpoint.rstrip("/"))
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ("", "/"):
        raise SystemExit("endpoint must be an HTTPS origin without credentials or a path")
    base = args.endpoint.rstrip("/")
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    checks = {}
    code, _, payload = request(opener, base, "/health")
    if code != 200 or payload != b"ok":
        raise SystemExit(f"public health failed: HTTP {code}")
    checks["public"] = {"status": code, "body": "ok"}
    for label, path, service in (("accounts", "/health/accounts", "accounts"), ("sync", "/health/sync", "sync")):
        code, headers, payload = request(opener, base, path)
        value = json.loads(payload)
        expected = {"ok": True, "service": service, "schemaVersion": 1}
        if code != 200 or value != expected or headers.get("Cache-Control") != "no-store":
            raise SystemExit(f"{label} health failed: HTTP {code} {value!r}")
        checks[label] = {"status": code, "schemaVersion": value["schemaVersion"]}
    for label, path in (("accountsUnauthenticated", "/v2/me"), ("syncUnauthenticated", "/v1/vault"), ("metricsUnauthenticated", "/metrics")):
        code, _, payload = request(opener, base, path)
        value = json.loads(payload)
        if code != 401 or value.get("error") not in ("session_invalid", "unauthorized"):
            raise SystemExit(f"{label} access check failed: HTTP {code} {value!r}")
        checks[label] = {"status": code}
    print(json.dumps({"endpoint": base, "redirectsFollowed": False, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
