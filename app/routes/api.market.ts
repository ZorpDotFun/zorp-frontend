import { isAddress, type Address } from "viem";
import { etherscanChainId } from "../lib/etherscan.server";
import { readIndexedHolders, readIndexedTrades } from "../lib/market-index.server";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!isAddress(token) || (kind !== "holders" && kind !== "trades")) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const chainId = etherscanChainId(url.searchParams.get("chainId"));
  const creator = url.searchParams.get("creator") ?? undefined;
  const poolId = url.searchParams.get("poolId") ?? undefined;
  const pairAsset = url.searchParams.get("pairAsset") ?? undefined;
  const tokenIsCurrency0 = url.searchParams.get("tokenIsCurrency0") === "1";

  try {
    const data =
      kind === "holders"
        ? await readIndexedHolders({
            token: token as Address,
            creator,
            poolId,
            pairAsset,
            tokenIsCurrency0,
            chainId,
          })
        : await readIndexedTrades({
            token: token as Address,
            creator,
            poolId,
            pairAsset,
            tokenIsCurrency0,
            chainId,
          });
    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=8, stale-while-revalidate=20" },
    });
  } catch (error) {
    console.error("market", error instanceof Error ? error.message : error);
    return Response.json({ error: "market unavailable" }, { status: 502 });
  }
}
