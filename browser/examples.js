import { makeBlock, adaToLovelace } from "./blocks.js";
import { ada } from "./format.js";

export const exampleKinds = {
  lock: {
    title: "Lock ADA · redeemer = datum",
    description:
      "Send ADA to a Plutus V2 script with an integer datum. Anyone can unlock it by supplying that integer; the datum is public.",
    next: "Balance, sign and submit. After confirmation, open Examples → Unlock ADA. This tab remembers the submitted output.",
  },
  unlock: {
    title: "Unlock ADA · redeemer = datum",
    description:
      "Spend a confirmed output from the lock example. The redeemer must equal its datum. Try a different integer to see script evaluation fail during balancing.",
    next: "The script input funds this transaction. ADA remaining after the payment and fee returns to your wallet as change.",
  },
  "native-mint": {
    title: "Mint tokens · wallet signature",
    description:
      "A native minting policy requires your wallet's payment-key signature. The policy ID is derived from that key inside WASM.",
    next: "Balance, sign and submit. After confirmation, refresh the same wallet and load Burn tokens · wallet signature.",
  },
  "native-burn": {
    title: "Burn tokens · wallet signature",
    description:
      "Burn tokens created by the wallet-signature example using the same wallet, policy and token name. Enter a positive amount here; the mint block will contain a negative quantity.",
    next: "Refresh your wallet after the mint confirms. The wallet signature authorizes the burn; remaining tokens return as change.",
  },
  "plutus-mint": {
    title: "Mint tokens · redeemer = 42",
    description:
      "A Plutus V2 minting policy accepts integer redeemer 42. Anyone can mint under this public example policy. Try 41 to see balancing reject it.",
    next: "Balance, sign and submit. After confirmation, refresh your wallet and load Burn tokens · redeemer = 42.",
  },
  "plutus-burn": {
    title: "Burn tokens · redeemer = 42",
    description:
      "Burn tokens from the Plutus mint example. The same policy requires redeemer 42 for burning as well as minting.",
    next: "Refresh your wallet after the mint confirms. Enter a positive amount here; the mint block will contain a negative quantity.",
  },
  collateral: {
    title: "Prepare collateral · 5 ADA",
    description:
      "Create a separate ADA-only output in your wallet for Plutus collateral. The output is paid back to your own address.",
    next: "Balance, sign and submit. After confirmation, refresh your wallet and choose this output as collateral in a Plutus example.",
  },
};

