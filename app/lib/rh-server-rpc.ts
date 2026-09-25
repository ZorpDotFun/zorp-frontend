export const PUBLIC_RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const BLOCKSCOUT_RH_RPC = "https://robinhoodchain.blockscout.com/api/eth-rpc";
const ALCHEMY_RH_HOST = "https://robinhood-mainnet.g.alchemy.com/v2";

export function paidRhRpc() {
  return PUBLIC_RH_RPC;
}

export function blockscoutRhRpc() {
  const key =
    (typeof process !== "undefined" && process.env.BLOCKSCOUT_API_KEY?.trim()) ||
    "";
  return key ? `${BLOCKSCOUT_RH_RPC}?apikey=${encodeURIComponent(key)}` : BLOCKSCOUT_RH_RPC;
}

export function alchemyRhRpc() {
  const https =
    (typeof process !== "undefined" && process.env.ALCHEMY_HTTPS?.trim()) || "";
  if (https) return https;
  const key =
    (typeof process !== "undefined" && process.env.ALCHEMY_API_KEY?.trim()) || "";
  return key ? `${ALCHEMY_RH_HOST}/${key}` : "";
}

/** Public, then Blockscout, then Alchemy. Next target is immediate on fail. */
export function rhRpcTargets() {
  return [PUBLIC_RH_RPC, blockscoutRhRpc(), alchemyRhRpc()].filter(
    (url, index, all) => Boolean(url) && all.indexOf(url) === index,
  );
}

export function rhRpcTimeout(url: string) {
  if (url === PUBLIC_RH_RPC || url.includes("blockscout.com")) return 4_000;
  return 8_000;
}
