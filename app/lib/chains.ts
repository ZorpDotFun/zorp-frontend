import { defineChain, fallback, http } from "viem";
import { MULTICALL3 } from "./addresses";
import { PUBLIC_RH_RPC, rhLogTargets, rhRpcTargets, rhRpcTimeout } from "./rh-server-rpc";

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
export const ROBINHOOD_PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const RH_RPC_PROXY = "/api/rh-rpc";

function serverRhRpc() {
  return ROBINHOOD_PUBLIC_RPC;
}

/** Browser talks to our proxy so the RPC key never ships to users. */
export function robinhoodRpcUrl() {
  if (
    typeof window !== "undefined" &&
    typeof window.location?.origin === "string" &&
    window.location.origin.startsWith("http")
  ) {
    return `${window.location.origin}${RH_RPC_PROXY}`;
  }
  return serverRhRpc();
}

export const ROBINHOOD_RPC_PRIMARY = ROBINHOOD_PUBLIC_RPC;

export const ROBINHOOD_RPCS = [ROBINHOOD_RPC_PRIMARY];

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ROBINHOOD_PUBLIC_RPC] },
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
  return fallback(
    [
      http(ROBINHOOD_PUBLIC_RPC, {
        timeout: 25_000,
        retryCount: 0,
        fetchFn: (input, init) => rhFetch(robinhoodRpcUrl(), init),
      }),
    ],
    { rank: false },
  );
}

function usesLogs(body: string) {
  return /"method"\s*:\s*"eth_getLogs"|"method"\s*:\s*"eth_newFilter"|"method"\s*:\s*"eth_getFilterLogs"/.test(
    body,
  );
}

async function rhFetch(input: RequestInfo | URL, init?: RequestInit) {
  const body = typeof init?.body === "string" ? init.body : "";
  const target =
    typeof document === "undefined" && usesLogs(body)
      ? ROBINHOOD_PUBLIC_RPC
      : input;
  return failoverFetch(target, init);
}

function rhFailoverQueue(input: RequestInfo | URL) {
  const first =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String(input);
  if (first.includes(RH_RPC_PROXY)) return [first];
  if (first !== PUBLIC_RH_RPC && !first.includes("robinhood")) return [first];
  return [first, ...rhRpcTargets().filter((url) => url !== first)].filter(
    (url, index, all) => Boolean(url) && all.indexOf(url) === index,
  );
}

function rhLogFailoverQueue(input: RequestInfo | URL) {
  const first =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String(input);
  if (first.includes(RH_RPC_PROXY)) return [first];
  return [first, ...rhLogTargets().filter((url) => url !== first)].filter(
    (url, index, all) => Boolean(url) && all.indexOf(url) === index,
  );
}

async function failoverFetch(input: RequestInfo | URL, init?: RequestInit) {
  const body = typeof init?.body === "string" ? init.body : "";
  const logs = usesLogs(body);
  const queue = logs ? rhLogFailoverQueue(input) : rhFailoverQueue(input);
  let lastError: Error | null = null;
  for (const target of queue) {
    try {
      const response = await fetch(target, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(rhRpcTimeout(target, logs)),
      });
      const text = await response.text();
      if (response.status === 429 || response.status === 503 || deadRpc(text)) {
        lastError = new Error(`rpc ${response.status}`);
        continue;
      }
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("rpc failed");
    }
  }
  throw lastError ?? new Error("rpc failed");
}

function deadRpc(body: string) {
  return /rate limit|too many requests|could not complete this request|no answer was obtained|method not found|pruned history|limit exceeded|block range|free tier|invalid parameters/i.test(
    body,
  );
}
