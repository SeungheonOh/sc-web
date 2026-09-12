import {
  escape,
  integer,
  textFromHex,
  hexFromText,
  assetName,
} from "./format.js";

function readRows(data) {
  const rows = JSON.parse(data.assets);
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  )
    throw new Error("Assets must be an array of asset entries.");
  return rows;
}
export function walletAssets(wallet) {
  const assets = new Map();
  for (const utxo of wallet?.utxos || [])
    for (const a of utxo.output.assets) {
      const key = `${a.policyId}.${a.assetName}`;
      const previous = assets.get(key);
      assets.set(key, {
        ...a,
        quantity: String(BigInt(previous?.quantity || 0) + BigInt(a.quantity)),
      });
    }
  return [...assets.values()];
}
export function validateAssets(data, mint = false) {
  const seen = new Set();
  return readRows(data).map((row, index) => {
    const prefix = `Asset ${index + 1}: `;
    const policyId = String(mint ? data.policyId : (row.policyId ?? ""))
      .trim()
      .toLowerCase();
    const assetName = String(row.assetName ?? "")
      .trim()
      .toLowerCase();
    const quantity = String(row.quantity ?? "").trim();
    if (!/^[\da-f]{56}$/.test(policyId))
      throw new Error(
        prefix + "policy ID must contain 56 hexadecimal characters.",
      );
    if (!/^(?:[\da-f]{2}){0,32}$/.test(assetName))
      throw new Error(
        prefix + "name must be at most 32 bytes (64 hexadecimal characters).",
      );
    if (
      !/^-?\d+$/.test(quantity) ||
      BigInt(quantity) === 0n ||
      (!mint && BigInt(quantity) < 0n)
    )
      throw new Error(
        prefix +
          (mint
            ? "enter a nonzero whole quantity; use negative amounts to burn."
            : "enter a positive whole quantity."),
      );
    if (typeof row.quantity === "number" && !Number.isSafeInteger(row.quantity))
      throw new Error(
        prefix +
          "large quantities must be strings to preserve their exact value.",
      );
    const key = policyId + "." + assetName;
    if (seen.has(key))
      throw new Error(
        prefix + "this asset appears twice; combine its quantities in one row.",
      );
    seen.add(key);
    return {
      ...(!mint && { policyId }),
      assetName,
      quantity: BigInt(quantity).toString(),
    };
  });
}
function rowView(row, index, mint, available) {
  const hex = String(row.assetName ?? ""),
    text = textFromHex(hex);
  const owned = available.find(
    (a) => a.policyId === row.policyId && a.assetName === hex,
  );
  return `<div class="asset-editor-row" data-asset-row="${index}">
    <div class="asset-row-heading"><strong>Asset ${index + 1}</strong>${owned ? `<span class="muted" data-asset-owned>Wallet: ${integer(owned.quantity)}</span>` : ""}<button class="quiet" data-asset-remove="${index}">Remove</button></div>
    ${mint ? "" : `<label>Policy ID<input data-asset-field="policyId" value="${escape(row.policyId)}" placeholder="56 hexadecimal characters" spellcheck="false" autocomplete="off"></label>`}
    <div class="asset-name-row"><label>Asset name<input data-asset-field="assetName" value="${escape(text ?? hex)}" placeholder="Empty name allowed" spellcheck="false" autocomplete="off"></label><label>Name format<select data-asset-encoding><option value="text" ${text !== null ? "selected" : ""}>Text (UTF-8)</option><option value="hex" ${text === null ? "selected" : ""}>Hex bytes</option></select></label></div>
    <div class="asset-quantity-row"><label>${mint ? "Quantity (+ mint / − burn)" : "Quantity (smallest units)"}<input data-asset-field="quantity" inputmode="numeric" value="${escape(row.quantity)}" placeholder="1" autocomplete="off"></label>${owned && !mint ? `<button class="secondary" data-asset-max="${index}">Use all ${integer(owned.quantity)}</button>` : ""}</div>
    <p class="asset-validation" role="status"></p>
  </div>`;
}
export function renderAssets(block, wallet) {
  const mint = block.type === "mint",
    available = walletAssets(wallet);
  let rows;
  try {
    rows = readRows(block.data);
  } catch (error) {
    return `<div class="asset-editor"><p class="field-note">The imported assets could not be read: ${escape(error.message)}</p><label>Repair asset JSON<textarea data-field="assets">${escape(block.data.assets)}</textarea></label><button class="quiet" data-asset-retry>Show asset rows</button></div>`;
  }
  return `<div class="asset-editor"><div class="asset-editor-heading"><h3>${mint ? "Assets to mint / burn" : "Native assets"} <span class="muted">${rows.length}</span></h3><button class="secondary" data-asset-add>Add asset</button></div>
    ${!mint && available.length ? `<label>Add from wallet<select data-asset-wallet><option value="">Choose an asset (${available.length} available)</option>${available.map((a, i) => `<option value="${i}">${escape(assetName(a.assetName))} · ${integer(a.quantity)} available · ${a.policyId.slice(0, 12)}…</option>`).join("")}</select></label>` : ""}
    ${rows.length ? rows.map((row, i) => rowView(row, i, mint, available)).join("") : '<p class="field-note">No native assets. Add an asset to send tokens with this output.</p>'}
    <p class="field-note">Whole quantities in the asset’s smallest unit. No decimal conversion.${mint ? " Negative quantities burn." : ""}</p>
  </div>`;
}
export function bindAssets(node, block, wallet, { invalidate, render }) {
  const editor = node.querySelector(".asset-editor");
  if (!editor) return;
  const mint = block.type === "mint",
    available = walletAssets(wallet);
  const save = (rows) => {
    block.data.assets = JSON.stringify(rows);
    invalidate();
  };
  const change = (fn) => {
    const rows = readRows(block.data);
    fn(rows);
    save(rows);
    render();
  };
  const checkRow = (element, row) => {
    let error = "";
    try {
      validateAssets(
        { policyId: block.data.policyId, assets: JSON.stringify([row]) },
        mint,
      );
    } catch (e) {
      error = e.message.replace(/^Asset 1: /, "");
    }
    element.querySelector(".asset-validation").textContent = error;
    const owned = available.find(
      (a) => a.policyId === row.policyId && a.assetName === row.assetName,
    );
    const max = element.querySelector("[data-asset-max]"),
      label = element.querySelector("[data-asset-owned]");
    if (max) {
      max.disabled = !owned;
      max.textContent = owned
        ? `Use all ${integer(owned.quantity)}`
        : "Not in wallet";
    }
    if (label)
      label.textContent = owned ? `Wallet: ${integer(owned.quantity)}` : "";
  };
  editor.querySelector("[data-asset-retry]")?.addEventListener("click", render);
  editor.querySelector("[data-asset-add]")?.addEventListener("click", () =>
    change((rows) =>
      rows.push({
        ...(!mint && { policyId: "" }),
        assetName: "",
        quantity: "1",
      }),
    ),
  );
  editor
    .querySelector("[data-asset-wallet]")
    ?.addEventListener("change", (event) => {
      if (event.target.value === "") return;
      const asset = available[Number(event.target.value)];
      change((rows) => {
        if (
          !rows.some(
            (r) =>
              r.policyId === asset.policyId && r.assetName === asset.assetName,
          )
        )
          rows.push({ ...asset, quantity: "1" });
      });
    });
  for (const element of editor.querySelectorAll("[data-asset-row]")) {
    const index = Number(element.dataset.assetRow);
    const name = element.querySelector('[data-asset-field="assetName"]'),
      encoding = element.querySelector("[data-asset-encoding]");
    let previousEncoding = encoding.value;
    for (const input of element.querySelectorAll("[data-asset-field]"))
      input.addEventListener("input", () => {
        const rows = readRows(block.data),
          field = input.dataset.assetField;
        rows[index][field] =
          field === "assetName" && encoding.value === "text"
            ? hexFromText(input.value)
            : input.value;
        save(rows);
        checkRow(element, rows[index]);
      });
    encoding.addEventListener("change", () => {
      const rows = readRows(block.data),
        hex = rows[index].assetName;
      const text = textFromHex(hex);
      if (encoding.value === "text" && text === null) {
        encoding.value = previousEncoding;
        element.querySelector(".asset-validation").textContent =
          "These bytes are not printable UTF-8. Keep Hex bytes to preserve the asset name.";
        return;
      }
      name.value = encoding.value === "text" ? text : hex;
      previousEncoding = encoding.value;
      checkRow(element, rows[index]);
    });
    element.querySelector("[data-asset-remove]").onclick = () =>
      change((rows) => rows.splice(index, 1));
    element.querySelector("[data-asset-max]")?.addEventListener("click", () =>
      change((rows) => {
        const row = rows[index];
        row.quantity = available.find(
          (a) => a.policyId === row.policyId && a.assetName === row.assetName,
        ).quantity;
      }),
    );
  }
}
