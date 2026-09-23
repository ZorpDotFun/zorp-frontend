import { defineChain, fallback, http } from "viem";
import { MULTICALL3 } from "./addresses";

export const ARC_CHAIN_ID = 5042;
export const ARC_EXPLORER =
  import.meta.env.VITE_ARC_EXPLORER || "https://arcexplorer.org";

export const ARC_RPC_PRIMARY = "https://rpc.arc-scan.org";

export const ARC_RPCS = [
  import.meta.env.VITE_ARC_RPC,
  ARC_RPC_PRIMARY,
  "https://rpc.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
  "https://arcexplorer.org/rpc",
  "https://thecusp.io/api/arc-rpc",
  "https://warp-arc-production.up.railway.app/rpc",
].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);

export const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ARC_RPCS },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: ARC_EXPLORER },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
});

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_EXPLORER =
  import.meta.env.VITE_RH_EXPLORER || "https://robinhoodchain.blockscout.com";
export const ROBINHOOD_RPC_PRIMARY =
  import.meta.env.VITE_RH_RPC || "https://rpc.mainnet.chain.robinhood.com";

export const ROBINHOOD_RPCS = [ROBINHOOD_RPC_PRIMARY].filter(
  (url, index, all): url is string => Boolean(url) && all.indexOf(url) === index,
);

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ROBINHOOD_RPCS },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: ROBINHOOD_EXPLORER },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
});

export function rpcTransport(urls: string[]) {
  return fallback(
    urls.map((url) =>
      http(url, {
        timeout: 8_000,
        retryCount: 0,
        fetchFn: failoverFetch,
      }),
    ),
    { rank: false },
  );
}

export function arcTransport() {
  return rpcTransport(ARC_RPCS);
}

export function robinhoodTransport() {
  return rpcTransport(ROBINHOOD_RPCS);
}

async function failoverFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  if (response.status === 429 || response.status === 503 || deadRpc(text)) {
    throw new Error(`rpc ${response.status}`);
  }
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function deadRpc(body: string) {
  return /rate limit|too many requests|could not complete this request|no answer was obtained|method not found|pruned history|limit exceeded/i.test(
    body,
  );
}
