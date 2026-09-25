import { RH_LAUNCH_FACTORY } from "./addresses";
import { ROBINHOOD_CHAIN_ID } from "./chains";
import { publicClient } from "./factory";
import { getNetworkId } from "./active-network";
import { requestTokenVerification } from "./verify-launch-token";

const launchCountAbi = [
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allTokens",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

let started = false;

/** Sourcify-only, current pad, after the tape has already loaded. */
export function requestHistoricRhVerification() {
  if (started || getNetworkId() !== "robinhood") return;
  started = true;
  void backfill().catch(() => {
    started = false;
  });
}

async function backfill() {
  let count = 0;
  try {
    count = Number(
      await publicClient.readContract({
        address: RH_LAUNCH_FACTORY,
        abi: launchCountAbi,
        functionName: "launchCount",
      }),
    );
  } catch {
    return;
  }
  const n = Math.min(Number.isFinite(count) ? count : 0, 64);
  for (let index = 0; index < n; index += 1) {
    try {
      const token = await publicClient.readContract({
        address: RH_LAUNCH_FACTORY,
        abi: launchCountAbi,
        functionName: "allTokens",
        args: [BigInt(index)],
      });
      requestTokenVerification({
        address: token,
        chainId: ROBINHOOD_CHAIN_ID,
        wait: false,
      });
    } catch {
      /* skip a dead slot */
    }
  }
}
