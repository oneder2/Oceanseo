"""Local-only QA endpoint with synthetic token, real Linux metrics, and health."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/host-monitor'))
from collector import Handler, create_server


class QAHandler(Handler):
    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'status': 'ok'})
        else:
            super().do_GET()


server = create_server(('127.0.0.1', 4790), 'synthetic-monitor-test-token-123456789')
server.RequestHandlerClass = QAHandler
print('Synthetic local QA health + collector ready on 4790', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
