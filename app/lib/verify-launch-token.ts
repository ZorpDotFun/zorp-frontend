const COMPILER = "0.8.26+commit.8a97fa7a";

export const ARC_VERIFY = {
  compiler: COMPILER,
  identifier: "src/LaunchToken.sol:LaunchToken",
  path: "src/LaunchToken.sol",
  name: "LaunchToken",
  stdJson: "app/data/launch-token.stdjson.json",
} as const;

export const RH_VERIFY = {
  compiler: COMPILER,
  identifier: "src/RhLaunchToken.sol:RhLaunchToken",
  path: "src/RhLaunchToken.sol",
  name: "RhLaunchToken",
  stdJson: "app/data/rh-launch-token.stdjson.json",
} as const;

export type VerifyLaunchInput = {
  address: string;
  hash?: string;
  chainId?: number;
  constructorArgs?: string;
  wait?: boolean;
};

const verified = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

function verifyKey(input: VerifyLaunchInput) {
  return `${input.chainId ?? 0}:${input.address.toLowerCase()}`;
}

function sourcifyOk(body: Record<string, unknown> | null) {
  const match = String(body?.match ?? body?.sourcify ?? "");
  if (match === "exact_match" || match === "match") return true;
  const nested = body?.sourcify;
  if (nested && typeof nested === "object") {
    const inner = String((nested as { match?: string }).match ?? "");
    return inner === "exact_match" || inner === "match";
  }
  return Boolean(body?.reused);
}

async function postVerify(input: VerifyLaunchInput): Promise<boolean> {
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, wait: input.wait !== false }),
  });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return sourcifyOk(body);
}

/** Waits for Sourcify (and explorers) unless `wait: false`. */
export function verifyLaunchToken(input: VerifyLaunchInput): Promise<boolean> {
  const key = verifyKey(input);
  if (verified.has(key)) return Promise.resolve(true);
  const running = inflight.get(key);
  if (running) return running;

  const job = postVerify(input)
    .then((ok) => {
      if (ok) verified.add(key);
      return ok;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}

export function requestTokenVerification(input: VerifyLaunchInput) {
  void verifyLaunchToken(input);
}

export { COMPILER };
