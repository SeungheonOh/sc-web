#!/usr/bin/env python3
"""Fetch public preprod parameters for the browser integration test fixture."""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.dont_write_bytecode = True
from paths import CACHE_ROOT

destination = CACHE_ROOT / 'evidence'
destination.mkdir(parents=True, exist_ok=True)
def fetch(name):
    url = 'https://preprod.koios.rest/api/v1/' + name
    with urllib.request.urlopen(url, timeout=30) as response:
        return name, json.load(response)
with ThreadPoolExecutor(max_workers=4) as pool:
    data = dict(pool.map(fetch, ['tip', 'genesis', 'era_summaries', 'cli_protocol_params']))
tip = data['tip'][0]
genesis = data['genesis'][0]
# Preprod's confirmed era transitions, from the provider. Slot arithmetic uses
# the genesis epoch lengths and the historical 20-second Byron slot length.
names = ['Byron', 'Shelley', 'Allegra', 'Mary', 'Alonzo', 'Babbage', 'Conway']
epochs = [0] + [next(e['epoch_no'] for e in data['era_summaries'] if e['era'] == name) for name in names[1:]]
epochs.append(tip['epoch_no'] + 2)
shelley = epochs[1]
length = int(genesis['epochlength'])
def bound(epoch):
    if epoch <= shelley:
        return {'epoch': epoch, 'slot': epoch * 21600, 'time': epoch * 432000}
    return {'epoch': epoch, 'slot': shelley * 21600 + (epoch - shelley) * length,
            'time': shelley * 432000 + (epoch - shelley) * length}
eras = [{'start': bound(start), 'end': bound(end), 'parameters': {'epoch_length': 21600 if i == 0 else length,
          'slot_length': 20 if i == 0 else 1, 'safe_zone': 4320}}
        for i, (start, end) in enumerate(zip(epochs, epochs[1:]))]
snapshot = {'network': 'preprod', 'protocolParameters': data['cli_protocol_params'], 'eraSummaries': eras,
            'systemStart': str(genesis['systemstart']), 'tip': {'slot': tip['abs_slot'], 'epoch': tip['epoch_no'], 'hash': tip['hash'], 'time': tip['block_time']},
            'fetchedAt': int(time.time() * 1000), 'source': 'Integration fixture: public Koios parameters and confirmed era transitions'}
(destination / 'test-chain.json').write_text(json.dumps(snapshot, indent=2) + '\n')
print('Fetched current preprod parameters for browser tests.')
