#!/usr/bin/env python3
"""Serve the generated browser demo from the external build cache."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import sys

sys.dont_write_bytecode = True
from paths import BROWSER

if not (BROWSER / 'sc-tools.wasm.gz').is_file():
    raise SystemExit('Build the WASM module with bash wasm/build.sh first.')
port = int(os.environ.get('PORT', '4173'))
server = ThreadingHTTPServer(('127.0.0.1', port), partial(SimpleHTTPRequestHandler, directory=str(BROWSER)))
print(f'Serving {BROWSER} at http://127.0.0.1:{port}/', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
