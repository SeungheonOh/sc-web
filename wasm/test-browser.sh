#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
test_dir=$(python3 -B wasm/paths.py test)
install_needed=0
cmp -s package-lock.json "$test_dir/package-lock.json" || install_needed=1
mkdir -p "$test_dir"
cp package.json package-lock.json "$test_dir/"
if [[ $install_needed == 1 || ! -d "$test_dir/node_modules/playwright-core" ]]; then
  npm ci --prefix "$test_dir" --ignore-scripts
fi
node wasm/check-browser.mjs
