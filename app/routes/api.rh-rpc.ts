import { rhLogTargets, rhRpcTargets, rhRpcTimeout } from "../lib/rh-server-rpc";

function isGetLogs(payload: string) {
  return /"method"\s*:\s*"eth_getLogs"/.test(payload);
}

function logsRejected(status: number, text: string) {
  return (
    status === 413 ||
    /eth_getLogs is limited|block range|response too large|-32615|pruned history|rate limit|too many requests|limit exceeded/i.test(
      text,
    )
  );
}

function publicFailed(status: number, text: string) {
  return (
    status === 429 ||
    status === 503 ||
    status >= 500 ||
    !text ||
    logsRejected(status, text)
  );
}

async function send(target: string, payload: string, ms: number) {
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
      signal: AbortSignal.timeout(ms),
    });
    return { status: response.status, text: await response.text() };
  } catch {
    return { status: 502, text: "" };
  }
}

async function proxy(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const payload = await request.text();
  let last = { status: 502, text: "" };
  const logs = isGetLogs(payload);
  const targets = logs ? rhLogTargets() : rhRpcTargets();
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    last = await send(target, payload, rhRpcTimeout(target, logs));
    if (last.text && !publicFailed(last.status, last.text)) {
      return new Response(last.text, {
        status: last.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (last.text) {
    return new Response(last.text, {
      status: last.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32005, message: "busy" } },
    { status: 429 },
  );
}

export async function action({ request }: { request: Request }) {
  return proxy(request);
}
