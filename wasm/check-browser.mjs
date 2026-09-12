import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  wallet,
  refs,
  policy,
  script,
  payment,
  stake,
  rewardAddress,
  hex,
  utxo,
  witnessSet,
} from "./test-fixtures.mjs";
const cache = execFileSync(
  "python3",
  ["-B", fileURLToPath(new URL("./paths.py", import.meta.url)), "cache"],
  { encoding: "utf8" },
).trim();
const { chromium } = createRequire(join(cache, "browser-test/package.json"))(
  "playwright-core",
);
const evidence = join(cache, "evidence");
await mkdir(evidence, { recursive: true });
execFileSync(
  "python3",
  ["-B", fileURLToPath(new URL("./fetch-test-chain.py", import.meta.url))],
  { stdio: "inherit" },
);
const chain = JSON.parse(
  await readFile(join(evidence, "test-chain.json"), "utf8"),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 1050 },
});
const page = await context.newPage();
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
context.on("request", (r) =>
  requests.push({ url: r.url(), method: r.method() }),
);
await page.exposeFunction("fixtureSignature", (txid) => witnessSet(txid));
await page.addInitScript((w) => {
  window.walletCalls = { enable: 0, sign: 0, submit: 0 };
  window.cardano = {
    fixture: {
      name: "CIP-30 integration fixture",
      apiVersion: "1",
      enable: async () => {
        window.walletCalls.enable++;
        return {
          getNetworkId: async () => w.networkId,
          getChangeAddress: async () => w.changeAddress,
          getUtxos: async () => w.utxos,
          getRewardAddresses: async () => w.rewardAddresses,
          getCollateral: async () => [],
          signTx: async (cbor, partial) => {
            window.walletCalls.sign++;
            window.walletCalls.partial = partial;
            const r = await window.scTools.run({ action: "inspect", cbor });
            return window.fixtureSignature(r.transaction.txId);
          },
          submitTx: async (cbor) => {
            window.walletCalls.submit++;
            return (await window.scTools.run({ action: "inspect", cbor }))
              .transaction.txId;
          },
        };
      },
    },
  };
}, wallet);
const results = {};
try {
  await page.goto(process.env.DEMO_URL || "http://127.0.0.1:4173", {
    waitUntil: "networkidle",
  });
  const runtime = await page.evaluate(() => window.scTools.ready);
  assert.deepEqual(
    [...new Set(runtime.imports.map((i) => i.module))],
    ["wasi_snapshot_preview1"],
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "CIP-30 integration fixture", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#wallet-name").textContent ===
      "CIP-30 integration fixture",
  );
  assert.match(
    await page.locator("#wallet-detail").textContent(),
    /110\.000000 ADA/,
  );
  await page.locator('#catalog [data-add="input"]').click();
  const spendingInput = page.locator('[data-section="inputs"] .block');
  assert.equal(
    await spendingInput.locator("[data-input-source]").inputValue(),
    "wallet",
  );
  assert.equal(
    await spendingInput.locator('[data-field="witnessMode"]').count(),
    0,
  );
  assert.equal(await spendingInput.locator('[data-field="input"]').count(), 0);
  await spendingInput
    .locator('[data-action="select-utxo"]')
    .selectOption(refs[0]);
  assert.equal(
    await spendingInput.locator('[data-action="select-utxo"]').inputValue(),
    refs[0],
  );
  await spendingInput.locator("[data-input-source]").selectOption("script");
  assert.equal(
    await spendingInput.locator('[data-action="select-utxo"]').count(),
    0,
  );
  assert.equal(
    await spendingInput.locator('[data-field="input"]').inputValue(),
    "",
  );
  assert.equal(
    await spendingInput
      .locator('[data-field="witnessMode"] option[value="Key"]')
      .count(),
    0,
  );
  await spendingInput.locator('[data-field="input"]').fill(refs[1]);
  await spendingInput
    .locator('[data-field="witnessMode"]')
    .selectOption("Native");
  await spendingInput.locator("[data-input-source]").selectOption("wallet");
  assert.equal(
    await spendingInput.locator('[data-action="select-utxo"]').inputValue(),
    refs[0],
  );
  assert.equal(
    await spendingInput.locator('[data-field="nativeScript"]').count(),
    0,
  );
  await spendingInput.locator("[data-input-source]").selectOption("script");
  assert.equal(
    await spendingInput.locator('[data-field="input"]').inputValue(),
    refs[1],
  );
  assert.equal(
    await spendingInput.locator('[data-field="witnessMode"]').inputValue(),
    "Native",
  );
  await spendingInput.locator('[data-action="remove"]').click();
  await page.locator("#provider").selectOption("snapshot");
  await page
    .locator("#snapshot-file")
    .setInputFiles(join(evidence, "test-chain.json"));
  await page.waitForFunction(() =>
    document.querySelector("#chain-status").textContent.startsWith("Imported"),
  );
  await page
    .getByRole("button", { name: "Use wallet address", exact: true })
    .click();
  await page.locator('[data-section="outputs"] [data-field="ada"]').fill("10");
  await page.locator("[data-asset-wallet]").selectOption("0");
  await page.locator('[data-asset-field="quantity"]').fill("1.5");
  assert.match(
    await page.locator(".asset-validation").textContent(),
    /positive whole quantity/,
  );
  await page.locator('[data-asset-field="quantity"]').fill("4");
  await page.locator("[data-asset-encoding]").selectOption("hex");
  assert.equal(
    await page.locator('[data-asset-field="assetName"]').inputValue(),
    "546f6b656e",
  );
  await page.locator("[data-asset-encoding]").selectOption("text");
  assert.equal(
    await page.locator('[data-asset-field="assetName"]').inputValue(),
    "Token",
  );
  await page
    .locator('[data-section="outputs"] [data-field="datumMode"]')
    .selectOption("inline");
  await page
    .locator('[data-section="outputs"] [data-field="datum"]')
    .fill(
      '{"constructor":0,"fields":[{"int":18446744073709551617},{"bytes":"48656c6c6f"}]}',
    );
  // Every request is cut off before any transaction building, balancing, or signing.
  await context.setOffline(true);
  const baseline = requests.length;
  await page.locator("#balance").click();
  await page.waitForFunction(
    () =>
      window.scTools.result ||
      document.querySelector("#message").classList.contains("error"),
  );
  results.ui = await page.evaluate(() => window.scTools.result);
  assert.ok(results.ui, await page.locator("#message").textContent());
  assert.equal(results.ui.transaction.witnesses, 0);
  assert.equal(results.ui.transaction.outputs[0].lovelace, "10000000");
  assert.deepEqual(
    await page.locator(".transaction-section h2").allTextContents(),
    ["Inputs", "Outputs"],
  );
  const inputColumn = await page
    .locator('[data-section="inputs"]')
    .boundingBox();
  const outputColumn = await page
    .locator('[data-section="outputs"]')
    .boundingBox();
  assert.ok(outputColumn.x >= inputColumn.x + inputColumn.width);
  assert.ok(Math.abs(outputColumn.y - inputColumn.y) < 1);
  assert.equal(results.ui.transaction.outputs[0].assets[0].quantity, "4");
  assert.equal(results.ui.change.assets[0].quantity, "6");
  assert.equal(
    results.ui.transaction.outputs[0].datum.fields[0].int,
    "18446744073709551617",
  );
  assert.match(await page.locator("#review-inputs").textContent(), /Token/);
  assert.match(
    await page.locator("#review-outputs").textContent(),
    /Constructor 0/,
  );
  assert.match(
    await page.locator("#review-outputs").textContent(),
    /18446744073709551617/,
  );
  assert.match(await page.locator("#review-outputs").textContent(), /Hello/);
  assert.match(
    await page.locator("#review-complete").textContent(),
    /Script validity flag/,
  );
  assert.match(
    await page.locator("#review-witnesses").textContent(),
    /Witnesses/,
  );
  const inspector = page.locator("#transaction-inspector");
  const composerWidth = (await page.locator(".composer").boundingBox()).width;
  await page.locator("#inspector-hide").click();
  assert.equal(await inspector.isVisible(), false);
  assert.equal(
    await page.locator("#inspector-toggle").getAttribute("aria-expanded"),
    "false",
  );
  assert.ok(
    (await page.locator(".composer").boundingBox()).width > composerWidth,
  );
  assert.equal(
    (await page.evaluate(() => window.scTools.result)).transaction.txId,
    results.ui.transaction.txId,
  );
  await page.locator("#inspector-toggle").click();
  assert.equal(await inspector.getAttribute("data-mode"), "docked");
  assert.match(
    await page.locator("#review-outputs").textContent(),
    /Constructor 0/,
  );
  await page.locator("#inspector-full").click();
  assert.equal(await inspector.getAttribute("data-mode"), "full");
  assert.equal((await inspector.boundingBox()).width, 1512);
  assert.equal(
    await page
      .locator(".review-flow")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  await page.screenshot({
    path: join(evidence, "transaction-review-full.png"),
  });
  await page.locator("#inspector-hide").click();
  assert.equal(await inspector.isVisible(), false);
  assert.equal(await page.locator(".composer").evaluate((e) => e.inert), false);
  assert.equal(
    await page
      .locator("body")
      .evaluate((e) => e.classList.contains("inspector-full")),
    false,
  );
  await page.locator("#inspector-toggle").click();
  assert.equal(await inspector.getAttribute("data-mode"), "full");
  await page.locator("#inspector-full").click();
  await page.locator("#inspector-float").click();
  const beforeMove = await inspector.boundingBox();
  await page.locator("#inspector-hide").click();
  assert.equal(await inspector.isVisible(), false);
  await page.locator("#inspector-toggle").click();
  assert.equal(await inspector.getAttribute("data-mode"), "floating");
  assert.deepEqual(await inspector.boundingBox(), beforeMove);
  const title = await page.locator(".inspector-titlebar h2").boundingBox();
  await page.mouse.move(title.x + 20, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x - 80, title.y + 48);
  await page.mouse.up();
  const afterMove = await inspector.boundingBox();
  assert.ok(afterMove.x < beforeMove.x);
  assert.ok(afterMove.y > beforeMove.y);
  const handle = await page.locator(".inspector-resize").boundingBox();
  await page.mouse.move(handle.x + 10, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 110, handle.y + 55);
  await page.mouse.up();
  assert.ok((await inspector.boundingBox()).width > afterMove.width);
  await page.locator("#inspector-full").click();
  await page.keyboard.press("Escape");
  assert.equal(await inspector.getAttribute("data-mode"), "floating");
  await page.locator("#inspector-float").click();
  const docked = await inspector.boundingBox();
  await page.locator(".inspector-divider").focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok((await inspector.boundingBox()).width > docked.width);
  const run = (request) => page.evaluate((p) => window.scTools.run(p), request);
  const out = (lovelace = "10000000", extra = {}) => ({
    type: "output",
    output: {
      address: wallet.changeAddress,
      lovelace,
      assets: [],
      datumMode: "none",
      ...extra,
    },
  });
  const balance = async (name, blocks, extra = {}, ok = true) => {
    const r = await run({ action: "balance", wallet, chain, blocks, ...extra });
    assert.equal(r.ok, ok, `${name}: ${r.error}`);
    results[name] = r;
    return r;
  };
  const checkAda = (r) =>
    assert.equal(
      r.selectedInputs.reduce((n, u) => n + BigInt(u.output.lovelace), 0n),
      r.transaction.outputs.reduce((n, o) => n + BigInt(o.lovelace), 0n) +
        BigInt(r.transaction.feeLovelace),
    );
  checkAda(results.ui);
  await page.locator("#sign").click();
  await page.waitForFunction(
    () =>
      window.scTools.signed ||
      document.querySelector("#message").classList.contains("error"),
  );
  const signed = await page.evaluate(() => window.scTools.signed);
  assert.ok(signed, await page.locator("#message").textContent());
  assert.equal(signed.transaction.txId, results.ui.transaction.txId);
  assert.equal(signed.transaction.witnesses, 1);
  assert.equal((await page.evaluate(() => window.walletCalls)).submit, 0);
  await page.locator('[data-section="outputs"] [data-field="ada"]').fill("12");
  assert.equal(await page.evaluate(() => window.scTools.result), null);
  assert.equal(await page.locator("#result-actions").isVisible(), false);
  const multi = await balance("tokens", [
    out("5000000", {
      assets: [
        {
          policyId: policy,
          assetName: Buffer.from("Token").toString("hex"),
          quantity: "4",
        },
      ],
    }),
  ]);
  checkAda(multi);
  assert.equal(multi.change.assets[0].quantity, "6");
  const metadata = await balance("metadata", [
    out(),
    { type: "metadata", metadata: '{"674":{"msg":["integration test"]}}' },
    { type: "signer", keyHash: payment.hash.toString("hex") },
    {
      type: "validity",
      from: String(chain.tip.slot),
      until: String(chain.tip.slot + 1200),
    },
  ]);
  assert.equal(metadata.transaction.metadata["674"].msg[0], "integration test");
  checkAda(metadata);
  const reference = await balance("reference", [
    out(),
    { type: "reference", input: refs[0] },
  ]);
  assert.ok(!reference.transaction.inputs.includes(refs[0]));
  assert.deepEqual(reference.transaction.referenceInputs, [refs[0]]);
  checkAda(reference);
  const mint = await balance(
    "mint",
    [
      out(),
      {
        type: "mint",
        policyId: policy,
        assets: [{ assetName: "4e6577", quantity: "2" }],
        witness: script,
      },
    ],
    { additionalWitnesses: 1 },
  );
  assert.equal(
    mint.change.assets.find((a) => a.assetName === "4e6577").quantity,
    "2",
  );
  checkAda(mint);
  await balance(
    "wrongPolicy",
    [
      out(),
      {
        type: "mint",
        policyId: "99".repeat(28),
        assets: [{ assetName: "", quantity: "1" }],
        witness: script,
      },
    ],
    {},
    false,
  );
  const burn = await balance(
    "burn",
    [
      out(),
      {
        type: "mint",
        policyId: policy,
        assets: [
          { assetName: Buffer.from("Token").toString("hex"), quantity: "-3" },
        ],
        witness: script,
      },
    ],
    { additionalWitnesses: 1 },
  );
  assert.equal(burn.change.assets[0].quantity, "7");
  checkAda(burn);
  const withdrawal = await balance("withdrawal", [
    out(),
    { type: "withdrawal", address: rewardAddress, lovelace: "3000000" },
  ]);
  assert.equal(withdrawal.transaction.withdrawals[0].lovelace, "3000000");
  assert.equal(withdrawal.witnessEstimate, 2);
  const registration = await balance("registration", [
    out(),
    {
      type: "certificate",
      kind: "register",
      credential: stake.hash.toString("hex"),
    },
  ]);
  assert.equal(registration.transaction.certificates.length, 1);
  await balance("deregistration", [
    out(),
    {
      type: "certificate",
      kind: "deregister",
      credential: stake.hash.toString("hex"),
    },
  ]);
  await balance("delegation", [
    out(),
    {
      type: "certificate",
      kind: "delegate",
      credential: stake.hash.toString("hex"),
      poolId: "44".repeat(28),
    },
  ]);
  await balance("auxiliary", [out(), { type: "auxiliary", script }]);
  const donation = await balance("donation", [
    out(),
    { type: "treasury", lovelace: "2000000" },
  ]);
  assert.equal(donation.transaction.treasuryDonation, "2000000");
  const voteCbor = hex(
    new Map([
      [
        [2, payment.hash],
        new Map([
          [
            [Buffer.alloc(32, 0x77), 0],
            [1, null],
          ],
        ]),
      ],
    ]),
  );
  await balance("vote", [out(), { type: "vote", cbor: voteCbor }], {
    additionalWitnesses: 1,
  });
  const proposalCbor = hex([
    BigInt(chain.protocolParameters.govActionDeposit),
    Buffer.from(rewardAddress, "hex"),
    [6],
    ["https://example.com/governance", Buffer.alloc(32, 0x88)],
  ]);
  await balance("proposal", [out(), { type: "proposal", cbor: proposalCbor }], {
    wallet: { ...wallet, utxos: [utxo(refs[0], 3000000000n)] },
  });
  await balance("minimumAda", [out("10000")], {}, false);
  await balance("insufficient", [out("120000000")], {}, false);
  await balance(
    "missingInput",
    [out(), { type: "input", input: "ff".repeat(32) + "#0" }],
    {},
    false,
  );
  await balance(
    "duplicateInput",
    [
      out(),
      { type: "input", input: refs[1] },
      { type: "input", input: refs[1] },
    ],
    {},
    false,
  );
  await balance(
    "overlapReference",
    [
      out(),
      { type: "input", input: refs[1] },
      { type: "reference", input: refs[1] },
    ],
    {},
    false,
  );
  await balance(
    "wrongNetwork",
    [out()],
    { chain: { ...chain, network: "mainnet" } },
    false,
  );
  // Instantiate the regression entry point to obtain the actual compiled minimal
  // validator. This fixture is never shown or offered in the product interface.
  assert.equal(
    requests.length,
    baseline,
    "Transaction work made a network request before fixture reload",
  );
  await context.setOffline(false);
  const legacy = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker("./worker.js", { type: "module" });
        worker.onmessage = ({ data }) => {
          if (data.type === "ready")
            worker.postMessage({
              id: 1,
              amountLovelace: "10000000",
              datum: "42",
              redeemer: "42",
            });
          else if (data.type === "result") {
            worker.terminate();
            resolve(data.result);
          } else if (data.type === "error" || data.type === "load-error") {
            worker.terminate();
            reject(new Error(data.error));
          }
        };
      }),
  );
  assert.equal(legacy.ok, true, legacy.error);
  assert.equal(legacy.portabilityChecks.length, 12);
  const afterFixtureLoad = requests.length;
  await context.setOffline(true);
  const scriptRef = "55".repeat(32) + "#0";
  const lockedOutput = {
    address: legacy.transactions[0].outputs[0].address,
    lovelace: "10000000",
    assets: [],
    datumMode: "inline",
    datum: { int: 42 },
  };
  const scriptWitness = {
    language: "PlutusV2",
    scriptCbor: legacy.scriptCborHex,
    redeemer: { int: 42 },
  };
  const plutus = await balance(
    "plutusSpend",
    [
      out(),
      { type: "input", input: scriptRef, witness: scriptWitness },
      { type: "collateral", input: refs[2] },
    ],
    { resolvedInputs: [{ input: scriptRef, output: lockedOutput }] },
  );
  assert.ok(
    plutus.trace.some((e) => e.tag === "ExUnitsMap" && e.exUnits.length),
  );
  assert.equal(plutus.transaction.collateralInputs.length, 1);
  assert.ok(
    BigInt(plutus.transaction.totalCollateral) >=
      (BigInt(plutus.transaction.feeLovelace) *
        BigInt(chain.protocolParameters.collateralPercentage) +
        99n) /
        100n,
  );
  await balance(
    "plutusWrongRedeemer",
    [
      out(),
      {
        type: "input",
        input: scriptRef,
        witness: { ...scriptWitness, redeemer: { int: 41 } },
      },
      { type: "collateral", input: refs[2] },
    ],
    { resolvedInputs: [{ input: scriptRef, output: lockedOutput }] },
    false,
  );
  const bigDatum = await balance("bigDatum", [
    out("3000000", {
      datumMode: "inline",
      datum: '{"int":18446744073709551617}',
    }),
  ]);
  assert.match(bigDatum.transaction.cborHex, /c24[0-9a-f]/);
  assert.equal(
    bigDatum.transaction.outputs[0].datum.int,
    "18446744073709551617",
  );
  assert.equal(
    requests.length,
    afterFixtureLoad,
    "Transaction work made a network request",
  );
  // Check that the actual UI renders the requested categories and invalidates
  // signing on edit, and that the draft survives export/import unchanged.
  await page.locator('#catalog [data-add="withdrawal"]').click();
  assert.ok(
    (await page.locator(".transaction-section h2").allTextContents()).includes(
      "Withdrawals",
    ),
  );
  await page
    .locator('[data-section="withdrawals"] [data-action="remove"]')
    .click();
  await page.locator("#balance").click();
  await page.waitForFunction(
    () =>
      window.scTools.result ||
      document.querySelector("#message").classList.contains("error"),
  );
  assert.ok(
    await page.evaluate(() => window.scTools.result),
    await page.locator("#message").textContent(),
  );
  await page.screenshot({
    path: join(evidence, "editor-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileInputs = await page
    .locator('[data-section="inputs"]')
    .boundingBox();
  const mobileOutputs = await page
    .locator('[data-section="outputs"]')
    .boundingBox();
  assert.ok(mobileOutputs.y >= mobileInputs.y + mobileInputs.height);
  await page.locator("#inspector-hide").click();
  assert.equal(await inspector.isVisible(), false);
  await page.locator("#inspector-toggle").click();
  assert.equal(await inspector.isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(evidence, "editor-mobile.png"),
    fullPage: true,
  });
  // JSON clipboard and file imports share the same validated, atomic update.
  const originalRecipe = await page.evaluate(() => window.scTools.recipe);
  const originalTxId = await page.evaluate(
    () => window.scTools.result.transaction.txId,
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.locator("#export-recipe").click();
  const exportedJson = await page.locator("#export-json").inputValue();
  assert.deepEqual(
    JSON.parse(exportedJson).blocks,
    originalRecipe.map(({ type, data }) => ({ type, data })),
  );
  await page.locator("#copy-recipe-json").click();
  await page.waitForFunction(
    () => document.querySelector("#copy-recipe-json").textContent === "Copied",
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    exportedJson,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-recipe-json").click();
  const recipeDownload = await downloadEvent;
  assert.equal(
    await readFile(await recipeDownload.path(), "utf8"),
    exportedJson,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Clipboard denied for test")),
    }),
  );
  await page.locator("#copy-recipe-json").click();
  await page.waitForFunction(() =>
    document.querySelector("#export-message").textContent.includes("Ctrl+C"),
  );
  assert.equal(
    await page
      .locator("#export-json")
      .evaluate((e) => e.selectionEnd - e.selectionStart),
    exportedJson.length,
  );
  await page.evaluate(() => {
    delete navigator.clipboard.writeText;
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#close-export").click();
  await page.locator("#import-recipe").click();
  const invalidRecipes = [
    "",
    "{",
    "null",
    JSON.stringify({ ...JSON.parse(exportedJson), blocks: [null] }),
    JSON.stringify({ ...JSON.parse(exportedJson), additionalWitnesses: -1 }),
  ];
  for (const invalidJson of invalidRecipes) {
    await page.locator("#import-json").fill(invalidJson);
    await page.locator("#import-json-submit").click();
    assert.equal(await page.locator("#import-error").isVisible(), true);
    assert.deepEqual(
      await page.evaluate(() => window.scTools.recipe),
      originalRecipe,
    );
    assert.equal(
      await page.evaluate(() => window.scTools.result.transaction.txId),
      originalTxId,
    );
  }
  await page.locator("#import-json").fill("");
  await page.locator("#import-json").focus();
  await page.keyboard.press("Control+V");
  assert.equal(await page.locator("#import-json").inputValue(), exportedJson);
  await page.locator("#import-json-submit").click();
  assert.equal(await page.locator("#import-dialog").isVisible(), false);
  assert.equal(await page.evaluate(() => window.scTools.result), null);
  assert.equal(await page.evaluate(() => window.scTools.signed), null);
  assert.deepEqual(
    await page.evaluate(() =>
      window.scTools.recipe.map(({ type, data }) => ({ type, data })),
    ),
    JSON.parse(exportedJson).blocks,
  );
  await page.locator("#import-recipe").click();
  const fileChooserEvent = page.waitForEvent("filechooser");
  await page.locator("#import-json-file").click();
  const recipeChooser = await fileChooserEvent;
  await recipeChooser.setFiles({
    name: "transaction.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportedJson),
  });
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.scTools.recipe.map(({ type, data }) => ({ type, data })),
    ),
    JSON.parse(exportedJson).blocks,
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    browser: browser.version(),
    runtime,
    fixture:
      "CIP-30 adapter with deterministic test keys and synthetic UTXOs; current preprod protocol parameters",
    offlineTransactionProcessing: true,
    cases: Object.keys(results).length,
    results,
    signed,
    walletCalls: await page.evaluate(() => window.walletCalls),
    pageErrors: errors,
    initialRequests: baseline,
  };
  await writeFile(
    join(evidence, "editor-results.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        cases: report.cases,
        offline: true,
        walletCalls: report.walletCalls,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
