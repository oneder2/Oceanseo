"""Opt-in Linux read-only metrics endpoint. Bind loopback behind HTTPS.

No command execution, process listing, logs, credentials or application files.
Network counters are since boot, excluding lo; NOT provider billing traffic.
"""
import datetime
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def cpu_ticks(text):
    fields = text.splitlines()[0].split()
    if fields[0] != "cpu" or len(fields) < 5:
        raise ValueError("cpu stats unavailable")
    values = [int(v) for v in fields[1:9]]  # guest already counted in user/nice
    return sum(values), values[3] + (values[4] if len(values) > 4 else 0)


def cpu_percent(before, after):
    total, idle = after[0] - before[0], after[1] - before[1]
    return round(max(0, min(100, 100 * (total - idle) / total)), 2) if total > 0 else 0


def memory_percent(text):
    values = {line.split(':')[0]: int(line.split()[1]) for line in text.splitlines() if ':' in line}
    return round(100 * (values['MemTotal'] - values['MemAvailable']) / values['MemTotal'], 2)


def network_bytes(text):
    rx = tx = 0
    for line in text.splitlines()[2:]:
        name, fields = line.split(':', 1)
        if name.strip() == 'lo':
            continue
        values = fields.split()
        rx += int(values[0])
        tx += int(values[8])
    return rx, tx


class Sampler:
    def __init__(self, disk='/'):
        self.disk = disk
        self.lock = threading.Lock()
        self.last = None
        self.last_time = 0

    def sample(self):
        with self.lock:
            if self.last and time.monotonic() - self.last_time < 10:
                return self.last
            before = cpu_ticks(Path('/proc/stat').read_text())
            time.sleep(.25)
            after = cpu_ticks(Path('/proc/stat').read_text())
            disk = shutil.disk_usage(self.disk)
            rx, tx = network_bytes(Path('/proc/net/dev').read_text())
            self.last = dict(sampledAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                             cpuPercent=cpu_percent(before, after),
                             memoryPercent=memory_percent(Path('/proc/meminfo').read_text()),
                             diskPercent=round(disk.used / disk.total * 100, 2),
                             uptimeSeconds=float(Path('/proc/uptime').read_text().split()[0]),
                             networkRxBytes=rx, networkTxBytes=tx)
            self.last_time = time.monotonic()
            return self.last


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != '/metrics':
            self.reply(404, {'error': 'not_found'})
        elif not hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + self.server.token).encode()):
            self.reply(401, {'error': 'unauthorized'})
        else:
            try:
                self.reply(200, self.server.sampler.sample())
            except (OSError, ValueError, KeyError, ZeroDivisionError):
                self.reply(503, {'error': 'metrics_unavailable'})


def create_server(address, token, disk='/'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,512}', token):
        raise ValueError('TIDEPLAN_MONITOR_TOKEN requires a random URL-safe token, 32–512 characters')
    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    server.token = token
    server.sampler = Sampler(disk)
    return server


if __name__ == '__main__':
    server = create_server(('127.0.0.1', int(os.getenv('TIDEPLAN_MONITOR_PORT', '4790'))), os.environ.get('TIDEPLAN_MONITOR_TOKEN', ''), os.getenv('TIDEPLAN_MONITOR_DISK', '/'))
    print('Tideplan read-only collector ready on loopback', flush=True)
    server.serve_forever()
