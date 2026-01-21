#!/usr/bin/env python3
"""
Simple proxy server to fetch fixtures CSV from football-data.co.uk and serve with CORS headers.
Usage: py -3 scripts\fixture_proxy.py
Serves on http://localhost:5000/fixtures
"""
import http.server
import socketserver
import urllib.request
import urllib.error
import subprocess
import json
import os
import sys

PORT = 5000
REMOTE_URL = 'https://www.football-data.co.uk/fixtures.csv'
ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(ROOT)
FETCH_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'fetch_and_update.py')
LOG_FILE = os.path.join(PROJECT_ROOT, 'scripts', 'fetch_and_update.log')

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/fixtures'):
            try:
                with urllib.request.urlopen(REMOTE_URL, timeout=20) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/csv; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
                    self.send_header('Cache-Control', 'max-age=300')
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        elif self.path == '/update-leagues':
            # only allow localhost
            client = self.client_address[0]
            if client not in ('127.0.0.1', '::1', 'localhost'):
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'forbidden'}).encode('utf-8'))
                return
            # run the fetch script as a background process
            try:
                subprocess.Popen([sys.executable, FETCH_SCRIPT], cwd=PROJECT_ROOT)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'started'}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        elif self.path == '/' or self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'Not found')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


if __name__ == '__main__':
    print(f'Starting proxy on http://localhost:{PORT} -> {REMOTE_URL}')
    with socketserver.TCPServer(('0.0.0.0', PORT), ProxyHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('Shutting down proxy')
            httpd.server_close()
