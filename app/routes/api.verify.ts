import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  isAddress,
  parseAbi,
} from "viem";
import type { Route } from "./+types/api.verify";
import { ARC_CHAIN_ID, ROBINHOOD_CHAIN_ID } from "../lib/chains";
import { ARC_VERIFY, RH_VERIFY } from "../lib/verify-launch-token";

type StdJson = {
  language: string;
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};

type VerifyTarget = {
  chainId: number;
  compiler: string;
  identifier: string;
  path: string;
  name: string;
  stdJson: string;
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
    chainId?: number;
    constructorArgs?: string;
    wait?: boolean;
  } | null;
  const address = body?.address?.trim();
  if (!address || !isAddress(address)) {
    return Response.json({ error: "Valid token address required." }, { status: 400 });
  }

  const target = targetOf(body?.chainId);
  const stdJson = await loadStdJson(target.stdJson);
  const hash = body?.hash?.trim();
  const wait = body?.wait !== false;
  const constructorArgs =
    body?.constructorArgs?.trim() ||
    (wait && target.chainId === ROBINHOOD_CHAIN_ID
      ? await rhTokenConstructorArgs(address)
      : undefined);

  const sourcify = await submitSourcify(target, address, stdJson, hash, wait);
  const blockscout =
    wait && target.chainId === ROBINHOOD_CHAIN_ID
      ? await submitBlockscout(target, address, stdJson, constructorArgs)
      : undefined;
  const etherscan =
    wait && target.chainId === ROBINHOOD_CHAIN_ID
      ? await submitEtherscan(target, address, stdJson, constructorArgs)
      : undefined;
  const arcscan =
    target.chainId === ARC_CHAIN_ID
      ? await submitArcscan(target, address, stdJson, hash)
      : undefined;
  const arcexplorer =
    target.chainId === ARC_CHAIN_ID
      ? await submitArcExplorer(target, address, stdJson)
      : undefined;

  return Response.json({
    address,
    chainId: target.chainId,
    sourcify,
    ...(blockscout ? { blockscout } : {}),
    ...(etherscan ? { etherscan } : {}),
    ...(arcscan ? { arcscan } : {}),
    ...(arcexplorer ? { arcexplorer } : {}),
  });
}

function targetOf(chainId?: number): VerifyTarget {
  if (chainId === ROBINHOOD_CHAIN_ID) {
    return { chainId: ROBINHOOD_CHAIN_ID, ...RH_VERIFY };
  }
  return { chainId: ARC_CHAIN_ID, ...ARC_VERIFY };
}

async function loadStdJson(rel: string): Promise<StdJson> {
  const file = path.join(process.cwd(), rel);
  return JSON.parse(await readFile(file, "utf8")) as StdJson;
}

async function submitSourcify(
  target: VerifyTarget,
  address: string,
  stdJson: StdJson,
  hash?: string,
  wait = true,
) {
  const already = await getJson(
    `https://sourcify.dev/server/v2/contract/${target.chainId}/${address}`,
  );
  if (already && (already.match === "exact_match" || already.match === "match")) {
    return { match: already.match, reused: true };
  }

  const submitted = await postJson(
    `https://sourcify.dev/server/v2/verify/${target.chainId}/${address}`,
    {
      stdJsonInput: stdJson,
      compilerVersion: target.compiler,
      contractIdentifier: target.identifier,
      ...(hash ? { creationTransactionHash: hash } : {}),
    },
  );
  const verificationId = submitted?.verificationId as string | undefined;
  if (!verificationId) return submitted;
  if (!wait) return { verificationId, pending: true };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const job = await getJson(`https://sourcify.dev/server/v2/verify/${verificationId}`);
    if (job?.isJobCompleted) {
      const lookup = await getJson(
        `https://sourcify.dev/server/v2/contract/${target.chainId}/${address}`,
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

async function submitBlockscout(
  target: VerifyTarget,
  address: string,
  stdJson: StdJson,
  constructorArgs?: string,
) {
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: JSON.stringify(stdJson),
    codeformat: "solidity-standard-json-input",
    contractname: target.identifier,
    compilerversion: `v${target.compiler}`,
    optimizationUsed: "1",
    runs: "200",
    evmversion: "cancun",
    licenseType: "3",
    ...(constructorArgs ? { constructorArguements: constructorArgs.replace(/^0x/, "") } : {}),
  });

  try {
    const response = await fetch("https://robinhoodchain.blockscout.com/api/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": HEADERS["User-Agent"],
      },
      body,
    });
    const text = await response.text();
    if (text.startsWith("<!DOCTYPE") || text.includes("Just a moment")) {
      return { status: response.status, skipped: true, reason: "cloudflare" };
    }
    try {
      return { status: response.status, ...(JSON.parse(text) as object) };
    } catch {
      return { status: response.status, body: text.slice(0, 300) };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "request failed" };
  }
}

