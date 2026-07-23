import os
import sys
import unittest
import threading
import http.client
import json
from http.server import HTTPServer

# Add repo root to path to ensure interface.server is importable
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from interface.server import NeuroClaw

class TestServerSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Start NeuroClaw server in a background thread on an ephemeral port
        cls.port = 7899
        cls.server = HTTPServer(('127.0.0.1', cls.port), NeuroClaw)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_security_headers_get(self):
        """Test that GET request responses include secure CORS and defense-in-depth security headers."""
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request('GET', '/health')
        resp = conn.getresponse()
        resp.read()

        headers = dict(resp.getheaders())

        # Check standard security headers
        self.assertEqual(headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(headers.get('X-Frame-Options'), 'DENY')
        self.assertIn('Content-Security-Policy', headers)
        self.assertIn("default-src 'self'", headers['Content-Security-Policy'])
        conn.close()

    def test_post_body_size_limit(self):
        """Test that POST requests with a body larger than 1MB are rejected with 413 Payload Too Large."""
        conn = http.client.HTTPConnection('127.0.0.1', self.port)

        # Send a 1.1MB body
        large_body = b'a' * (1024 * 1024 + 100)
        headers = {'Content-Length': str(len(large_body)), 'Content-Type': 'application/json'}

        try:
            conn.request('POST', '/api/chat', large_body, headers)
            resp = conn.getresponse()
            resp.read()
            # Expect 413 Payload Too Large (Request Entity Too Large)
            self.assertEqual(resp.status, 413)
        except (BrokenPipeError, ConnectionResetError, http.client.RemoteDisconnected, http.client.ResponseNotReady):
            # Dropping/closing the connection abruptly is also a valid DoS protection mechanism
            pass
        finally:
            conn.close()

    def test_post_body_size_ok(self):
        """Test that POST requests with a small body (e.g. 100 bytes) are processed normally (not 413)."""
        conn = http.client.HTTPConnection('127.0.0.1', self.port)

        small_body = json.dumps({"message": "test"}).encode('utf-8')
        headers = {'Content-Length': str(len(small_body)), 'Content-Type': 'application/json'}

        conn.request('POST', '/api/chat', small_body, headers)
        resp = conn.getresponse()
        resp.read()

        # Since _generator is not loaded in this class setup, the response might be 200 with '(no model loaded...)'
        # or similar, but crucially it should NOT be 413.
        self.assertNotEqual(resp.status, 413)
        conn.close()

if __name__ == '__main__':
    unittest.main()
