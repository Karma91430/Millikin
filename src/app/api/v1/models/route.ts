import { list, type ModelRow, type Provider } from "@/lib/db";
import { checkProxyAuth } from "@/lib/proxy";

export async function GET(req: Request) {
  const denied = checkProxyAuth(req);
  if (denied) return denied;
  const providers = list<Provider>("providers").filter((p) => p.enabled);
  const data = list<ModelRow>("models")
    .filter((m) => m.enabled)
    .flatMap((m) => {
      const p = providers.find((x) => x.id === m.provider_id);
      return p ? [{ id: `${p.slug}/${m.model}`, object: "model", owned_by: p.slug, created: 0 }] : [];
    });
  return Response.json({ object: "list", data });
}
