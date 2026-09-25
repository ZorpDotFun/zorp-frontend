import { readCurrentRhLaunches } from "../lib/factory";

export async function loader() {
  try {
    const tokens = await readCurrentRhLaunches();
    return Response.json(tokens);
  } catch {
    return Response.json([], { status: 503 });
  }
}
