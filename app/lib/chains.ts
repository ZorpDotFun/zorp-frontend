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

export function arcTransport() {
  return fallback(
    ARC_RPCS.map((url) =>
      http(url, {
        timeout: 12_000,
        retryCount: 0,
        fetch: failoverFetch,
      }),
    ),
    { rank: false },
  );
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
  return /rate limit|too many requests|could not complete this request|no answer was obtained|method not found/i.test(
    body,
  );
}
