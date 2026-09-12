import { escape, ada } from "./format.js";
import { renderAssets, validateAssets } from "./assets.js";
export { escape } from "./format.js";
export const sections = [
  {
    id: "inputs",
    title: "Inputs",
    types: ["input", "reference", "collateral"],
  },
  {
    id: "outputs",
    title: "Outputs",
    types: ["output"],
  },
  {
    id: "mint",
    title: "Mint / Burn",
    types: ["mint"],
  },
  {
    id: "withdrawals",
    title: "Withdrawals",
    types: ["withdrawal"],
  },
  {
    id: "certificates",
    title: "Certificates",
    types: ["certificate"],
  },
  {
    id: "governance",
    title: "Governance",
    types: ["vote", "proposal", "treasury"],
  },
  {
    id: "conditions",
    title: "Conditions & data",
    types: ["validity", "signer", "metadata", "auxiliary"],
  },
];
export const definitions = {
  input: {
    label: "Spending input",
    defaults: {
      input: "",
      witnessMode: "Key",
      source: "inline",
      scriptCbor: "",
      reference: "",
      redeemer: '{"constructor":0,"fields":[]}',
      nativeScript: '{"type":"all","scripts":[]}',
      datumMode: "inline",
      datum: '{"constructor":0,"fields":[]}',
    },
  },
  reference: { label: "Reference input", defaults: { input: "" } },
  collateral: { label: "Collateral input", defaults: { input: "" } },
  output: {
    label: "Payment output",
    defaults: {
      address: "",
      ada: "",
      datumMode: "none",
      datum: '{"constructor":0,"fields":[]}',
      datumHash: "",
      assets: "[]",
      referenceScript: "",
    },
  },
  mint: {
    label: "Mint / burn assets",
    defaults: {
      policyId: "",
      assets: '[{"assetName":"","quantity":"1"}]',
      witnessMode: "Native",
      nativeScript: '{"type":"sig","keyHash":""}',
      source: "inline",
      scriptCbor: "",
      reference: "",
      redeemer: '{"constructor":0,"fields":[]}',
    },
  },
  withdrawal: {
    label: "Reward withdrawal",
    defaults: {
      address: "",
      ada: "",
      witnessMode: "Key",
      source: "inline",
      scriptCbor: "",
      reference: "",
      nativeScript: '{"type":"sig","keyHash":""}',
      redeemer: '{"constructor":0,"fields":[]}',
    },
  },
  certificate: {
    label: "Certificate",
    defaults: {
      kind: "register",
      credential: "",
      poolId: "",
      cbor: "",
      witnessMode: "Key",
      source: "inline",
      scriptCbor: "",
      reference: "",
      nativeScript: '{"type":"sig","keyHash":""}',
      redeemer: '{"constructor":0,"fields":[]}',
    },
  },
  validity: {
    label: "Validity interval",
    defaults: { from: "", until: "" },
  },
  signer: { label: "Required signer", defaults: { keyHash: "" } },
  metadata: {
    label: "Transaction metadata",
    defaults: { metadata: "{}" },
  },
  auxiliary: {
    label: "Auxiliary script",
    defaults: {
      script:
        '{"language":"Native","nativeScript":{"type":"all","scripts":[]}}',
    },
  },
  vote: {
    label: "Governance voting procedures",
    defaults: { cbor: "", signatures: "1", witnesses: "[]" },
  },
  proposal: {
    label: "Governance proposal",
    defaults: {
      cbor: "",
      witnessMode: "Key",
      source: "inline",
      scriptCbor: "",
      reference: "",
      nativeScript: '{"type":"sig","keyHash":""}',
      redeemer: '{"constructor":0,"fields":[]}',
    },
  },
  treasury: {
    label: "Treasury donation",
    defaults: { ada: "", currentTreasury: "" },
  },
};
export const makeBlock = (type, data = {}) => {
  if (!definitions[type]) throw new Error(`Unknown block type ${type}`);
  return {
    id: crypto.randomUUID(),
    type,
    data: { ...definitions[type].defaults, ...data },
  };
};
export function adaToLovelace(text) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(String(text).trim()))
    throw new Error(
      "ADA amount must be nonnegative, with up to six decimal places.",
    );
  const [whole, fraction = ""] = String(text).trim().split(".");
  return (
    BigInt(whole) * 1000000n +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
}
const json = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
};
const rawData = (text, label) => {
  json(text, label);
  return text;
};
const integer = (text, label) => {
  if (!/^[0-9]+$/.test(String(text)))
    throw new Error(`${label} must be a nonnegative integer.`);
  return String(text);
};
const ref = (text) => {
  const normalized = String(text).trim().toLowerCase();
  if (!/^[0-9a-f]{64}#[0-9]+$/.test(normalized))
    throw new Error("Input must be transaction-hash#output-index.");
  return normalized;
};
const hex = (text, bytes, label) => {
  const t = String(text).trim().toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/.test(t) || (bytes && t.length !== bytes * 2))
    throw new Error(
      `${label} must be ${bytes ? `${bytes} bytes of ` : ""}hexadecimal.`,
    );
  return t;
};
function witness(d) {
  if (d.witnessMode === "Key") return undefined;
  const w = { language: d.witnessMode };
  if (d.source === "reference") w.reference = ref(d.reference);
  else if (d.witnessMode === "Native")
    w.nativeScript = json(d.nativeScript, "Native script");
  else w.scriptCbor = hex(d.scriptCbor, 0, "Script CBOR");
  if (d.witnessMode !== "Native") w.redeemer = rawData(d.redeemer, "Redeemer");
  return w;
}
export function toRequest(block) {
  const d = block.data,
    type = block.type;
  try {
    switch (type) {
      case "output":
        return {
          type,
          output: {
            address: d.address.trim(),
            lovelace: adaToLovelace(d.ada),
            assets: validateAssets(d),
            datumMode: d.datumMode,
            ...(["inline", "embedded"].includes(d.datumMode)
              ? { datum: rawData(d.datum, "Datum") }
              : {}),
            ...(d.datumMode === "hash"
              ? { datumHash: hex(d.datumHash, 32, "Datum hash") }
              : {}),
            ...(d.referenceScript.trim()
              ? { referenceScript: json(d.referenceScript, "Reference script") }
              : {}),
          },
        };
      case "input":
        return {
          type,
          input: ref(d.input),
          witness: witness(d),
          ...(d.witnessMode !== "Key" &&
          d.witnessMode !== "Native" &&
          d.datumMode === "provided"
            ? { datum: rawData(d.datum, "Datum") }
            : {}),
        };
      case "reference":
      case "collateral":
        return { type, input: ref(d.input) };
      case "mint":
        return {
          type,
          policyId: hex(d.policyId, 28, "Policy ID"),
          assets: validateAssets(d, true),
          witness: witness(d),
        };
      case "withdrawal":
        return {
          type,
          address: d.address.trim(),
          lovelace: adaToLovelace(d.ada),
          witness: witness(d),
        };
      case "certificate":
        return {
          type,
          kind: d.kind,
          credential: d.credential.trim(),
          ...(d.kind === "raw"
            ? { cbor: hex(d.cbor, 0, "Certificate CBOR") }
            : {}),
          ...(d.kind === "delegate" ? { poolId: d.poolId.trim() } : {}),
          witness: witness(d),
        };
      case "validity":
        return {
          type,
          ...(d.from ? { from: integer(d.from, "Start slot") } : {}),
          ...(d.until ? { until: integer(d.until, "End slot") } : {}),
        };
      case "signer":
        return { type, keyHash: hex(d.keyHash, 28, "Payment key hash") };
      case "metadata":
        return { type, metadata: rawData(d.metadata, "Metadata") };
      case "auxiliary":
        return { type, script: json(d.script, "Auxiliary script") };
      case "vote":
        return {
          type,
          cbor: hex(d.cbor, 0, "Voting procedures CBOR"),
          witnesses: json(d.witnesses, "Voter witnesses"),
        };
      case "proposal":
        return {
          type,
          cbor: hex(d.cbor, 0, "Proposal CBOR"),
          witness: witness(d),
        };
      case "treasury":
        return {
          type,
          lovelace: adaToLovelace(d.ada),
          ...(d.currentTreasury
            ? {
                currentTreasury: integer(
                  d.currentTreasury,
                  "Current treasury value",
                ),
              }
            : {}),
        };
      default:
        throw new Error("Unknown block type.");
    }
  } catch (error) {
    throw new Error(`${definitions[type].label}: ${error.message}`);
  }
}
export function allWitnesses(blocks) {
  return blocks
    .flatMap((b) => [
      ...(b.witness ? [b.witness] : []),
      ...(b.witnesses || []).map((v) => v.witness),
    ])
    .filter(Boolean);
}
export function references(blocks) {
  const result = new Set();
  for (const b of blocks) {
    if (["input", "reference", "collateral"].includes(b.type))
      result.add(b.input);
    for (const w of allWitnesses([b])) if (w.reference) result.add(w.reference);
  }
  return [...result];
}
export function nativeWitnessCount(blocks) {
  const hashes = new Set();
  const walk = (s) => {
    if (s.type === "sig") hashes.add(s.keyHash);
    for (const child of s.scripts || []) walk(child);
  };
  for (const w of allWitnesses(blocks))
    if (w.nativeScript) walk(w.nativeScript);
  return hashes.size;
}

