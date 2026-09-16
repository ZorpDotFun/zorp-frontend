import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAddress } from "viem";
import type { Route } from "./+types/api.verify";
import { ARC_CHAIN_ID } from "../lib/chains";
import {
  COMPILER,
  CONTRACT_NAME,
  CONTRACT_PATH,
  IDENTIFIER,
} from "../lib/verify-launch-token";

type StdJson = {
  language: string;
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};

type VerifyResult = {
  sourcify?: unknown;
  arcscan?: unknown;
  arcexplorer?: unknown;
};

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "zorp-verify/1.0",
};

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as {
    address?: string;
    hash?: string;
  } | null;
  const address = body?.address?.trim();
  if (!address || !isAddress(address)) {
    return Response.json({ error: "Valid token address required." }, { status: 400 });
  }

  const stdJson = await loadStdJson();
  const hash = body?.hash?.trim();
  const result: VerifyResult = {};

  result.sourcify = await submitSourcify(address, stdJson, hash);
  result.arcexplorer = await submitArcExplorer(address, stdJson);
  result.arcscan = await submitArcscan(address, stdJson, hash);

  return Response.json({ address, ...result });
}

async function loadStdJson(): Promise<StdJson> {
  const file = path.join(process.cwd(), "app/data/launch-token.stdjson.json");
  return JSON.parse(await readFile(file, "utf8")) as StdJson;
}

async function submitSourcify(address: string, stdJson: StdJson, hash?: string) {
  const already = await getJson(
    `https://sourcify.dev/server/v2/contract/${ARC_CHAIN_ID}/${address}`,
  );
  if (already && already.match === "exact_match") {
    return { match: "exact_match", reused: true };
  }

  const submitted = await postJson(
    `https://sourcify.dev/server/v2/verify/${ARC_CHAIN_ID}/${address}`,
    {
      stdJsonInput: stdJson,
      compilerVersion: COMPILER,
      contractIdentifier: IDENTIFIER,
      ...(hash ? { creationTransactionHash: hash } : {}),
    },
  );
  const verificationId = submitted?.verificationId as string | undefined;
  if (!verificationId) return submitted;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const job = await getJson(`https://sourcify.dev/server/v2/verify/${verificationId}`);
    if (job?.isJobCompleted) {
      const lookup = await getJson(
        `https://sourcify.dev/server/v2/contract/${ARC_CHAIN_ID}/${address}`,
      );
      return {
        verificationId,
        match: lookup?.match ?? job.match,
        runtimeMatch: lookup?.runtimeMatch,
        creationMatch: lookup?.creationMatch,
      };
    }
    await sleep(2_000);
  }
  return { verificationId, pending: true };
}

async function submitArcscan(address: string, stdJson: StdJson, hash?: string) {
  return postJson(`https://api.arc-scan.org/v1/verify/${address}`, {
    compiler_version: COMPILER,
    method: "std-json",
    language: stdJson.language,
    sources: stdJson.sources,
    settings: stdJson.settings,
    contract_identifier: IDENTIFIER,
    license: "MIT",
    ...(hash ? { creation_transaction_hash: hash } : {}),
  });
}

async function submitArcExplorer(address: string, stdJson: StdJson) {
  return postJson("https://arcexplorer.org/api/v1/contracts/verify", {
    address,
    compilerVersion: COMPILER,
    contractPath: CONTRACT_PATH,
    contractName: CONTRACT_NAME,
    sources: stdJson.sources,
    settings: stdJson.settings,
  });
}

async function postJson(url: string, body: unknown) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    try {
      return { status: response.status, ...(JSON.parse(text) as object) };
    } catch {
      return { status: response.status, body: text.slice(0, 300) };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "request failed" };
  }
}

async function getJson(url: string) {
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
