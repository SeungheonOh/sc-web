import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  wallet,
  refs,
  policy,
  payment,
  hex,
  witnessSet,
} from "./test-fixtures.mjs";

const cache = execFileSync(
  "python3",
  ["-B", fileURLToPath(new URL("./paths.py", import.meta.url)), "cache"],
  { encoding: "utf8" },
).trim();
execFileSync(
  "python3",
  ["-B", fileURLToPath(new URL("./fetch-test-chain.py", import.meta.url))],
  { stdio: "inherit" },
);
const chain = JSON.parse(
  await readFile(join(cache, "evidence/test-chain.json"), "utf8"),
);
const { chromium } = createRequire(join(cache, "browser-test/package.json"))(
  "playwright-core",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 1050 },
});
const page = await context.newPage();
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
context.on("request", (r) => requests.push(r.url()));

// Only the wallet/chain boundary is synthetic. Each transaction, fee, script
// evaluation and witness merge below is produced by the real browser WASM.
const walletOutputs = new Map(refs.map((ref, i) => [ref, wallet.utxos[i]]));
const scriptOutputs = new Map();
let walletAddress;
const calls = { sign: 0, submit: 0 };
function walletCbor(input, output) {
  const policies = new Map();
  for (const asset of output.assets) {
    if (!policies.has(asset.policyId)) policies.set(asset.policyId, new Map());
    policies
      .get(asset.policyId)
      .set(Buffer.from(asset.assetName, "hex"), BigInt(asset.quantity));
  }
  const value = policies.size
    ? [
        BigInt(output.lovelace),
        new Map(
          [...policies].map(([p, names]) => [Buffer.from(p, "hex"), names]),
        ),
      ]
    : BigInt(output.lovelace);
  const [txid, index] = input.split("#");
  return hex([
    [Buffer.from(txid, "hex"), Number(index)],
    [Buffer.from(wallet.changeAddress, "hex"), value],
  ]);
}
await page.exposeFunction("fixtureUtxos", () => [...walletOutputs.values()]);
await page.exposeFunction("fixtureSign", (txid) => {
  calls.sign++;
  return witnessSet(txid);
});
await page.exposeFunction("fixtureSubmit", (transaction) => {
  calls.submit++;
  for (const ref of transaction.inputs) {
    walletOutputs.delete(ref);
    scriptOutputs.delete(ref);
  }
  transaction.outputs.forEach((output, i) => {
    const input = `${transaction.txId}#${i}`;
    if (output.address === walletAddress)
      walletOutputs.set(input, walletCbor(input, output));
    else
      scriptOutputs.set(input, {
        input,
        output: { ...output, datumMode: "inline" },
      });
  });
  return transaction.txId;
});
await page.addInitScript((w) => {
  window.cardano = {
    fixture: {
      name: "Example test wallet",
      apiVersion: "1",
      enable: async () => ({
        getNetworkId: async () => w.networkId,
        getChangeAddress: async () => w.changeAddress,
        getUtxos: () => window.fixtureUtxos(),
        getRewardAddresses: async () => w.rewardAddresses,
        getCollateral: async () => [],
        signTx: async (cbor) =>
          window.fixtureSign(
            (await window.scTools.run({ action: "inspect", cbor })).transaction
              .txId,
          ),
        submitTx: async (cbor) =>
          window.fixtureSubmit(
            (await window.scTools.run({ action: "inspect", cbor })).transaction,
          ),
      }),
    },
  };
}, wallet);

