#!/usr/bin/env python3
"""Deploy the browser build with Wrangler; all generated files stay in the external cache."""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
sys.dont_write_bytecode = True
from paths import BROWSER, CACHE_ROOT, ROOT

manifest_path = BROWSER / 'runtime-manifest.json'
if not manifest_path.is_file() or not (BROWSER / 'sc-tools.wasm.gz').is_file():
    raise SystemExit('Build the WASM runtime first: bash wasm/build.sh')
manifest = json.loads(manifest_path.read_text())
if hashlib.sha256((BROWSER / 'sc-tools.wasm.gz').read_bytes()).hexdigest() != manifest['gzipSha256']:
    raise SystemExit('The WASM artifact does not match its build manifest. Rebuild before deploying.')
for path in (ROOT / 'browser').iterdir():
    if path.is_file(): shutil.copy2(path, BROWSER / path.name)
config_text = (ROOT / 'wrangler.jsonc').read_text()
# Keep JSON strings intact while accepting JSONC comments and trailing commas.
config_text = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/',
                     lambda m: m[0] if m[0].startswith('"') else ' ', config_text)
config_text = re.sub(r'"(?:\\.|[^"\\])*"|,\s*([}\]])',
                     lambda m: m[0] if m[0].startswith('"') else m[1], config_text)
config = json.loads(config_text)
config['assets']['directory'] = str(BROWSER)
staging = CACHE_ROOT / 'cloudflare'
staging.mkdir(parents=True, exist_ok=True)
config_path = staging / 'wrangler.json'
config_path.write_text(json.dumps(config, indent=2) + '\n')
if '--prepare' in sys.argv:
    print(config_path)
    raise SystemExit(0)
wrangler = shutil.which('wrangler') or str(CACHE_ROOT / 'cloudflare-cli/node_modules/.bin/wrangler')
if not Path(wrangler).is_file():
    raise SystemExit(f'Install Wrangler outside the source directory: npm install --prefix {CACHE_ROOT / "cloudflare-cli"} --save-dev wrangler@4.131.1')
args = [wrangler, 'deploy', '--config', str(config_path)]
if '--dry-run' in sys.argv: args += ['--dry-run', '--outdir', str(staging / 'dry-run')]
env = dict(os.environ, WRANGLER_SEND_METRICS='false', WRANGLER_LOG_PATH=str(staging / 'logs'))
raise SystemExit(subprocess.run(args, cwd=staging, env=env).returncode)
