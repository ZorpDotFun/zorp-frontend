import type { Route } from "./+types/api.upload";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const jwt = process.env.PINATA_JWT_SECRET;
  if (!jwt) {
    return Response.json(
      { error: "Image upload is not configured." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing image file." }, { status: 400 });
  }
  if (file.size > 2_000_000) {
    return Response.json({ error: "Image must be under 2MB." }, { status: 400 });
  }

  const pinata = new FormData();
  pinata.append("file", file, file.name || "token.png");

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: pinata,
  });

  const body = (await response.json()) as { IpfsHash?: string; error?: { details?: string } };
  if (!response.ok || !body.IpfsHash) {
    return Response.json(
      { error: body.error?.details || "Pinata upload failed." },
      { status: 502 },
    );
  }

  const url = `ipfs://${body.IpfsHash}`;
  if (url.length > 512) {
    return Response.json({ error: "Image URL is too long." }, { status: 400 });
  }

  return Response.json({ url });
}