const field = (d, key, title, placeholder = "", type = "text") =>
  `<label>${title}<input data-field="${key}" type="${type}" value="${escape(d[key])}" placeholder="${escape(placeholder)}" autocomplete="off"></label>`;
const area = (d, key, title, placeholder = "") =>
  `<label>${title}<textarea data-field="${key}" placeholder="${escape(placeholder)}" spellcheck="false">${escape(d[key])}</textarea></label>`;
const select = (d, key, title, options) =>
  `<label>${title}<select data-field="${key}">${options.map(([value, label]) => `<option value="${value}"${d[key] === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
const action = (name, label) =>
  `<button type="button" class="quiet" data-action="${name}">${label}</button>`;
function scriptFields(
  d,
  { allowKey = true, spending = false, label = "Authorization" } = {},
) {
  return `<div class="advanced-fields">${select(d, "witnessMode", label, [...(allowKey ? [["Key", "Wallet key"]] : []), ["Native", "Native script"], ["PlutusV1", "Plutus V1"], ["PlutusV2", "Plutus V2"], ["PlutusV3", "Plutus V3"]])}${
    d.witnessMode === "Key"
      ? ""
      : `${select(d, "source", "Script source", [
          ["inline", "Include script in transaction"],
          ["reference", "Use a reference input"],
        ])}${d.source === "reference" ? field(d, "reference", "Reference script UTXO", "transaction-hash#0") : d.witnessMode === "Native" ? area(d, "nativeScript", "Native script JSON") : area(d, "scriptCbor", "Script CBOR", "CBOR-encoded script bytes")}${
          d.witnessMode === "Native"
            ? ""
            : `${area(d, "redeemer", "Redeemer · detailed schema JSON")}${
                spending
                  ? `${select(d, "datumMode", "Input datum", [
                      ["inline", "Use inline datum from the UTXO"],
                      ["provided", "Supply datum for a hashed output"],
                    ])}${d.datumMode === "provided" ? area(d, "datum", "Datum · detailed schema JSON") : ""}`
                  : ""
              }`
        }`
  }</div>`;
}
export function setSpendingSource(block, source) {
  if (block.type !== "input" || !["wallet", "script"].includes(source)) return;
  const d = block.data,
    current = d.witnessMode === "Key" ? "wallet" : "script";
  if (source === current) return;
  d[current === "wallet" ? "walletInput" : "scriptInput"] = d.input;
  if (current === "script") d.scriptWitnessMode = d.witnessMode;
  d.input = d[source === "wallet" ? "walletInput" : "scriptInput"] || "";
  d.witnessMode =
    source === "wallet"
      ? "Key"
      : ["Native", "PlutusV1", "PlutusV2", "PlutusV3"].includes(
            d.scriptWitnessMode,
          )
        ? d.scriptWitnessMode
        : "PlutusV3";
}
function walletUtxo(d, wallet) {
  const utxos = wallet?.utxos || [],
    selected = utxos.some((u) => u.input === d.input);
  return `<label>Wallet UTXO<select data-action="select-utxo" ${utxos.length ? "" : "disabled"}><option value=""${!d.input ? " selected" : ""}>${!wallet ? "Connect a wallet first" : utxos.length ? "Select an output…" : "No wallet UTXOs available"}</option>${d.input && !selected ? `<option value="${escape(d.input)}" selected>${escape(d.input)} · not in wallet</option>` : ""}${utxos.map((u) => `<option value="${escape(u.input)}"${d.input === u.input ? " selected" : ""}>${escape(u.input.slice(0, 14))}…#${escape(u.input.split("#")[1])} · ${ada(u.output.lovelace)} ADA</option>`).join("")}</select></label>`;
}
export function renderBlock(block, index, wallet) {
  const d = block.data,
    definition = definitions[block.type];
  let fields = "";
  switch (block.type) {
    case "output":
      fields = `<label><span class="field-actions">Recipient address${action("wallet-address", "Use wallet address")}</span><input data-field="address" value="${escape(d.address)}" placeholder="addr1… or addr_test1…" autocomplete="off"></label><div class="field-row">${field(d, "ada", "Amount in ADA", "0.000000")}${select(
        d,
        "datumMode",
        "Datum",
        [
          ["none", "No datum"],
          ["inline", "Inline datum"],
          ["hash", "Datum hash"],
          ["embedded", "Hash + datum in transaction"],
        ],
      )}</div>${["inline", "embedded"].includes(d.datumMode) ? area(d, "datum", "Datum · detailed schema JSON") : ""}${d.datumMode === "hash" ? field(d, "datumHash", "Datum hash", "32-byte hash") : ""}${renderAssets(block, wallet)}<details><summary>Reference script</summary><div class="advanced-fields">${area(d, "referenceScript", "Reference script (optional)", '{"language":"PlutusV2","scriptCbor":"…"}')}</div></details>`;
      break;
    case "input":
      fields = `<label>Spend from<select data-input-source><option value="wallet"${d.witnessMode === "Key" ? " selected" : ""}>Wallet UTXO</option><option value="script"${d.witnessMode !== "Key" ? " selected" : ""}>Script UTXO</option></select></label>${d.witnessMode === "Key" ? `${walletUtxo(d, wallet)}${d.input ? `<code class="inline-code">${escape(d.input)}</code>` : ""}` : `${field(d, "input", "Script UTXO", "transaction-hash#output-index")}${scriptFields(d, { allowKey: false, spending: true, label: "Script type" })}`}`;
      break;
    case "reference":
    case "collateral":
      fields = `${field(d, "input", "Transaction input", "transaction-hash#output-index")}${wallet?.utxos?.length ? walletUtxo(d, wallet) : ""}<p class="field-note">${block.type === "reference" ? "Read-only input. Its value is not spent." : "Used only if Plutus validation fails. Excess collateral and tokens return to your wallet."}</p>`;
      break;
    case "mint":
      fields = `${field(d, "policyId", "Minting policy ID", "28-byte script hash")}${renderAssets(block, wallet)}<p class="field-note">Positive quantities mint; negative quantities burn. Include newly minted assets in an output, or receive them as change.</p>${scriptFields(d, { allowKey: false })}`;
      break;
    case "withdrawal":
      fields = `<label><span class="field-actions">Reward address${action("reward-address", "Use wallet rewards")}</span><input data-field="address" value="${escape(d.address)}" placeholder="stake1… or stake_test1…"></label>${field(d, "ada", "Rewards to withdraw in ADA", "0.000000")}${scriptFields(d)}`;
      break;
    case "certificate":
      fields = `${select(d, "kind", "Certificate type", [
        ["register", "Register stake credential"],
        ["deregister", "Deregister stake credential"],
        ["delegate", "Delegate to stake pool"],
        ["raw", "Other certificate · CBOR"],
      ])}<label><span class="field-actions">Stake credential hash${action("stake-key", "Use wallet stake key")}</span><input data-field="credential" value="${escape(d.credential)}" placeholder="28-byte key or script hash"></label>${d.kind === "delegate" ? field(d, "poolId", "Stake pool ID", "pool1… or 28-byte hash") : ""}${d.kind === "raw" ? `${area(d, "cbor", "Certificate CBOR")}<p class="field-note">Use Conway certificate CBOR for DRep, committee, pool, or combined delegation certificates.</p>` : ""}${scriptFields(d)}`;
      break;
    case "validity":
      fields = `<div class="field-row">${field(d, "from", "Valid from slot (inclusive)", "Optional")}${field(d, "until", "Valid until slot (exclusive)", "Optional")}</div><div class="field-actions"><span class="field-note">Slot numbers on the selected network.</span>${action("validity-now", "Next 20 minutes")}</div>`;
      break;
    case "signer":
      fields = `<label><span class="field-actions">Payment key hash${action("payment-key", "Use wallet key")}</span><input data-field="keyHash" value="${escape(d.keyHash)}" placeholder="28-byte payment key hash"></label><p class="field-note">Adds an explicit signature requirement to the transaction body.</p>`;
      break;
    case "metadata":
      fields = `${area(d, "metadata", "Metadata JSON", '{"674":{"msg":["Your message"]}}')}<p class="field-note">Top-level keys are numeric labels. Strings must fit in 64 UTF-8 bytes.</p>`;
      break;
    case "auxiliary":
      fields = `${area(d, "script", "Auxiliary script JSON")}<p class="field-note">Use {"language":"Native","nativeScript":{…}} or {"language":"PlutusV2","scriptCbor":"…"}.</p>`;
      break;
    case "vote":
      fields = `${area(d, "cbor", "Voting procedures CBOR")}${field(d, "signatures", "Voter signatures to reserve", "1", "number")}${area(d, "witnesses", "Script voter witnesses (optional)", '[{"voterCbor":"…","witness":{"language":"PlutusV3","scriptCbor":"…","redeemer":{…}}}]')}<p class="field-note">One block contains the complete Conway voting-procedures map. Supply a witness for each script-authorized voter.</p>`;
      break;
    case "proposal":
      fields = `${area(d, "cbor", "Conway proposal procedure CBOR")}${scriptFields(d)}<p class="field-note">Includes the governance deposit and return reward account encoded in the proposal.</p>`;
      break;
    case "treasury":
      fields = `${field(d, "ada", "Donate ADA to the treasury", "0.000000")}${field(d, "currentTreasury", "Current treasury value in lovelace (optional)", "Only when your transaction requires this assertion")}`;
      break;
  }
  return `<article class="block" data-id="${block.id}"><div class="block-header" draggable="true"><span class="block-number">${String(index + 1).padStart(2, "0")}</span><h3>${definition.label}</h3><div class="block-actions">${action("up", "Up")}${action("down", "Down")}${action("duplicate", "Copy")}${action("remove", "Remove")}</div></div><div class="block-fields">${fields}</div></article>`;
}
