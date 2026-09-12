#!/usr/bin/env python3
from pathlib import Path
import gzip
import hashlib
import json
import sys

root = Path(__file__).resolve().parent.parent
data = Path(sys.argv[1]).read_bytes()
if data[:4] != b'\0asm':
    raise SystemExit('Expected a WebAssembly executable')
compressed = gzip.compress(data, compresslevel=9, mtime=0)
(root / 'wasm/sc-tools.wasm').write_bytes(data)
(root / 'browser/sc-tools.wasm.gz').write_bytes(compressed)
metadata = {
    'upstreamCommit': '4546122230491db4839a4a42fc2bc601f7900909',
    'compiler': 'wasm32-wasi-ghc 9.12.4.20260731',
    'wasmBytes': len(data),
    'gzipBytes': len(compressed),
    'wasmSha256': hashlib.sha256(data).hexdigest(),
    'gzipSha256': hashlib.sha256(compressed).hexdigest(),
}
(root / 'browser/runtime-manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
