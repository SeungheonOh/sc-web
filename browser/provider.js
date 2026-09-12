const MAX_AGE = 5 * 60 * 1000;
const n = (value, name) => {
  if (value === null || value === undefined || value === "")
    throw new Error(`Provider omitted protocol parameter ${name}.`);
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new Error(`Invalid protocol parameter ${name}.`);
  return result;
};
export function protocolParameters(p) {
  const number = (key) => n(p[key], key);
  const drep = {
    committeeNoConfidence: "dvt_committee_no_confidence",
    committeeNormal: "dvt_committee_normal",
    hardForkInitiation: "dvt_hard_fork_initiation",
    motionNoConfidence: "dvt_motion_no_confidence",
    ppEconomicGroup: "dvt_p_p_economic_group",
    ppGovGroup: "dvt_p_p_gov_group",
    ppNetworkGroup: "dvt_p_p_network_group",
    ppTechnicalGroup: "dvt_p_p_technical_group",
    treasuryWithdrawal: "dvt_treasury_withdrawal",
    updateToConstitution: "dvt_update_to_constitution",
  };
  const pools = {
    committeeNoConfidence: "pvt_committee_no_confidence",
    committeeNormal: "pvt_committee_normal",
    hardForkInitiation: "pvt_hard_fork_initiation",
    motionNoConfidence: "pvt_motion_no_confidence",
    ppSecurityGroup:
      p.pvt_p_p_security_group != null
        ? "pvt_p_p_security_group"
        : "pvtpp_security_group",
  };
  return {
    collateralPercentage: number("collateral_percent"),
    committeeMaxTermLength: number("committee_max_term_length"),
    committeeMinSize: number("committee_min_size"),
    costModels: p.cost_models_raw || p.cost_models,
    dRepActivity: number("drep_activity"),
    dRepDeposit: number("drep_deposit"),
    dRepVotingThresholds: Object.fromEntries(
      Object.entries(drep).map(([k, v]) => [k, number(v)]),
    ),
    executionUnitPrices: {
      priceMemory: number("price_mem"),
      priceSteps: number("price_step"),
    },
    govActionDeposit: number("gov_action_deposit"),
    govActionLifetime: number("gov_action_lifetime"),
    maxBlockBodySize: number("max_block_size"),
    maxBlockExecutionUnits: {
      memory: number("max_block_ex_mem"),
      steps: number("max_block_ex_steps"),
    },
    maxBlockHeaderSize: number("max_block_header_size"),
    maxCollateralInputs: number("max_collateral_inputs"),
    maxTxExecutionUnits: {
      memory: number("max_tx_ex_mem"),
      steps: number("max_tx_ex_steps"),
    },
    maxTxSize: number("max_tx_size"),
    maxValueSize: number("max_val_size"),
    minFeeRefScriptCostPerByte: number("min_fee_ref_script_cost_per_byte"),
    minPoolCost: number("min_pool_cost"),
    monetaryExpansion: number("rho"),
    poolPledgeInfluence: number("a0"),
    poolRetireMaxEpoch: number("e_max"),
    poolVotingThresholds: Object.fromEntries(
      Object.entries(pools).map(([k, v]) => [k, number(v)]),
    ),
    protocolVersion: {
      major: number("protocol_major_ver"),
      minor: number("protocol_minor_ver"),
    },
    stakeAddressDeposit: number("key_deposit"),
    stakePoolDeposit: number("pool_deposit"),
    stakePoolTargetNum: number("n_opt"),
    treasuryCut: number("tau"),
    txFeeFixed: number("min_fee_b"),
    txFeePerByte: number("min_fee_a"),
    utxoCostPerByte: number("coins_per_utxo_size"),
  };
}
export function validateSnapshot(snapshot, network) {
  if (snapshot.network !== network)
    throw new Error("Chain snapshot is for a different network.");
  if (
    !snapshot.protocolParameters ||
    !Array.isArray(snapshot.eraSummaries) ||
    !snapshot.eraSummaries.length ||
    !snapshot.systemStart ||
    !snapshot.tip
  )
    throw new Error(
      "Snapshot needs protocolParameters, eraSummaries, systemStart, network, tip, and fetchedAt.",
    );
  if (
    !Number.isFinite(snapshot.fetchedAt) ||
    Date.now() - snapshot.fetchedAt > MAX_AGE ||
    snapshot.fetchedAt > Date.now() + 60000
  )
    throw new Error(
      "Chain snapshot is stale. Fetch a snapshot from the last five minutes.",
    );
  if (![9, 10, 11].includes(snapshot.protocolParameters.protocolVersion?.major))
    throw new Error(
      "This engine supports the Conway era. These protocol parameters require a newer build.",
    );
  if (snapshot.eraSummaries.some((e) => !e.start || !e.end || !e.parameters))
    throw new Error(
      "Era summaries must include exact starts, finite safe horizons, and timing parameters.",
    );
  return snapshot;
}
export class Blockfrost {
  constructor(network, key) {
    if (!/^(mainnet|preprod|preview)$/.test(network))
      throw new Error("Choose a supported network.");
    if (!key.trim())
      throw new Error(
        "Enter a Blockfrost project ID under Chain data, or import a recent chain snapshot. CIP-30 does not supply protocol parameters.",
      );
    this.network = network;
    this.key = key.trim();
    this.base = `https://cardano-${network}.blockfrost.io/api/v0`;
    this.memo = new Map();
  }
  async get(path) {
    const r = await fetch(this.base + path, {
      headers: { project_id: this.key },
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`Chain provider: ${body.message || r.status}`);
    return body;
  }
  async chain() {
    const [p, eraSummaries, g, tip] = await Promise.all([
      this.get("/epochs/latest/parameters"),
      this.get("/network/eras"),
      this.get("/genesis"),
      this.get("/blocks/latest"),
    ]);
    return validateSnapshot(
      {
        network: this.network,
        protocolParameters: protocolParameters(p),
        eraSummaries,
        systemStart: String(g.system_start),
        tip: {
          slot: tip.slot,
          epoch: tip.epoch,
          hash: tip.hash,
          time: tip.time,
        },
        fetchedAt: Date.now(),
        source: "Blockfrost",
      },
      this.network,
    );
  }
  async referenceScript(hash) {
    if (this.memo.has(hash)) return this.memo.get(hash);
    const info = await this.get(`/scripts/${hash}`);
    let script;
    if (info.type === "timelock") {
      const json = await this.get(`/scripts/${hash}/json`);
      script = { language: "Native", nativeScript: json.json };
    } else {
      const bytes = await this.get(`/scripts/${hash}/cbor`);
      const language = {
        plutusV1: "PlutusV1",
        plutusV2: "PlutusV2",
        plutusV3: "PlutusV3",
      }[info.type];
      if (!language)
        throw new Error(`Unsupported reference script language ${info.type}.`);
      script = { language, scriptCbor: bytes.cbor };
    }
    this.memo.set(hash, script);
    return script;
  }
  async resolve(input) {
    const match = /^([0-9a-f]{64})#([0-9]+)$/i.exec(input);
    if (!match) throw new Error("Input must be transaction-hash#output-index.");
    const [, hash, index] = match;
    const key = `tx:${hash}`;
    let tx = this.memo.get(key);
    if (!tx) {
      tx = await this.get(`/txs/${hash}/utxos`);
      this.memo.set(key, tx);
    }
    const found = tx.outputs.find((o) => o.output_index === Number(index));
    if (!found)
      throw new Error(`Output ${input} does not exist on ${this.network}.`);
    if (found.consumed_by_tx)
      throw new Error(`Output ${input} has already been spent.`);
    const amount = found.amount;
    const output = {
      address: found.address,
      lovelace: amount.find((a) => a.unit === "lovelace")?.quantity || "0",
      assets: amount
        .filter((a) => a.unit !== "lovelace")
        .map((a) => ({
          policyId: a.unit.slice(0, 56),
          assetName: a.unit.slice(56),
          quantity: a.quantity,
        })),
      datumMode: found.inline_datum
        ? "inline"
        : found.data_hash
          ? "hash"
          : "none",
    };
    if (found.inline_datum) output.datumCbor = found.inline_datum;
    else if (found.data_hash) output.datumHash = found.data_hash;
    if (found.reference_script_hash)
      output.referenceScript = await this.referenceScript(
        found.reference_script_hash,
      );
    return { input, output };
  }
  async assertNetwork(wallet) {
    if (wallet.utxos.length) {
      const first = wallet.utxos[0].input;
      await this.resolve(first);
    }
  }
}
