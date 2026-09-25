const PUBLIC_RH_RPC = "https://rpc.mainnet.chain.robinhood.com";

function paidUpstream() {
  return (
    process.env.QUICKNODE_HTTPS?.trim() ||
    process.env.VITE_RH_RPC?.trim() ||
    PUBLIC_RH_RPC
  );
}

function logsUpstream() {
  return process.env.RH_LOGS_RPC?.trim() || PUBLIC_RH_RPC;
}

function usesLogs(payload: string) {
  try {
    const body = JSON.parse(payload) as { method?: string } | { method?: string }[];
    const rows = Array.isArray(body) ? body : [body];
    return rows.some((row) =>
      ["eth_getLogs", "eth_newFilter", "eth_getFilterLogs"].includes(row?.method ?? ""),
    );
  } catch {
    return false;
  }
}

function logsRejected(status: number, text: string) {
  return (
    status === 413 ||
    /eth_getLogs is limited|block range|response too large|-32615|pruned history/i.test(
      text,
    )
  );
}

function uniqueTargets(payload: string) {
  const logs = usesLogs(payload);
  const first = logs ? logsUpstream() : paidUpstream();
  const second = logs ? paidUpstream() : logsUpstream();
  return [first, second].filter((url, index, all) => url && all.indexOf(url) === index);
}

async function send(target: string, payload: string) {
  let status = 502;
  let text = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: payload,
      });
      status = response.status;
      text = await response.text();
      if (status !== 429 && status !== 503) {
        return { status, text };
      }
    } catch {
      text = "";
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }
  return { status, text };
}

async function proxy(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const payload = await request.text();
  let last = { status: 502, text: "" };
  for (const target of uniqueTargets(payload)) {
    last = await send(target, payload);
    if (last.text && last.status < 500 && !logsRejected(last.status, last.text)) {
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