const integer = (value, label) => {
  const text = String(value).trim();
  if (!/^-?(0|[1-9][0-9]*)$/.test(text))
    throw new Error(`${label} must be a whole integer.`);
  return text;
};
const tokenHex = (name) => {
  const bytes = new TextEncoder().encode(name);
  if (!bytes.length || bytes.length > 32)
    throw new Error("Token names must contain 1–32 UTF-8 bytes.");
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
const needsCollateral = (kind) =>
  kind === "unlock" || kind.startsWith("plutus-");
export function collateralOptions(wallet) {
  return (wallet?.utxos || [])
    .filter(
      (u) => !u.output.assets.length && BigInt(u.output.lovelace) >= 5000000n,
    )
    .sort((a, b) =>
      BigInt(a.output.lovelace) < BigInt(b.output.lovelace) ? -1 : 1,
    );
}

export function exampleRecipe(kind, options) {
  const { network, wallet, scripts } = options;
  if (!exampleKinds[kind]) throw new Error("Choose an example.");
  if (!["preprod", "preview"].includes(network))
    throw new Error("Choose Preprod or Preview. These examples use test ADA.");
  if (!wallet)
    throw new Error("Connect your testnet wallet first, then reopen Examples.");
  const output = (data) =>
    makeBlock("output", { address: wallet.changeAddress, ada: "2", ...data });
  const blocks = [];
  if (needsCollateral(kind)) {
    const collateral = collateralOptions(wallet).find(
      (u) => u.input === options.collateral,
    );
    if (!collateral || wallet.utxos.length < 2)
      throw new Error(
        "Use Prepare collateral first: Plutus examples need a separate ADA-only wallet UTXO of at least 5 ADA, plus another UTXO for fees.",
      );
    if (options.input?.trim().toLowerCase() === collateral.input)
      throw new Error(
        "The script input and collateral must be different UTXOs.",
      );
    blocks.push(makeBlock("collateral", { input: collateral.input }));
  }
  if (kind === "collateral") return [output({ ada: "5" })];
  if (kind === "lock") {
    if (BigInt(adaToLovelace(options.amount)) < 2000000n)
      throw new Error("Lock at least 2 ADA for this example.");
    return [
      output({
        address: scripts.matchingNumber.address,
        ada: options.amount.trim(),
        datumMode: "inline",
        datum: `{"int":${integer(options.datum, "Datum")}}`,
      }),
    ];
  }
  if (kind === "unlock") {
    const input = options.input.trim().toLowerCase();
    if (
      !/^[0-9a-f]{64}#[0-9]+$/.test(input) ||
      Number(input.split("#")[1]) > 65535
    )
      throw new Error(
        "Paste the confirmed lock output as transaction-hash#output-index.",
      );
    blocks.unshift(
      makeBlock("input", {
        input,
        witnessMode: "PlutusV2",
        source: "inline",
        scriptCbor: scripts.matchingNumber.scriptCbor,
        datumMode: "inline",
        redeemer: `{"int":${integer(options.redeemer, "Redeemer")}}`,
      }),
    );
    return [...blocks, output({})];
  }
  const native = kind.startsWith("native-"),
    burn = kind.endsWith("-burn");
  const script = native ? scripts.nativeSignature : scripts.redeemer42;
  if (!script)
    throw new Error("This example requires a wallet with a payment key.");
  const quantity = integer(options.quantity, "Token quantity");
  if (BigInt(quantity) <= 0n)
    throw new Error("Token quantity must be positive.");
  const assetName = tokenHex(options.tokenName);
  if (burn) {
    const owned = wallet.utxos
      .flatMap((u) => u.output.assets)
      .filter(
        (a) => a.policyId === script.policyId && a.assetName === assetName,
      )
      .reduce((n, a) => n + BigInt(a.quantity), 0n);
    if (owned < BigInt(quantity))
      throw new Error(
        `Your wallet has ${owned} of this token. Confirm the mint, refresh your wallet, and use the same token name and policy.`,
      );
  }
  blocks.push(
    makeBlock("mint", {
      policyId: script.policyId,
      assets: JSON.stringify([
        { assetName, quantity: burn ? `-${quantity}` : quantity },
      ]),
      witnessMode: script.language,
      ...(native
        ? { nativeScript: JSON.stringify(script.nativeScript) }
        : {
            scriptCbor: script.scriptCbor,
            redeemer: `{"int":${integer(options.redeemer, "Redeemer")}}`,
          }),
    }),
  );
  return [
    ...blocks,
    output({
      assets: JSON.stringify(
        burn ? [] : [{ policyId: script.policyId, assetName, quantity }],
      ),
    }),
  ];
}

export function setupExamples({ engine, context, load }) {
  const $ = (s) => document.querySelector(s);
  const storageKey = "sc-tools-example-receipts-v1";
  let receipts = {};
  let dialogRevision = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    for (const key of ["lock", "native-mint", "plutus-mint"])
      if (saved?.[key] && typeof saved[key] === "object")
        receipts[key] = saved[key];
  } catch {
    /* Session storage is optional. */
  }
  const recent = (kind) => {
    const r = receipts[kind],
      c = context();
    return r?.network === c.network && r.wallet === c.rawWallet?.changeAddress
      ? r
      : null;
  };
  function showError(error) {
    $("#example-error").textContent = error.message;
    $("#example-error").hidden = false;
  }
  function selectExample() {
    dialogRevision++;
    const kind = $("#example-kind").value,
      definition = exampleKinds[kind];
    $("#example-description").textContent = definition.description;
    $("#example-next").textContent = definition.next;
    $("#example-error").hidden = true;
    for (const element of document.querySelectorAll("[data-example-for]"))
      element.hidden = !element.dataset.exampleFor.split(" ").includes(kind);
    const locked = recent("lock");
    $("#example-last-lock").disabled = !locked;
    $("#example-last-lock").textContent = locked
      ? "Use last submitted lock"
      : "No lock submitted from this wallet in this tab";
    if (kind === "unlock") $("#example-input").value = locked?.input || "";
    $("#example-redeemer").value =
      kind === "unlock" && locked ? locked.datum : "42";
    if (kind.includes("-mint") || kind.includes("-burn")) {
      const minted = recent(kind.replace("-burn", "-mint"));
      $("#example-token").value =
        minted?.tokenName ||
        (kind.startsWith("native-") ? "ExampleToken" : "RedeemerToken");
      $("#example-quantity").value = kind.endsWith("-burn")
        ? minted?.quantity || "1"
        : "100";
    }
    const choices = collateralOptions(context().wallet),
      select = $("#example-collateral");
    select.replaceChildren();
    if (!choices.length) select.add(new Option("Prepare collateral first", ""));
    for (const u of choices)
      select.add(
        new Option(`${ada(u.output.lovelace)} ADA · ${u.input}`, u.input),
      );
  }
  $("#examples").onclick = () => {
    selectExample();
    $("#examples-dialog").showModal();
    if (context().network === "mainnet")
      showError(
        new Error("Choose Preprod or Preview. These examples use test ADA."),
      );
  };
  $("#example-kind").onchange = selectExample;
  $("#close-examples").onclick = () => $("#examples-dialog").close();
  $("#examples-dialog").addEventListener("close", () => {
    dialogRevision++;
  });
  $("#example-last-lock").onclick = () => {
    const r = recent("lock");
    if (r) {
      $("#example-input").value = r.input;
      $("#example-redeemer").value = r.datum;
    }
  };
  $("#example-load").onclick = async () => {
    const button = $("#example-load"),
      initial = context(),
      kind = $("#example-kind").value,
      revision = dialogRevision;
    const fields = {
      amount: $("#example-amount").value,
      datum: $("#example-datum").value,
      redeemer: $("#example-redeemer").value,
      input: $("#example-input").value,
      collateral: $("#example-collateral").value,
      tokenName: $("#example-token").value,
      quantity: $("#example-quantity").value,
    };
    button.disabled = true;
    $("#example-error").hidden = true;
    try {
      if (!initial.rawWallet || !initial.wallet)
        throw new Error(
          "Connect your testnet wallet first, then reopen Examples.",
        );
      if (initial.rawWallet.networkId !== 0)
        throw new Error("Switch your wallet to the selected testnet first.");
      const address = initial.rawWallet.changeAddress;
      const paymentKeyHash = [0, 2, 4, 6].includes(parseInt(address[0], 16))
        ? address.slice(2, 58)
        : undefined;
      const scripts = await engine.run({
        action: "exampleScripts",
        network: initial.network,
        paymentKeyHash,
      });
      if (revision !== dialogRevision || !$("#examples-dialog").open) return;
      if (!scripts.ok) throw new Error(scripts.error);
      const now = context();
      if (
        now.network !== initial.network ||
        now.rawWallet?.changeAddress !== address
      )
        throw new Error("Wallet or network changed. Open Examples again.");
      const blocks = exampleRecipe(kind, {
        ...initial,
        scripts,
        ...fields,
      });
      load({ kind, scripts, blocks, ...exampleKinds[kind] });
      $("#examples-dialog").close();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  };
  return {
    remember(example, result, transaction) {
      if (!example || result.network === "mainnet") return "";
      const common = { network: result.network, wallet: result.walletIdentity };
      if (example.kind === "lock") {
        const index = transaction.outputs.findIndex(
          (o) =>
            o.address === example.scripts.matchingNumber.address &&
            o.datum?.int !== undefined,
        );
        if (index < 0) return "";
        receipts.lock = {
          ...common,
          input: `${transaction.txId}#${index}`,
          datum: String(transaction.outputs[index].datum.int),
        };
      } else if (["native-mint", "plutus-mint"].includes(example.kind)) {
        const policy =
          example.kind === "native-mint"
            ? example.scripts.nativeSignature
            : example.scripts.redeemer42;
        const asset = transaction.mint.find(
          (a) => a.policyId === policy.policyId && BigInt(a.quantity) > 0n,
        );
        if (!asset) return "";
        try {
          const tokenName = new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(asset.assetName.match(/../g) || [], (b) =>
              parseInt(b, 16),
            ),
          );
          receipts[example.kind] = {
            ...common,
            tokenName,
            quantity: asset.quantity,
          };
        } catch {
          return "";
        }
      } else return "";
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(receipts));
      } catch {
        /* Keep this tab's in-memory receipt. */
      }
      return example.kind === "lock"
        ? " After confirmation, open Examples → Unlock ADA; the submitted output is filled in."
        : " After confirmation, refresh your wallet and open the matching burn example.";
    },
  };
}
