const $ = id => document.getElementById(id);
const worker = new Worker('./worker.js', { type: 'module' });
let nextId = 1, lastResult, busy = false;
const pending = new Map();
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
ready.catch(() => {});

function status(text, state = '') { $('status').textContent = text; $('status').className = state; }
function download(name, blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ada(value) { return (Number(value) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
function render(result) {
  lastResult = result;
  $('transactions').replaceChildren();
  for (const tx of result.transactions || []) {
    const card = document.createElement('article'); card.className = 'transaction';
    card.innerHTML = '<div class="tx-heading"><h3></h3><span class="accepted">✓ Ledger accepted</span></div><div class="metrics"></div><div class="tx-id">TRANSACTION ID<code></code></div><details><summary>Outputs & transaction CBOR</summary><pre></pre></details><button class="secondary">Download signed transaction</button>';
    card.querySelector('h3').textContent = tx.stage === 'lock' ? '1. Lock funds in the contract' : '2. Spend from the contract';
    for (const [label, value] of [['Fee / ADA', ada(tx.feeLovelace)], ['Selected inputs', tx.inputs.length], ['Size / bytes', tx.bytes]]) {
      const metric = document.createElement('div'); metric.className = 'metric';
      const caption = document.createElement('span'), strong = document.createElement('strong');
      caption.textContent = label; strong.textContent = value; metric.append(caption, strong); card.querySelector('.metrics').append(metric);
    }
    card.querySelector('.tx-id code').textContent = tx.txId;
    card.querySelector('pre').textContent = JSON.stringify({ outputs: tx.outputs, cborHex: tx.cborHex }, null, 2);
    card.querySelector('button').onclick = () => download(`${tx.stage}.signed.json`, new Blob([JSON.stringify(tx.textEnvelope, null, 2)], { type: 'application/json' }));
    $('transactions').append(card);
  }
  $('duration').textContent = `${(result.elapsedMs / 1000).toFixed(2)} s in WASM`;
  $('trace').textContent = JSON.stringify(result.trace || [], null, 2);
  $('trace-count').textContent = `${(result.trace || []).length} events`;
  $('script').textContent = result.scriptCborHex || '';
  $('download').disabled = false;
  if (result.ok) status('Both transactions balanced, signed, and accepted by the local ledger.', 'success');
  else status(result.error || 'The transaction was rejected.', 'error');
}
function parseInputs({ amount, datum, redeemer }) {
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,6})?$/.test(amount.trim())) throw new Error('Enter an ADA amount with at most six decimal places.');
  const [whole, decimals = ''] = amount.trim().split('.');
  const lovelace = BigInt(whole) * 1000000n + BigInt(decimals.padEnd(6, '0'));
  if (lovelace <= 0n || lovelace > 1000000000000n) throw new Error('Enter an amount between 0.000001 and 1,000,000 ADA.');
  for (const value of [datum, redeemer]) if (typeof value !== 'string' || !/^-?\d{1,50}$/.test(value.trim())) throw new Error('The stored and supplied numbers must be integers of at most 50 digits.');
  return { amountLovelace: lovelace.toString(), datum: BigInt(datum.trim()).toString(), redeemer: BigInt(redeemer.trim()).toString() };
}
async function runScenario(values) {
  const inputs = parseInputs(values);
  await ready;
  if (busy) throw new Error('A scenario is already running.');
  busy = true; $('run').disabled = true; $('wrong-number').disabled = true;
  status('Building, balancing, and checking transactions in WebAssembly…');
  const id = nextId++;
  try {
    const result = await new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, ...inputs }); });
    render(result); return result;
  } catch (error) { status(error.message, 'error'); throw error; }
  finally { busy = false; $('run').disabled = false; $('wrong-number').disabled = false; }
}
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    $('runtime-state').textContent = 'WebAssembly ready'; $('run').disabled = false;
    status('Ready. Build and balance a pair of transactions.'); resolveReady(data); return;
  }
  if (data.type === 'load-error') { $('runtime-state').textContent = 'Runtime unavailable'; status(data.error, 'error'); rejectReady(new Error(data.error)); return; }
  const request = pending.get(data.id); if (!request) return; pending.delete(data.id);
  if (data.type === 'result') request.resolve(data.result); else request.reject(new Error(data.error));
};
worker.onerror = event => { status(event.message || 'The WASM worker stopped unexpectedly.', 'error'); rejectReady(new Error(event.message)); for (const request of pending.values()) request.reject(new Error(event.message)); pending.clear(); };
$('scenario').onsubmit = async event => {
  event.preventDefault();
  try { await runScenario({ amount: $('amount').value, datum: $('datum').value, redeemer: $('redeemer').value }); }
  catch (error) { status(error.message, 'error'); }
};
$('wrong-number').onclick = () => { try { $('redeemer').value = (BigInt($('datum').value) + 1n).toString(); $('scenario').requestSubmit(); } catch { status('Enter a valid stored number first.', 'error'); } };
$('download').onclick = () => download('sc-tools-browser-result.json', new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' }));
window.scTools = { ready, runScenario, get lastResult() { return lastResult; } };
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  Promise.resolve(document.modelContext.registerTool({
    name: 'build_and_balance_contract_transactions', title: 'Build and balance contract transactions',
    description: 'Run the sc-tools WASM lock-and-spend scenario on the browser-local test ledger and show its results.',
    inputSchema: { type: 'object', properties: { amount: { type: 'string' }, datum: { type: 'string' }, redeemer: { type: 'string' } }, required: ['amount', 'datum', 'redeemer'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) { parseInputs(input); for (const name of ['amount','datum','redeemer']) $(name).value = input[name]; const result = await runScenario(input); return { ok: result.ok, error: result.error, transactions: result.transactions.map(tx => ({ txId: tx.txId, feeLovelace: tx.feeLovelace })) }; },
  }, { signal: lifecycle.signal })).catch(console.error);
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
