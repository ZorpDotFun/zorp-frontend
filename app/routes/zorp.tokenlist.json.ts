import type { Route } from "./+types/zorp.tokenlist.json";
import { buildZorpTokenList } from "../lib/zorp-token-list";

export async function loader({}: Route.LoaderArgs) {
  const list = await buildZorpTokenList();
  return new Response(JSON.stringify(list), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}
