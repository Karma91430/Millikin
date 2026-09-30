import { get, list, type Provider } from "@/lib/db";
import { discoverModels } from "@/lib/gateway";

export async function POST(req: Request) {
  const { providerId } = (await req.json().catch(() => ({}))) as { providerId?: string };
  const targets = providerId ? [get<Provider>("providers", providerId)].filter(Boolean) as Provider[] : list<Provider>("providers").filter((p) => p.enabled);
  const results = [];
  for (const p of targets) {
    try {
      results.push({ provider: p.name, ...(await discoverModels(p)) });
    } catch (e) {
      results.push({ provider: p.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return Response.json(results);
}
