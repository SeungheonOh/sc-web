import assert from "node:assert/strict";
import { validateAssets } from "../browser/assets.js";
import { makeBlock, toRequest, setSpendingSource } from "../browser/blocks.js";
import { hexFromText, textFromHex } from "../browser/format.js";
import { decodeCbor } from "../browser/cbor.js";
import { dataTree, renderTransaction } from "../browser/inspector.js";
import { policy, hex, refs } from "./test-fixtures.mjs";
const spending = makeBlock("input", { input: refs[0] });
setSpendingSource(spending, "script");
assert.equal(spending.data.input, "");
assert.equal(spending.data.witnessMode, "PlutusV3");
Object.assign(spending.data, { input: refs[1], witnessMode: "Native" });
assert.equal(toRequest(spending).witness.language, "Native");
setSpendingSource(spending, "wallet");
assert.equal(toRequest(spending).input, refs[0]);
assert.equal(toRequest(spending).witness, undefined);
const importedSpending = makeBlock(
  "input",
  JSON.parse(JSON.stringify(spending.data)),
);
setSpendingSource(importedSpending, "script");
assert.equal(toRequest(importedSpending).input, refs[1]);
assert.equal(toRequest(importedSpending).witness.language, "Native");
const row = {
  policyId: policy,
  assetName: hexFromText("Token 🌱"),
  quantity: "18446744073709551617",
};
const data = { assets: JSON.stringify([row]) };
assert.deepEqual(validateAssets(data), [row]);
assert.equal(
  toRequest(makeBlock("output", { ...data, address: "test", ada: "2" })).output
    .assets[0].quantity,
  row.quantity,
);
assert.equal(textFromHex(row.assetName), "Token 🌱");
assert.equal(textFromHex("ff00"), null);
for (const value of ["0", "-1", "1.5", "1e6", ""])
  assert.throws(
    () =>
      validateAssets({ assets: JSON.stringify([{ ...row, quantity: value }]) }),
    /positive whole quantity/,
  );
assert.throws(
  () =>
    validateAssets({
      assets: JSON.stringify([{ ...row, quantity: 18446744073709551617 }]),
    }),
  /large quantities/,
);
assert.throws(
  () => validateAssets({ assets: JSON.stringify([row, row]) }),
  /appears twice/,
);
assert.throws(
  () =>
    validateAssets({
      assets: JSON.stringify([{ ...row, assetName: "aa".repeat(33) }]),
    }),
  /32 bytes/,
);
assert.equal(
  validateAssets(
    {
      policyId: policy,
      assets: JSON.stringify([{ assetName: "", quantity: "-3" }]),
    },
    true,
  )[0].quantity,
  "-3",
);
assert.deepEqual(
  decodeCbor(hex(new Map([[0, [9007199254740993n, Buffer.from("Token")]]]))),
  new Map([[0n, [9007199254740993n, new Uint8Array(Buffer.from("Token"))]]]),
);
assert.deepEqual(decodeCbor("9f0102ff"), [1n, 2n]);
assert.equal(decodeCbor("c249010000000000000001"), 18446744073709551617n);
assert.throws(() => decodeCbor("8201"), /Truncated/);
assert.throws(() => decodeCbor("00ff"), /Trailing/);
const rendered = dataTree({
  constructor: 0,
  fields: [
    { int: "18446744073709551617" },
    { bytes: hexFromText("<script>") },
    { map: [{ k: { bytes: "61" }, v: { list: [{ int: 3 }] } }] },
  ],
});
assert.match(rendered, /Constructor 0/);
assert.match(rendered, /18446744073709551617/);
assert.match(rendered, /&lt;script&gt;/);
assert.doesNotMatch(rendered, /<script>/);
console.log(
  "Asset quantities, UTF-8/hex names, CBOR precision, datum structure and escaping passed.",
);
