import { get, type Provider } from "@/lib/db";
import { discoverModels } from "@/lib/gateway";
import { cliAvailable } from "@/lib/providers";

/** Check a provider: the CLI is installed, or the API answers (and sync its model list). */
export async function POST(req: Request) {
  const { providerId } = (await req.json()) as { providerId: string };
  const p = get<Provider>("providers", providerId);
  if (!p) return Response.json({ error: "Fournisseur introuvable" }, { status: 404 });
  try {
    if (p.type === "claude-code" || p.type === "codex") {
      const version = await cliAvailable(p.base_url || (p.type === "codex" ? "codex" : "claude"));
      if (!version) throw new Error(`La commande « ${p.base_url} » est introuvable : installe la CLI ${p.name} puis connecte-toi.`);
      const r = await discoverModels(p);
      return Response.json({ ok: true, detail: `${version} · ${r.total} modèles` });
    }
    const r = await discoverModels(p);
    return Response.json({ ok: true, detail: `${r.total} modèles disponibles` });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
