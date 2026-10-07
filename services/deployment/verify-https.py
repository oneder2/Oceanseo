import argparse
import json
import ssl
import urllib.error
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def request(opener, url, token=None):
    headers = {"Accept": "application/json", "User-Agent": "Oceanseo-Deployment-Check/1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, response.read(17 * 1024 * 1024 + 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("credentials", type=Path)
    arguments = parser.parse_args()
    configuration = json.loads(arguments.credentials.read_text())
    base = "https://oceanseo.gellaronline.cc"
    if configuration["syncEndpoint"] != base or configuration["metricsEndpoint"] != base + "/metrics":
        raise SystemExit("Unexpected endpoint; refusing to send credentials")
    opener = urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    code, payload = request(opener, base + "/health")
    if code != 200 or payload != b"ok":
        raise SystemExit(f"Health check failed: HTTP {code}")
    for path in ["/v1/vault", "/metrics"]:
        code, payload = request(opener, base + path)
        if code != 401 or json.loads(payload).get("error") != "unauthorized":
            raise SystemExit(f"Unauthenticated access not rejected as expected: {path}, HTTP {code}")
    code, payload = request(opener, base + "/v1/vault", configuration["syncToken"])
    if code != 200:
        raise SystemExit(f"Authenticated sync check failed: HTTP {code}")
    vault = json.loads(payload)
    if vault.get("protocol") != 1 or not isinstance(vault.get("records"), dict):
        raise SystemExit("Invalid vault protocol")
    code, payload = request(opener, base + "/metrics", configuration["metricsToken"])
    if code != 200:
        raise SystemExit(f"Authenticated metrics check failed: HTTP {code}")
    metrics = json.loads(payload)
    for name in ["cpuPercent", "memoryPercent", "diskPercent"]:
        if not isinstance(metrics.get(name), (int, float)) or not 0 <= metrics[name] <= 100:
            raise SystemExit(f"Invalid metric: {name}")
    code, payload = request(opener, base + "/metrics", configuration["syncToken"])
    if code != 401:
        raise SystemExit("Sync token was incorrectly accepted by metrics service")
    code, payload = request(opener, base + "/v1/vault", configuration["metricsToken"])
    if code != 401:
        raise SystemExit("Metrics token was incorrectly accepted by sync service")
    print(json.dumps({
        "https": "verified, no redirects followed",
        "health": 200,
        "unauthenticatedSync": 401,
        "unauthenticatedMetrics": 401,
        "independentTokens": True,
        "vaultRevision": vault["revision"],
        "recordCount": len(vault["records"]),
        "metrics": {name: metrics[name] for name in ["cpuPercent", "memoryPercent", "diskPercent"]},
    }, ensure_ascii=False, indent=2))
