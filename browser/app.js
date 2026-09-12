import { ada } from "./format.js";
import { bindAssets } from "./assets.js";
import { renderTransaction } from "./inspector.js";
import { setupInspectorPanel } from "./inspector-panel.js";
import { setupExamples } from "./examples.js";
import { Engine } from "./engine.js";
import {
  discoverWallets,
  readWallet,
  collateralFromWallet,
  walletError,
} from "./wallet.js";
import { Blockfrost, validateSnapshot } from "./provider.js";
import {
  sections,
  definitions,
  makeBlock,
  setSpendingSource,
  renderBlock,
  toRequest,
  references,
  allWitnesses,
  nativeWitnessCount,
  escape,
} from "./blocks.js";

const $ = (s) => document.querySelector(s);
const state = {
  blocks: [makeBlock("output")],
  wallet: null,
  api: null,
  rawWallet: null,
  chain: null,
  provider: null,
  result: null,
  signed: null,
  revision: 0,
  tab: "summary",
  busy: false,
};
const engine = new Engine();
const examples = setupExamples({
  engine,
  context: () => ({
    network: $("#network").value,
    wallet: state.wallet,
    rawWallet: state.rawWallet,
  }),
  load: ({ blocks, title, next, kind, scripts }) => {
    state.blocks = blocks;
    state.example = { kind, scripts };
    state.balanceContext = null;
    state.failedTrace = null;
    $("#extra-witnesses").value = "0";
    $("#transaction-title").textContent = title;
    $("#example-note").textContent = next;
    $("#example-note").hidden = false;
    invalidate();
    renderBlocks();
    message(
      "Example loaded. Review the blocks, then balance with your wallet.",
      "success",
    );
  },
});
function clearExample() {
  state.example = null;
  $("#transaction-title").textContent = "Untitled transaction";
  $("#example-note").hidden = true;
}
const message = (text, kind = "") => {
  $("#message").textContent = text;
  $("#message").className = kind;
};
const check = (result) => {
  if (!result.ok)
    throw new Error(result.error || "Transaction operation failed.");
  return result;
};
function invalidate() {
  state.revision++;
  state.result = null;
  state.signed = null;
  renderInspection();
}
function add(type, data) {
  state.blocks.push(makeBlock(type, data));
  invalidate();
  renderBlocks();
  const id = state.blocks.at(-1).id;
  requestAnimationFrame(() =>
    $(`[data-id="${id}"]`)?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
    }),
  );
}
function renderCatalog() {
  const catalog = $("#catalog");
  catalog.replaceChildren();
  for (const group of sections) {
    const section = document.createElement("section");
    section.className = "catalog-group";
    section.innerHTML = `<h3>${group.title}</h3>`;
    for (const type of group.types) {
      const def = definitions[type],
        b = document.createElement("button");
      b.className = "catalog-button";
      b.dataset.add = type;
      b.textContent = def.label;
      b.title = `Add ${def.label.toLowerCase()}`;
      b.onclick = () => add(type);
      section.append(b);
    }
    catalog.append(section);
  }
}
function renderBlocks() {
  const root = $("#blocks");
  const expanded = new Set(
    [...root.querySelectorAll(".block")].flatMap((node) =>
      [...node.querySelectorAll("details")].flatMap((details, i) =>
        details.open ? [node.dataset.id + ":" + i] : [],
      ),
    ),
  );
  root.innerHTML = sections
    .filter(
      (group) =>
        ["inputs", "outputs"].includes(group.id) ||
        state.blocks.some((b) => group.types.includes(b.type)),
    )
    .map((group) => {
      const blocks = state.blocks.filter((b) => group.types.includes(b.type));
      return `<section class="transaction-section" data-section="${group.id}"><div class="section-heading"><div><h2>${group.title}</h2></div><span class="section-count">${blocks.length}</span><button class="quiet" data-add="${group.types[0]}">Add</button></div>${group.id === "inputs" ? `<div class="funding-block"><strong>Automatic wallet inputs</strong><span>${state.wallet ? `${state.wallet.utxos.length} UTXOs available; add inputs below to pin them.` : "Connect a wallet to fund this transaction."}</span></div>` : ""}<div class="section-body">${blocks.map((b, i) => renderBlock(b, i, state.wallet)).join("")}</div></section>`;
    })
    .join("");
  $("#recipe-count").textContent =
    `${state.blocks.length} ${state.blocks.length === 1 ? "block" : "blocks"}`;
  for (const b of root.querySelectorAll("[data-add]"))
    b.onclick = () => add(b.dataset.add);
  for (const node of root.querySelectorAll(".block")) {
    const block = state.blocks.find((b) => b.id === node.dataset.id);
    [...node.querySelectorAll("details")].forEach((details, i) => {
      details.open = expanded.has(node.dataset.id + ":" + i);
    });
    bindAssets(node, block, state.wallet, { invalidate, render: renderBlocks });
    node
      .querySelector("[data-input-source]")
      ?.addEventListener("change", (event) => {
        setSpendingSource(block, event.target.value);
        invalidate();
        renderBlocks();
      });
    for (const input of node.querySelectorAll("[data-field]")) {
      input.addEventListener("input", () => {
        block.data[input.dataset.field] = input.value;
        invalidate();
      });
      if (input.tagName === "SELECT")
        input.addEventListener("change", () => {
          block.data[input.dataset.field] = input.value;
          renderBlocks();
        });
    }
    for (const button of node.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;
      if (action === "select-utxo") {
        button.onchange = () => {
          block.data.input = button.value;
          invalidate();
          renderBlocks();
        };
        continue;
      }
      button.setAttribute(
        "aria-label",
        {
          up: "Move block up",
          down: "Move block down",
          duplicate: "Duplicate block",
          remove: "Remove block",
        }[action] || button.textContent,
      );
      button.onclick = () => blockAction(block, action);
    }
    node.querySelector(".block-header").ondragstart = (event) => {
      event.dataTransfer.setData("text/plain", block.id);
      node.classList.add("dragging");
    };
    node.ondragend = () => node.classList.remove("dragging");
    node.ondragover = (event) => event.preventDefault();
    node.ondrop = (event) => {
      event.preventDefault();
      const source = state.blocks.find(
        (b) => b.id === event.dataTransfer.getData("text/plain"),
      );
      if (!source || source.id === block.id) return;
      const group = sections.find((g) => g.types.includes(source.type));
      if (!group.types.includes(block.type)) {
        message("Move blocks within their transaction section.", "error");
        return;
      }
      state.blocks.splice(state.blocks.indexOf(source), 1);
      state.blocks.splice(state.blocks.indexOf(block), 0, source);
      invalidate();
      renderBlocks();
    };
  }
}
function walletBytes() {
  if (!state.rawWallet) throw new Error("Connect a wallet first.");
  return state.rawWallet.changeAddress;
}
function paymentKey() {
  const bytes = walletBytes();
  if (![0, 2, 4, 6].includes(parseInt(bytes.slice(0, 1), 16)))
    throw new Error("The change address does not use a payment key.");
  return bytes.slice(2, 58);
}
function stakeKey() {
  const bytes = state.rawWallet?.rewardAddresses?.[0];
  if (!bytes || parseInt(bytes.slice(0, 1), 16) !== 14)
    throw new Error("The connected wallet has no key-based reward address.");
  return bytes.slice(2, 58);
}
async function blockAction(block, action) {
  try {
    const index = state.blocks.indexOf(block);
    if (action === "remove") state.blocks.splice(index, 1);
    else if (action === "duplicate")
      state.blocks.splice(
        index + 1,
        0,
        makeBlock(block.type, structuredClone(block.data)),
      );
    else if (action === "up" || action === "down") {
      const group = sections.find((g) => g.types.includes(block.type));
      const peers = state.blocks.filter((b) => group.types.includes(b.type));
      const peer = peers[peers.indexOf(block) + (action === "up" ? -1 : 1)];
      if (!peer) return;
      const other = state.blocks.indexOf(peer);
      [state.blocks[index], state.blocks[other]] = [
        state.blocks[other],
        state.blocks[index],
      ];
    } else if (action === "wallet-address") {
      if (!state.wallet) throw new Error("Connect a wallet first.");
      block.data.address = state.wallet.changeAddress;
    } else if (action === "reward-address") {
      const reward = state.wallet?.rewardAddresses?.[0];
      if (!reward) throw new Error("The wallet has no reward address.");
      block.data.address = reward;
    } else if (action === "payment-key") block.data.keyHash = paymentKey();
    else if (action === "stake-key") block.data.credential = stakeKey();
    else if (action === "validity-now") {
      const chain = await loadChain();
      block.data.from = String(chain.tip.slot);
      block.data.until = String(BigInt(chain.tip.slot) + 1200n);
    }
    invalidate();
    renderBlocks();
  } catch (e) {
    message(walletError(e), "error");
  }
}
function renderWallet() {
  const w = state.wallet;
  $("#wallet-name").textContent = w ? state.walletName : "No wallet connected";
  $("#wallet-detail").textContent = w
    ? `${ada(w.utxos.reduce((sum, u) => sum + BigInt(u.output.lovelace), 0n))} ADA · ${w.utxos.length} UTXOs · ${w.changeAddress}`
    : "Connect to use wallet inputs and change.";
  $("#connect").textContent = w ? "Change wallet" : "Connect wallet";
  $("#refresh-wallet").hidden = !w;
  $("#utxo-count").textContent = w?.utxos.length || 0;
  const root = $("#utxos");
  root.innerHTML = w
    ? w.utxos
        .map(
          (u) =>
            `<div class="utxo"><code>${escape(u.input)}</code><div><strong>${ada(u.output.lovelace)} ADA</strong><span>${u.output.assets.length} assets</span></div><div><button class="secondary" data-input="${escape(u.input)}" data-type="input">Spend</button><button class="secondary" data-input="${escape(u.input)}" data-type="reference">Reference</button><button class="secondary" data-input="${escape(u.input)}" data-type="collateral">Collateral</button></div></div>`,
        )
        .join("")
    : '<p class="muted">Connect a wallet to inspect its spendable outputs.</p>';
  for (const b of root.querySelectorAll("[data-input]"))
    b.onclick = () => add(b.dataset.type, { input: b.dataset.input });
}
async function refreshWallet({ invalidateResult = true } = {}) {
  if (!state.api) throw new Error("Connect a CIP-30 wallet first.");
  const raw = await readWallet(state.api);
  const decoded = check(await engine.run({ action: "wallet", ...raw }));
  state.rawWallet = raw;
  state.wallet = decoded;
  if (invalidateResult) invalidate();
  renderWallet();
  renderBlocks();
  return raw;
}
function discover() {
  const root = $("#wallet-options");
  root.replaceChildren();
  const wallets = discoverWallets();
  if (!wallets.length) {
    root.innerHTML =
      '<div class="hint">No wallet extension detected. Open this page in your normal browser with Lace, Eternl, Nami, or another CIP-30 wallet installed.</div>';
    return;
  }
  for (const entry of wallets) {
    const button = document.createElement("button");
    button.append(document.createTextNode(entry.name));
    button.onclick = async () => {
      button.disabled = true;
      try {
        const api = await entry.wallet.enable();
        state.api = api;
        state.walletName = entry.name;
        await refreshWallet();
        if (
          state.rawWallet.networkId === 1 &&
          $("#network").value !== "mainnet"
        ) {
          $("#network").value = "mainnet";
          state.chain = null;
          state.provider = null;
        }
        if (
          state.rawWallet.networkId === 0 &&
          $("#network").value === "mainnet"
        ) {
          $("#network").value = "preprod";
          state.chain = null;
          state.provider = null;
        }
        $("#wallet-dialog").close();
        message(
          `Connected to ${entry.name}. ${state.rawWallet.networkId === 0 ? "Choose the matching testnet: CIP-30 network ID 0 does not distinguish Preprod from Preview." : ""}`,
          "success",
        );
      } catch (e) {
        message(walletError(e), "error");
        state.api = null;
        state.wallet = null;
        state.rawWallet = null;
        renderWallet();
      } finally {
        button.disabled = false;
      }
    };
    root.append(button);
  }
}
function provider() {
  if ($("#provider").value === "snapshot") return null;
  return new Blockfrost($("#network").value, $("#api-key").value);
}
async function loadChain({ force = false } = {}) {
  const network = $("#network").value;
  if (!force && state.chain) {
    try {
      return validateSnapshot(state.chain, network);
    } catch {
      state.chain = null;
    }
  }
  if ($("#provider").value === "snapshot")
    throw new Error(
      "Import a chain snapshot fetched in the last five minutes.",
    );
  $("#chain-status").textContent =
    "Fetching current protocol parameters and era history…";
  const p = provider();
  const snapshot = await p.chain();
  if (network !== $("#network").value)
    throw new Error("Network changed during the request.");
  state.provider = p;
  state.chain = snapshot;
  $("#chain-status").textContent =
    `Epoch ${snapshot.tip.epoch} · slot ${snapshot.tip.slot.toLocaleString()} · refreshed ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
  return snapshot;
}
async function balance() {
  if (state.busy) return;
  state.busy = true;
  $("#balance").disabled = true;
  $("#balance").textContent = "Balancing…";
  message("Reading wallet UTXOs and current chain data…");
  invalidate();
  try {
    const revision = state.revision,
      network = $("#network").value;
    const [raw, chain] = await Promise.all([
      refreshWallet({ invalidateResult: false }),
      loadChain(),
    ]);
    if (raw.networkId !== (network === "mainnet" ? 1 : 0))
      throw new Error(
        "Your wallet is on a different network. Switch the wallet or change the selected network.",
      );
    const blocks = state.blocks.map(toRequest);
    const singleton = ["validity", "vote", "treasury"];
    for (const type of singleton)
      if (blocks.filter((b) => b.type === type).length > 1)
        throw new Error(
          `Use one ${definitions[type].label} block; it represents the complete field.`,
        );
    const explicitRefs = new Set(
      blocks.filter((b) => b.type === "reference").map((b) => b.input),
    );
    for (const w of allWitnesses(blocks))
      if (w.reference && !explicitRefs.has(w.reference)) {
        blocks.push({ type: "reference", input: w.reference });
        explicitRefs.add(w.reference);
      }
    const collateral = allWitnesses(blocks).some((w) => w.language !== "Native")
      ? await collateralFromWallet(state.api)
      : [];
    const collateralOutputs = collateral.length
      ? check(await engine.run({ action: "wallet", ...raw, utxos: collateral }))
          .utxos
      : [];
    const known = new Set(state.wallet.utxos.map((u) => u.input));
    const resolvedInputs = [];
    if (state.provider) await state.provider.assertNetwork(state.wallet);
    for (const input of references(blocks)) {
      if (known.has(input)) continue;
      const imported = chain.resolvedInputs?.find((u) => u.input === input);
      if (imported) resolvedInputs.push(imported);
      else if (state.provider)
        resolvedInputs.push(await state.provider.resolve(input));
      else throw new Error(`Snapshot is missing resolved input ${input}.`);
    }
    const additional = Number($("#extra-witnesses").value);
    if (!Number.isInteger(additional) || additional < 0 || additional > 100)
      throw new Error("Additional signatures must be between 0 and 100.");
    const voterCount = state.blocks
      .filter((b) => b.type === "vote")
      .reduce((n, b) => n + Number(b.data.signatures || 0), 0);
    if (!Number.isInteger(voterCount) || voterCount < 0 || voterCount > 100)
      throw new Error("Invalid voter signature count.");
    const request = {
      action: "balance",
      wallet: { ...raw, collateral },
      chain,
      blocks,
      resolvedInputs,
      additionalWitnesses: additional + nativeWitnessCount(blocks) + voterCount,
    };
    message(
      "sc-tools is selecting inputs, evaluating scripts, and calculating fees in your browser…",
    );
    const result = await engine.run(request);
    if (state.revision !== revision)
      throw new Error(
        "The recipe changed during balancing. Balance again to inspect the current version.",
      );
    if (!result.ok) {
      state.failedTrace = result.trace;
      throw new Error(result.error);
    }
    state.balanceContext = request;
    state.result = {
      ...result,
      network,
      revision,
      chainInfo: {
        epoch: chain.tip.epoch,
        slot: chain.tip.slot,
        source: chain.source,
        fetchedAt: chain.fetchedAt,
      },
      walletIdentity: raw.changeAddress,
      contextOutputs: [
        ...state.wallet.utxos,
        ...collateralOutputs,
        ...resolvedInputs,
      ],
    };
    state.signed = null;
    renderInspection();
    message(
      `Balanced in ${Math.round(result.elapsedMs)} ms. Review every output before requesting a wallet signature.`,
      "success",
    );
  } catch (e) {
    message(walletError(e), "error");
  } finally {
    state.busy = false;
    $("#balance").disabled = false;
    $("#balance").textContent = "Balance transaction";
  }
}
function renderInspection() {
  const result = state.result,
    root = $("#inspection");
  $("#result-actions").hidden = !result;
  $("#result-state").textContent = result
    ? state.signed
      ? "SIGNED"
      : "BALANCED"
    : "DRAFT";
  $("#result-state").className = `pill${result ? " balanced" : ""}`;
  $("#sign").hidden = !!state.signed;
  $("#download-signed").hidden = !state.signed;
  $("#submit").hidden = !state.signed;
  if (!result) {
    root.innerHTML =
      '<div class="empty-inspector"><p>Balance to inspect inputs, outputs, withdrawals, fees, and change.</p></div>';
    return;
  }
  const tx = state.signed?.transaction || result.transaction;
  if (state.tab !== "summary") {
    const data =
      state.tab === "cbor"
        ? tx.cborHex
        : state.tab === "trace"
          ? JSON.stringify(result.trace, null, 2)
          : JSON.stringify({ ...result, transaction: tx }, null, 2);
    root.innerHTML = `<pre class="json-view">${escape(data)}</pre><button class="secondary" id="copy-inspection">Copy ${state.tab.toUpperCase()}</button>`;
    $("#copy-inspection").onclick = async () => {
      try {
        await navigator.clipboard.writeText(data);
        message("Copied.", "success");
      } catch {
        message("Clipboard unavailable. Use the download button.", "error");
      }
    };
    return;
  }
  root.innerHTML = renderTransaction(result, tx, {
    signed: Boolean(state.signed),
    resolvedInputs: result.contextOutputs,
    requestedOutputs: state.balanceContext?.blocks.filter(
      (b) => b.type === "output",
    ).length,
  });
}
function download(name, data, type = "application/json") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
  );
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function sign() {
  const result = state.result;
  if (!result || !state.api) return;
  $("#sign").disabled = true;
  try {
    const current = await readWallet(state.api);
    if (
      current.changeAddress !== result.walletIdentity ||
      current.networkId !== (result.network === "mainnet" ? 1 : 0)
    ) {
      invalidate();
      throw new Error("The wallet account or network changed. Balance again.");
    }
    if (Date.now() - result.chainInfo.fetchedAt > 300000) {
      invalidate();
      throw new Error("Chain data is stale. Balance again before signing.");
    }
    const decoded = check(await engine.run({ action: "wallet", ...current }));
    const available = new Set(decoded.utxos.map((u) => u.input));
    const owned = new Set(state.wallet.utxos.map((u) => u.input));
    for (const input of result.transaction.inputs)
      if (owned.has(input) && !available.has(input)) {
        invalidate();
        throw new Error(
          "A selected wallet UTXO is no longer available. Balance again.",
        );
      }
    const witnessSet = await state.api.signTx(result.transaction.cborHex, true);
    if (result !== state.result)
      throw new Error(
        "The recipe changed. The returned signature was discarded.",
      );
    const merged = check(
      await engine.run({
        action: "mergeWitnesses",
        cbor: result.transaction.cborHex,
        witnessSet,
        balanceContext: state.balanceContext,
      }),
    );
    if (merged.transaction.txId !== result.transaction.txId)
      throw new Error("Witness assembly changed the transaction body.");
    if (!merged.transaction.witnesses)
      throw new Error("The wallet returned no key signatures.");
    state.signed = merged;
    renderInspection();
    message(
      "Wallet signatures attached. The transaction has not been submitted. Additional signers may still be required.",
      "success",
    );
  } catch (e) {
    message(walletError(e), "error");
  } finally {
    $("#sign").disabled = false;
  }
}
async function submit() {
  if (!state.signed || !state.result) return;
  const result = state.result,
    signed = state.signed,
    example = state.example;
  $("#submit").disabled = true;
  try {
    const current = await readWallet(state.api);
    if (
      current.changeAddress !== result.walletIdentity ||
      current.networkId !== (result.network === "mainnet" ? 1 : 0)
    )
      throw new Error(
        "Wallet account or network changed. Reconnect and balance again.",
      );
    if (result !== state.result || signed !== state.signed)
      throw new Error("The transaction changed.");
    const txid = await state.api.submitTx(signed.transaction.cborHex);
    const nextExample = examples.remember(example, result, signed.transaction);
    message(
      `Submitted to ${result.network}: ${txid}. Awaiting network confirmation.${nextExample}`,
      "success",
    );
    $("#submit").hidden = true;
  } catch (e) {
    message(walletError(e), "error");
  } finally {
    $("#submit").disabled = false;
  }
}

$("#connect").onclick = () => {
  discover();
  $("#wallet-dialog").showModal();
};
$("#close-wallet").onclick = () => $("#wallet-dialog").close();
$("#refresh-wallet").onclick = () =>
  refreshWallet().catch((e) => message(walletError(e), "error"));
$("#balance").onclick = balance;
$("#sign").onclick = sign;
$("#submit").onclick = submit;
$("#network").onchange = () => {
  clearExample();
  state.chain = null;
  state.provider = null;
  invalidate();
  $("#chain-status").textContent =
    "Network changed. Refresh chain data before balancing.";
};
$("#api-key").oninput = () => {
  state.chain = null;
  state.provider = null;
  invalidate();
};
$("#extra-witnesses").oninput = invalidate;
$("#provider").onchange = () => {
  state.chain = null;
  state.provider = null;
  invalidate();
  $("#api-key-label").hidden = $("#provider").value !== "blockfrost";
  $("#load-chain").textContent =
    $("#provider").value === "snapshot"
      ? "Import chain snapshot"
      : "Refresh chain data";
  $("#chain-status").textContent =
    $("#provider").value === "snapshot"
      ? "Import a recent snapshot. Data older than five minutes is rejected."
      : "Your Blockfrost project ID stays in this tab.";
};
$("#load-chain").onclick = async () => {
  if ($("#provider").value === "snapshot") return $("#snapshot-file").click();
  $("#load-chain").disabled = true;
  try {
    invalidate();
    await loadChain({ force: true });
    message("Chain data refreshed.", "success");
  } catch (e) {
    $("#chain-status").textContent = walletError(e);
    message(walletError(e), "error");
  } finally {
    $("#load-chain").disabled = false;
  }
};
$("#snapshot-file").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const snapshot = validateSnapshot(
      JSON.parse(await file.text()),
      $("#network").value,
    );
    state.chain = snapshot;
    state.provider = null;
    invalidate();
    $("#chain-status").textContent =
      `Imported ${snapshot.source || "chain snapshot"} · epoch ${snapshot.tip.epoch}`;
    message("Imported chain data. Connect your wallet to balance.", "success");
  } catch (e) {
    message(walletError(e), "error");
  } finally {
    event.target.value = "";
  }
};
function recipeJson() {
  return JSON.stringify(
    {
      format: "sc-tools-transaction-recipe",
      version: 1,
      network: $("#network").value,
      blocks: state.blocks.map(({ type, data }) => ({ type, data })),
      additionalWitnesses: Number($("#extra-witnesses").value),
    },
    null,
    2,
  );
}
function importRecipe(text) {
  if (!text.trim()) throw new Error("Paste transaction JSON first.");
  if (new TextEncoder().encode(text).byteLength > 2e6)
    throw new Error("Transaction JSON is too large (maximum 2 MB).");
  let recipe;
  try {
    recipe = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  if (
    !recipe ||
    recipe.format !== "sc-tools-transaction-recipe" ||
    recipe.version !== 1 ||
    !Array.isArray(recipe.blocks) ||
    recipe.blocks.length > 200
  )
    throw new Error(
      "Unsupported transaction JSON. Use the editable transaction JSON produced by Export.",
    );
  if (!["preprod", "preview", "mainnet"].includes(recipe.network))
    throw new Error("Unsupported network.");
  const additional = recipe.additionalWitnesses ?? 0;
  if (!Number.isInteger(additional) || additional < 0 || additional > 100)
    throw new Error(
      "Additional signatures must be an integer between 0 and 100.",
    );
  const blocks = recipe.blocks.map((b) => {
    if (
      !b ||
      !b.data ||
      typeof b.data !== "object" ||
      Array.isArray(b.data) ||
      Object.values(b.data).some((v) => typeof v !== "string")
    )
      throw new Error("Invalid block fields.");
    return makeBlock(b.type, b.data);
  });
  state.blocks = blocks;
  clearExample();
  $("#network").value = recipe.network;
  $("#extra-witnesses").value = String(additional);
  state.chain = null;
  state.provider = null;
  invalidate();
  renderBlocks();
  $("#chain-status").textContent =
    "Refresh chain data for the imported transaction.";
  message(
    "Transaction imported. Refresh chain data before balancing.",
    "success",
  );
}
function importError(error) {
  $("#import-error").textContent = error.message;
  $("#import-error").hidden = false;
}
$("#import-recipe").onclick = () => {
  $("#import-json").value = "";
  $("#import-error").hidden = true;
  $("#import-dialog").showModal();
  $("#import-json").focus();
};
$("#close-import").onclick = () => $("#import-dialog").close();
$("#import-json").oninput = () => {
  $("#import-error").hidden = true;
};
$("#import-json-submit").onclick = () => {
  try {
    importRecipe($("#import-json").value);
    $("#import-dialog").close();
  } catch (error) {
    importError(error);
  }
};
$("#import-json-file").onclick = () => $("#recipe-file").click();
$("#recipe-file").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2e6)
      throw new Error("Transaction JSON is too large (maximum 2 MB).");
    const text = await file.text();
    $("#import-json").value = text;
    importRecipe(text);
    $("#import-dialog").close();
  } catch (error) {
    if (!$("#import-dialog").open) $("#import-dialog").showModal();
    importError(error);
  } finally {
    event.target.value = "";
  }
};
$("#export-recipe").onclick = () => {
  $("#export-json").value = recipeJson();
  $("#export-message").hidden = true;
  $("#copy-recipe-json").textContent = "Copy JSON";
  $("#export-dialog").showModal();
  $("#export-json").focus();
  $("#export-json").select();
};
$("#close-export").onclick = () => $("#export-dialog").close();
$("#copy-recipe-json").onclick = async () => {
  const text = $("#export-json");
  try {
    await navigator.clipboard.writeText(text.value);
    $("#copy-recipe-json").textContent = "Copied";
    $("#export-message").textContent = "Transaction JSON copied.";
  } catch {
    text.focus();
    text.select();
    $("#export-message").textContent =
      "Clipboard access is unavailable. The JSON is selected; press Ctrl+C or Cmd+C to copy it.";
  }
  $("#export-message").hidden = false;
};
$("#download-recipe-json").onclick = () =>
  download("transaction-recipe.json", $("#export-json").value);
$("#download-tx").onclick = () =>
  state.result &&
  download(
    `${state.result.transaction.txId}.unsigned.json`,
    state.result.transaction.textEnvelope,
  );
$("#download-signed").onclick = () =>
  state.signed &&
  download(
    `${state.signed.transaction.txId}.signed.json`,
    state.signed.transaction.textEnvelope,
  );
for (const b of document.querySelectorAll("[data-tab]"))
  b.onclick = () => {
    state.tab = b.dataset.tab;
    for (const tab of document.querySelectorAll("[data-tab]")) {
      tab.classList.toggle("active", tab === b);
      tab.setAttribute("aria-selected", String(tab === b));
    }
    renderInspection();
  };
setupInspectorPanel();
renderCatalog();
renderBlocks();
renderWallet();
engine.ready
  .then(() => {
    $("#engine-status").textContent = "WASM ready";
    $("#engine-status").className = "status ready";
  })
  .catch((e) => {
    $("#engine-status").textContent = "Engine unavailable";
    message(e.message, "error");
  });
// Browser acceptance tests use the same worker and public wallet handshake.
window.scTools = {
  ready: engine.ready,
  run: (payload) => engine.run(payload),
  get recipe() {
    return structuredClone(state.blocks);
  },
  get result() {
    return state.result;
  },
  get signed() {
    return state.signed;
  },
};
