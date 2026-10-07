import json
import os
from pathlib import Path


def environment_value(path, name):
    values = dict(line.split("=", 1) for line in Path(path).read_text().splitlines() if line)
    return values[name]


if __name__ == "__main__":
    if os.geteuid() != 0:
        raise SystemExit("Administrator access required")
    print(json.dumps({
        "syncEndpoint": "https://oceanseo.gellaronline.cc",
        "syncToken": environment_value("/etc/tideplan-sync.env", "TIDEPLAN_SYNC_TOKEN"),
        "healthEndpoint": "https://oceanseo.gellaronline.cc/health",
        "metricsEndpoint": "https://oceanseo.gellaronline.cc/metrics",
        "metricsToken": environment_value("/etc/tideplan-monitor.env", "TIDEPLAN_MONITOR_TOKEN"),
    }, ensure_ascii=False, indent=2))
