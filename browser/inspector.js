import { escape, ada, integer, assetName, textFromHex } from "./format.js";
import { decodeCbor, namedMap, bodyFields, witnessFields } from "./cbor.js";
const bytesHex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const scalar = (type, value) =>
  `<span class="data-type">${escape(type)}</span><code>${escape(value)}</code>`;
export function dataTree(value, depth = 0) {
  if (depth > 32)
    return '<span class="muted">Further nesting is available in CBOR / JSON.</span>';
  if (value === null || value === undefined) return scalar("null", "");
  if (value instanceof Uint8Array) {
    const hex = bytesHex(value),
      text = textFromHex(hex);
    return `<div class="data-bytes">${scalar(`${value.length} bytes`, hex || "(empty)")}${text ? `<div class="data-text">UTF-8: ${escape(text)}</div>` : ""}</div>`;
  }
  if (typeof value !== "object")
    return scalar(
      typeof value === "bigint" || typeof value === "number"
        ? "number"
        : typeof value,
      String(value),
    );
  if (
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "int") &&
    /^-?\d+$/.test(String(value.int))
  )
    return scalar("integer", String(value.int));
  if (
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "bytes") &&
    /^(?:[\da-f]{2})*$/i.test(String(value.bytes))
  )
    return dataTree(
      Uint8Array.from(String(value.bytes).match(/../g) || [], (b) =>
        parseInt(b, 16),
      ),
      depth + 1,
    );
  let title, children;
  if (Object.hasOwn(value, "constructor") && Array.isArray(value.fields)) {
    title = `Constructor ${value.constructor} · ${value.fields.length} fields`;
    children = value.fields.map((v, i) => [`Field ${i}`, v]);
  } else if (Array.isArray(value.list) || Array.isArray(value)) {
    const list = Array.isArray(value) ? value : value.list;
    title = `List · ${list.length} items`;
    children = list.map((v, i) => [String(i), v]);
  } else if (value instanceof Map || Array.isArray(value.map)) {
    const entries =
      value instanceof Map ? [...value] : value.map.map((v) => [v.k, v.v]);
    return `<details class="data-node" ${depth < 3 ? "open" : ""}><summary>Map · ${entries.length} entries</summary><div class="data-children">${entries.map(([k, v]) => `<div class="data-map-entry"><div><span class="data-key">Key</span>${dataTree(k, depth + 1)}</div><div><span class="data-key">Value</span>${dataTree(v, depth + 1)}</div></div>`).join("")}</div></details>`;
  } else {
    title = Object.hasOwn(value, "cborTag")
      ? `CBOR tag ${value.cborTag}`
      : "Fields";
    children = Object.entries(value).filter(([key]) => key !== "cborTag");
  }
  return `<details class="data-node" ${depth < 3 ? "open" : ""}><summary>${escape(title)}</summary><div class="data-children">${children.map(([key, v]) => `<div class="data-entry"><span class="data-key">${escape(key)}</span><div>${dataTree(v, depth + 1)}</div></div>`).join("")}</div></details>`;
}
const detail = (label, value) =>
  `<div class="review-field"><span>${escape(label)}</span><code>${escape(value ?? "None")}</code></div>`;
const section = (id, title, content, count) =>
  `<section class="review-section" id="review-${id}"><h3>${escape(title)}${count === undefined ? "" : `<span>${count}</span>`}</h3>${content}</section>`;
