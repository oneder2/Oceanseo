import json
import threading
import unittest
import urllib.request
from urllib.error import HTTPError
from collector import create_server, cpu_ticks, cpu_percent, memory_percent, network_bytes


class CollectorTest(unittest.TestCase):
    def test_metrics_math(self):
        self.assertEqual(cpu_ticks('cpu 10 2 8 80 5 0 0 0 10 2'), (105, 85))
        self.assertEqual(cpu_percent((100, 70), (200, 110)), 60)
        self.assertEqual(memory_percent('MemTotal: 1000 kB\nMemAvailable: 400 kB'), 60)
        self.assertEqual(network_bytes('header\nheader\nlo: 50 0 0 0 0 0 0 0 50\neth0: 100 0 0 0 0 0 0 0 200'), (100, 200))

    def test_real_http_auth_and_projection(self):
        server = create_server(('127.0.0.1', 0), 'synthetic-monitor-test-token-123456789')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:%s/metrics' % server.server_port
        try:
            with self.assertRaises(HTTPError) as e:
                urllib.request.urlopen(url)
            self.assertEqual(e.exception.code, 401)
            request = urllib.request.Request(url, headers={'Authorization': 'Bearer synthetic-monitor-test-token-123456789'})
            with urllib.request.urlopen(request) as r:
                value = json.load(r)
            self.assertEqual(set(value), {'sampledAt', 'cpuPercent', 'memoryPercent', 'diskPercent', 'uptimeSeconds', 'networkRxBytes', 'networkTxBytes'})
            for k in ['cpuPercent', 'memoryPercent', 'diskPercent']:
                self.assertTrue(0 <= value[k] <= 100)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