const open = async (kind) => {
  await page.locator("#examples").click();
  await page.locator("#example-kind").selectOption(kind);
};
const load = async () => {
  await page.locator("#example-load").click();
  await page.waitForFunction(
    () => !document.querySelector("#example-load").disabled,
  );
  assert.equal(
    await page.locator("#example-error").isVisible(),
    false,
    await page.locator("#example-error").textContent(),
  );
  assert.equal(await page.locator("#examples-dialog").isVisible(), false);
  assert.equal(await page.evaluate(() => window.scTools.result), null);
};
async function balance(ok = true) {
  await page.locator("#balance").click();
  await page.waitForFunction(
    () => !document.querySelector("#balance").disabled,
  );
  const result = await page.evaluate(() => window.scTools.result);
  assert.equal(
    Boolean(result?.ok),
    ok,
    await page.locator("#message").textContent(),
  );
  return result;
}
async function submit() {
  await page.locator("#sign").click();
  await page.waitForFunction(() => !document.querySelector("#sign").disabled);
  assert.ok(
    await page.evaluate(() => window.scTools.signed),
    await page.locator("#message").textContent(),
  );
  await page.locator("#submit").click();
  await page.waitForFunction(() => !document.querySelector("#submit").disabled);
  assert.match(
    await page.locator("#message").textContent(),
    /Submitted to preprod/,
  );
}
async function refresh() {
  await page.locator("#snapshot-file").setInputFiles({
    name: "example-chain.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...chain,
        fetchedAt: Date.now(),
        resolvedInputs: [...scriptOutputs.values()],
      }),
    ),
  });
  await page.waitForFunction(() =>
    document.querySelector("#chain-status").textContent.startsWith("Imported"),
  );
  await page.evaluate(async () =>
    document.querySelector("#refresh-wallet").onclick(),
  );
}