const none = (label) => `<p class="section-empty">${label}</p>`;
export function assetTable(assets) {
  if (!assets?.length) return none("No native assets");
  return `<div class="review-assets">${assets.map((a) => `<div class="review-asset"><div class="review-asset-title"><strong>${escape(assetName(a.assetName))}</strong><span>${integer(a.quantity)} <small>units</small></span></div>${detail("Policy ID", a.policyId)}${detail("Name hex", a.assetName || "(empty)")}</div>`).join("")}</div>`;
}
function datumView(output) {
  let datum = output.datum;
  if (!datum && output.datumCbor) {
    try {
      datum = decodeCbor(output.datumCbor);
    } catch {
      return detail("Datum CBOR", output.datumCbor);
    }
  }
  if (!datum && output.datumHash) datum = { hash: output.datumHash };
  if (!datum)
    return '<div class="datum-view"><strong>Datum</strong><span class="muted">None</span></div>';
  if (datum.hash)
    return `<div class="datum-view"><strong>Datum hash</strong>${detail("Hash", datum.hash)}<span class="muted">Datum value is not included in this output.</span></div>`;
  const kind =
    output.datumMode === "embedded"
      ? "Datum included with transaction"
      : output.datumMode === "inline" || output.cardano?.inlineDatum
        ? "Inline datum"
        : "Datum";
  return `<div class="datum-view"><strong>${kind}</strong><div>${dataTree(datum)}</div></div>`;
}
function outputView(output, label, ref) {
  return `<article class="review-output"><div class="review-output-heading"><h4>${escape(label)}</h4><strong>${ada(output.lovelace)} ADA</strong></div>${ref ? detail("UTXO", ref) : ""}${detail("Address", output.address)}${assetTable(output.assets)}${datumView(output)}${output.referenceScript ? `<details class="review-script" open><summary>Reference script</summary>${dataTree(output.referenceScript)}</details>` : ""}</article>`;
}
export function renderTransaction(
  result,
  tx,
  { signed = false, resolvedInputs = [], requestedOutputs } = {},
) {
  const known = new Map(
    [...resolvedInputs, ...result.selectedInputs].map((u) => [
      u.input,
      u.output,
    ]),
  );
  const inputs = (refs, label) =>
    refs
      .map((ref, i) =>
        known.has(ref)
          ? outputView(known.get(ref), `${label} ${i}`, ref)
          : `<article class="review-output">${detail(label, ref)}<p class="field-note">Resolved output is unavailable.</p></article>`,
      )
      .join("");
  let complete;
  try {
    const parts = decodeCbor(tx.cborHex);
    const witnesses = parts[1];
    complete =
      section(
        "witnesses",
        "Witnesses, scripts & redeemers",
        witnesses instanceof Map && witnesses.size === 0
          ? none("No witnesses attached yet")
          : dataTree(namedMap(witnesses, witnessFields)),
      ) +
      section(
        "complete",
        "Complete transaction",
        `<details><summary>Every transaction body field</summary>${dataTree(namedMap(parts[0], bodyFields))}</details><details><summary>Auxiliary data</summary>${dataTree(parts.length > 3 ? parts[3] : null)}</details>${detail("Script validity flag", parts[2])}`,
      );
  } catch (e) {
    complete = section(
      "complete",
      "Complete transaction",
      `<p class="field-note">${escape(e.message)} Use the CBOR tab for the complete encoded transaction.</p>`,
    );
  }
  const mint = tx.mint || [],
    withdrawals = tx.withdrawals || [];
  return `<div class="transaction-review"><div class="review-summary"><div><span>Fee</span><strong>${ada(tx.feeLovelace)} ADA</strong></div><div><span>${signed ? "Signed" : "Unsigned"} size</span><strong>${integer(tx.bytes)} bytes</strong></div><div><span>Inputs / outputs</span><strong>${tx.inputs.length} / ${tx.outputs.length}</strong></div><div><span>Key witnesses</span><strong>${tx.witnesses}</strong></div></div>
    ${detail("Transaction ID", tx.txId)}${detail("Network", result.network)}
    <nav class="review-nav" aria-label="Transaction sections"><a href="#review-inputs">Inputs</a><a href="#review-outputs">Outputs</a><a href="#review-withdrawals">Withdrawals</a><a href="#review-witnesses">Witnesses</a><a href="#review-complete">All fields</a></nav>
    <div class="review-flow">${section("inputs", "Inputs", inputs(tx.inputs, "Input"), tx.inputs.length)}${section("outputs", "Outputs", tx.outputs.map((o, i) => outputView(o, requestedOutputs !== undefined && i >= requestedOutputs ? `Change output ${i}` : `Output ${i}`)).join(""), tx.outputs.length)}</div>
    ${tx.referenceInputs.length ? section("references", "Reference inputs", inputs(tx.referenceInputs, "Reference input"), tx.referenceInputs.length) : ""}
    ${tx.collateralInputs.length ? section("collateral", "Collateral", inputs(tx.collateralInputs, "Collateral input") + (tx.returnCollateral ? outputView(tx.returnCollateral, "Collateral return") : "") + detail("Total collateral", ada(tx.totalCollateral) + " ADA"), tx.collateralInputs.length) : ""}
    ${section("withdrawals", "Withdrawals", withdrawals.length ? withdrawals.map((w) => `<article class="review-output"><strong>${ada(w.lovelace)} ADA</strong>${detail("Reward address", w.address)}</article>`).join("") : none("No reward withdrawals"), withdrawals.length)}
    ${section("mint", "Mint / burn", assetTable(mint), mint.length)}
    ${section("certificates", "Certificates", tx.certificates.length ? tx.certificates.map((c, i) => `<details open><summary>Certificate ${i}</summary>${dataTree(c)}</details>`).join("") : none("No certificates"), tx.certificates.length)}
    ${section("governance", "Governance", Object.keys(tx.votes || {}).length || tx.proposals.length || tx.treasuryDonation !== "0" ? dataTree({ votes: tx.votes, proposals: tx.proposals, treasuryDonationLovelace: tx.treasuryDonation }) : none("No governance actions"))}
    ${section("conditions", "Conditions & metadata", detail("Valid from slot", tx.validity.from ?? "No lower bound") + detail("Valid until slot", tx.validity.until ?? "No upper bound") + detail("Signatures reserved", result.witnessEstimate) + detail("Required signers", tx.requiredSigners.length ? tx.requiredSigners.join(", ") : "None") + (tx.metadata ? `<details open><summary>Metadata</summary>${dataTree(tx.metadata)}</details>` : none("No metadata")))}
    ${complete}
    ${section("execution", "Script execution", dataTree(result.trace.filter((e) => e.tag === "ExUnitsMap").at(-1)?.exUnits || []))}
    <p class="field-note inspection-note">Chain data: epoch ${escape(result.chainInfo.epoch)}, slot ${escape(result.chainInfo.slot)}. ${signed ? "Signed; submission is a separate action." : "Unsigned; review before requesting a wallet signature."}</p>
  </div>`;
}