/** Official Etherscan v2: https://docs.etherscan.io/api-reference/endpoint/verifysourcecode */
function etherscanV2Url(chainId: number, query: Record<string, string>) {
  const params = new URLSearchParams({ chainid: String(chainId), ...query });
  return `https://api.etherscan.io/v2/api?${params}`;
}

async function etherscanGet(
  chainId: number,
  key: string,
  action: string,
  extra: Record<string, string>,
) {
  const response = await fetch(
    etherscanV2Url(chainId, { module: "contract", action, apikey: key, ...extra }),
    { headers: { Accept: "application/json", "User-Agent": HEADERS["User-Agent"] } },
  );
  const text = await response.text();
  try {
    return { http: response.status, ...(JSON.parse(text) as Record<string, unknown>) };
  } catch {
    return { http: response.status, body: text.slice(0, 300) };
  }
}

async function submitEtherscan(
  target: VerifyTarget,
  address: string,
  stdJson: StdJson,
  constructorArgs?: string,
) {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return { skipped: true, reason: "ETHERSCAN_API_KEY unset" };

  const existing = await etherscanGet(target.chainId, key, "getsourcecode", {
    address,
  });
  const rows = existing.result;
  const source =
    Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
      ? String((rows[0] as { SourceCode?: string }).SourceCode ?? "")
      : "";
  if (source.length > 2) {
    return { match: "verified", reused: true };
  }

  const form = new URLSearchParams({
    contractaddress: address,
    sourceCode: JSON.stringify(stdJson),
    codeformat: "solidity-standard-json-input",
    contractname: target.identifier,
    compilerversion: `v${target.compiler}`,
    evmVersion: "cancun",
    licenseType: "3",
  });
  const ctor = constructorArgs?.replace(/^0x/i, "");
  if (ctor) form.set("constructorArguments", ctor);

  try {
    const response = await fetch(
      etherscanV2Url(target.chainId, {
        module: "contract",
        action: "verifysourcecode",
        apikey: key,
      }),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": HEADERS["User-Agent"],
        },
        body: form,
      },
    );
    const text = await response.text();
    let submitted: Record<string, unknown>;
    try {
      submitted = { status: response.status, ...(JSON.parse(text) as object) };
    } catch {
      return { status: response.status, body: text.slice(0, 300) };
    }
    const guid = typeof submitted.result === "string" ? submitted.result : "";
    const already =
      guid.toLowerCase().includes("already verified") ||
      String(submitted.message ?? "").toLowerCase().includes("already verified");
    if (already) return { ...submitted, match: "verified", reused: true };
    if (String(submitted.status) !== "1" || !guid) return submitted;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(3_000);
      const job = await etherscanGet(target.chainId, key, "checkverifystatus", {
        guid,
      });
      const result = String(job.result ?? "");
      if (result.toLowerCase().includes("pass")) {
        return { ...submitted, guid, match: "verified", result };
      }
      if (result.toLowerCase().includes("fail")) {
        return { ...submitted, guid, error: result };
      }
    }
    return { ...submitted, guid, pending: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "request failed" };
  }
}

async function submitArcscan(
  target: VerifyTarget,
  address: string,
  stdJson: StdJson,
  hash?: string,
) {
  return postJson(`https://api.arc-scan.org/v1/verify/${address}`, {
    compiler_version: target.compiler,
    method: "std-json",
    language: stdJson.language,
    sources: stdJson.sources,
    settings: stdJson.settings,
    contract_identifier: target.identifier,
    license: "MIT",
    ...(hash ? { creation_transaction_hash: hash } : {}),
  });
}

async function submitArcExplorer(target: VerifyTarget, address: string, stdJson: StdJson) {
  return postJson("https://arcexplorer.org/api/v1/contracts/verify", {
    address,
    compilerVersion: target.compiler,
    contractPath: target.path,
    contractName: target.name,
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

const rhTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function factory() view returns (address)",
  "function creator() view returns (address)",
  "function pairAsset() view returns (address)",
  "function creatorFeeBps() view returns (uint16)",
  "function feeTo() view returns (uint8)",
]);

async function rhTokenConstructorArgs(address: string) {
  try {
    const client = createPublicClient({
      transport: http(
        "https://rpc.mainnet.chain.robinhood.com",
      ),
    });
    const token = address as `0x${string}`;
    const [name, symbol, factory, creator, pairAsset, creatorFeeBps, feeTo] =
      await Promise.all([
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "name" }),
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "symbol" }),
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "factory" }),
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "creator" }),
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "pairAsset" }),
        client.readContract({
          address: token,
          abi: rhTokenAbi,
          functionName: "creatorFeeBps",
        }),
        client.readContract({ address: token, abi: rhTokenAbi, functionName: "feeTo" }),
      ]);
    return encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint8" },
      ],
      [name, symbol, factory, creator, pairAsset, creatorFeeBps, feeTo],
    );
  } catch {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
