export const discoverWallets = () =>
  Object.entries(window.cardano || {})
    .filter(([, wallet]) => wallet && typeof wallet.enable === "function")
    .map(([id, wallet]) => ({
      id,
      name: wallet.name || id,
      icon: wallet.icon,
      wallet,
    }));
export function walletError(error) {
  return error?.info || error?.message || String(error);
}
export async function readWallet(api) {
  const [networkId, changeAddress, outputs, rewardAddresses] =
    await Promise.all([
      api.getNetworkId(),
      api.getChangeAddress(),
      api.getUtxos(),
      api.getRewardAddresses(),
    ]);
  const utxos = outputs ?? [];
  if (![0, 1].includes(networkId))
    throw new Error("This wallet network is not supported.");
  if (
    typeof changeAddress !== "string" ||
    !Array.isArray(utxos) ||
    !utxos.every((v) => typeof v === "string")
  )
    throw new Error("The wallet did not return valid CIP-30 UTXOs.");
  return { networkId, changeAddress, utxos, rewardAddresses };
}
export async function collateralFromWallet(api) {
  const owner =
    typeof api.getCollateral === "function" ? api : api.experimental;
  if (typeof owner?.getCollateral !== "function") return [];
  try {
    return (await owner.getCollateral()) || [];
  } catch {
    return [];
  }
}