try {
  await page.goto(process.env.DEMO_URL || "http://127.0.0.1:4173", {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => window.scTools.ready);
  await open("lock");
  await page.locator("#example-load").click();
  assert.match(
    await page.locator("#example-error").textContent(),
    /Connect your testnet wallet/,
  );
  await page.locator("#close-examples").click();
  await page.locator("#connect").click();
  await page
    .getByRole("button", { name: "Example test wallet", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#wallet-name").textContent ===
      "Example test wallet",
  );
  walletAddress = (
    await page.evaluate(
      (w) => window.scTools.run({ action: "wallet", ...w }),
      wallet,
    )
  ).changeAddress;
  await page.locator("#provider").selectOption("snapshot");
  await refresh();
  await context.setOffline(true);
  const baseline = requests.length;
  const scripts = await page.evaluate(
    (paymentKeyHash) =>
      window.scTools.run({
        action: "exampleScripts",
        network: "preprod",
        paymentKeyHash,
      }),
    payment.hash.toString("hex"),
  );
  assert.equal(scripts.ok, true, scripts.error);
  assert.equal(scripts.nativeSignature.policyId, policy);
  assert.match(scripts.matchingNumber.address, /^addr_test/);

  await open("lock");
  const beforeCancel = await page.evaluate(() => window.scTools.recipe);
  await page.evaluate(() => {
    document.querySelector("#example-load").click();
    document.querySelector("#close-examples").click();
  });
  await page.waitForFunction(
    () => !document.querySelector("#example-load").disabled,
  );
  assert.deepEqual(
    await page.evaluate(() => window.scTools.recipe),
    beforeCancel,
  );

  await page.locator("#network").selectOption("mainnet");
  await open("lock");
  const before = await page.evaluate(() => window.scTools.recipe);
  await page.locator("#example-load").click();
  await page.waitForFunction(
    () => !document.querySelector("#example-load").disabled,
  );
  assert.match(
    await page.locator("#example-error").textContent(),
    /Preprod or Preview/,
  );
  assert.deepEqual(await page.evaluate(() => window.scTools.recipe), before);
  await page.locator("#close-examples").click();
  await page.locator("#network").selectOption("preprod");
  await refresh();

  await open("collateral");
  await load();
  assert.equal((await balance()).transaction.outputs[0].lovelace, "5000000");
  assert.deepEqual(calls, { sign: 0, submit: 0 });

  await open("lock");
  await load();
  const locked = await balance();
  assert.equal(
    locked.transaction.outputs[0].address,
    scripts.matchingNumber.address,
  );
  assert.equal(locked.transaction.outputs[0].datum.int, 42);
  await page.locator("#export-recipe").click();
  const exported = JSON.parse(await page.locator("#export-json").inputValue());
  assert.equal(exported.blocks[0].data.datum, '{"int":42}');
  await page.locator("#close-export").click();
  await submit();
  const lockRef = `${locked.transaction.txId}#0`;
  assert.equal(
    JSON.parse(
      await page.evaluate(() =>
        sessionStorage.getItem("sc-tools-example-receipts-v1"),
      ),
    ).lock.input,
    lockRef,
  );
  await refresh();
  await open("unlock");
  assert.equal(await page.locator("#example-input").inputValue(), lockRef);
  await page.locator("#example-redeemer").fill("41");
  await load();
  await balance(false);
  await open("unlock");
  await load();
  const unlocked = await balance();
  assert.ok(unlocked.transaction.inputs.includes(lockRef));
  assert.ok(
    unlocked.trace.some((e) => e.tag === "ExUnitsMap" && e.exUnits.length),
  );
  await submit();
  await refresh();

  for (const type of ["native", "plutus"]) {
    await open(`${type}-mint`);
    await page
      .locator("#example-token")
      .fill(type === "native" ? "Example café" : "RedeemerToken");
    await load();
    const minted = await balance();
    const expectedPolicy =
      type === "native"
        ? scripts.nativeSignature.policyId
        : scripts.redeemer42.policyId;
    assert.equal(minted.transaction.mint[0].policyId, expectedPolicy);
    assert.equal(minted.transaction.mint[0].quantity, "100");
    if (type === "plutus") {
      assert.ok(
        minted.trace.some((e) => e.tag === "ExUnitsMap" && e.exUnits.length),
      );
      await page
        .locator('[data-section="mint"] [data-field="redeemer"]')
        .fill('{"int":41}');
      await balance(false);
      await page
        .locator('[data-section="mint"] [data-field="redeemer"]')
        .fill('{"int":42}');
      await balance();
    }
    await submit();
    await refresh();
    await open(`${type}-burn`);
    assert.equal(await page.locator("#example-quantity").inputValue(), "100");
    if (type === "native")
      assert.equal(
        await page.locator("#example-token").inputValue(),
        "Example café",
      );
    await load();
    const burnt = await balance();
    assert.equal(burnt.transaction.mint[0].policyId, expectedPolicy);
    assert.equal(burnt.transaction.mint[0].quantity, "-100");
    assert.ok(
      burnt.transaction.outputs.every(
        (o) =>
          !o.assets.some(
            (a) =>
              a.policyId === expectedPolicy &&
              a.assetName === minted.transaction.mint[0].assetName,
          ),
      ),
    );
    await submit();
    await refresh();
  }
  await open("native-burn");
  await page.locator("#example-load").click();
  await page.waitForFunction(
    () => !document.querySelector("#example-load").disabled,
  );
  assert.match(
    await page.locator("#example-error").textContent(),
    /wallet has 0/,
  );
  await page.locator("#close-examples").click();

  // Validate the actual handoff and its account/network isolation across reload.
  assert.equal(
    requests.length,
    baseline,
    "Example transaction work made network requests",
  );
  assert.deepEqual(calls, { sign: 6, submit: 6 });
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => window.scTools.ready);
  await page.locator("#connect").click();
  await page
    .getByRole("button", { name: "Example test wallet", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#wallet-name").textContent ===
      "Example test wallet",
  );
  await open("unlock");
  assert.equal(await page.locator("#example-input").inputValue(), lockRef);
  await page.screenshot({ path: join(cache, "evidence/examples-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const dialog = await page.locator("#examples-dialog").boundingBox();
  assert.ok(dialog.width <= 390 && dialog.height <= 844);
  assert.equal(await page.locator("#example-load").isVisible(), true);
  await page.screenshot({ path: join(cache, "evidence/examples-mobile.png") });
  await page.locator("#close-examples").click();
  await page.locator("#network").selectOption("preview");
  await open("unlock");
  assert.equal(await page.locator("#example-last-lock").isDisabled(), true);
  assert.equal(await page.locator("#example-input").inputValue(), "");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      examples: 7,
      lockUnlock: true,
      nativeMintBurn: true,
      plutusMintBurn: true,
      wrongRedeemersRejected: true,
      receiptsSurviveReload: true,
      offlineTransactionWork: true,
      calls,
    }),
  );
} finally {
  await browser.close();
}
