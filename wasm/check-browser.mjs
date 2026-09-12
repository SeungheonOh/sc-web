import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const requests = [];
context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  const runtime = await page.evaluate(() => window.scTools.ready);
  assert.deepEqual([...new Set(runtime.imports.map(item => item.module))], ['wasi_snapshot_preview1']);
  // Load the executable, then cut off every network path before any transaction work.
  await context.setOffline(true);
  const networkBaseline = requests.length;
  const run = input => page.evaluate(values => window.scTools.runScenario(values), input);
  const success = await run({ amount: '10', datum: '42', redeemer: '42' });
  assert.equal(success.ok, true, success.error);
  assert.ok(success.portabilityChecks.length >= 12);
  for (const [name, passed] of success.portabilityChecks) assert.equal(passed, true, name);
  assert.equal(success.transactions.length, 2);
  assert.deepEqual(success.transactions.map(tx => tx.stage), ['lock', 'redeem']);
  for (const tx of success.transactions) {
    assert.equal(tx.ledgerAccepted, true);
    assert.match(tx.txId, /^[0-9a-f]{64}$/);
    assert.match(tx.cborHex, /^[0-9a-f]+$/);
    assert.equal(tx.cborHex.length / 2, tx.bytes);
    assert.ok(Number(tx.feeLovelace) > 0);
    assert.ok(tx.inputs.length > 0);
  }
  const executionEvents = success.trace.filter(event => event.tag === 'ExUnitsMap');
  assert.ok(executionEvents.some(event => event.exUnits?.length || event.contents?.length), 'Missing nonempty script execution budget');
  await mkdir('wasm/evidence', { recursive: true });
  await page.screenshot({ path: 'wasm/evidence/browser-success.png', fullPage: true });

  const mismatch = await run({ amount: '10', datum: '42', redeemer: '41' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.transactions.length, 1, 'Lock should succeed before the wrong redeemer fails');
  assert.match(mismatch.error, /ScriptExecution|Evaluation|script/i);

  const changed = await run({ amount: '12.345678', datum: '7', redeemer: '7' });
  assert.equal(changed.ok, true, changed.error);
  assert.notEqual(changed.transactions[0].txId, success.transactions[0].txId);
  assert.notEqual(changed.transactions[1].txId, success.transactions[1].txId);
  assert.equal(Number(changed.transactions[0].outputs[0].lovelace), 12345678);

  const insufficient = await run({ amount: '101', datum: '42', redeemer: '42' });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.transactions.length, 0);
  const tooSmall = await run({ amount: '0.01', datum: '42', redeemer: '42' });
  assert.equal(tooSmall.ok, false);

  const wideInteger = await run({ amount: '10', datum: '18446744073709551617', redeemer: '18446744073709551617' });
  assert.equal(wideInteger.ok, true, wideInteger.error);
  assert.equal(wideInteger.datum, '18446744073709551617');
  assert.notEqual(wideInteger.transactions[0].txId, success.transactions[0].txId);

  const repeat = await run({ amount: '10', datum: '42', redeemer: '42' });
  assert.equal(repeat.ok, true, repeat.error);
  assert.deepEqual(repeat.transactions.map(tx => tx.txId), success.transactions.map(tx => tx.txId));
  assert.equal(requests.length, networkBaseline, 'Transaction processing made a network request');
  assert.deepEqual(pageErrors, []);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile overflow');
  await page.screenshot({ path: 'wasm/evidence/browser-mobile.png', fullPage: true });
  const report = { browser: browser.version(), runtime, offline: true, transactionNetworkRequests: requests.slice(networkBaseline), pageErrors, success, mismatch, changed, insufficient, tooSmall, wideInteger, repeat };
  await writeFile('wasm/evidence/browser-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, offline: true, scenarios: 7, transactionNetworkRequests: 0, fees: success.transactions.map(tx => tx.feeLovelace), executionEvents }, null, 2));
} finally { await browser.close(); }
