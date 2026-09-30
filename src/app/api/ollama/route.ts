import { get, list, type Provider } from "@/lib/db";
import { capabilities, discoverModels, ollamaBase, ollamaHeaders } from "@/lib/gateway";

function host(id: string | null): Provider {
  const p = id ? get<Provider>("providers", id) : list<Provider>("providers").find((x) => x.enabled);
  if (!p) throw new Error("Aucun hôte Ollama configuré");
  return p;
}

/** Installed + loaded models for one host, with capabilities. */
export async function GET(req: Request) {
  try {
    const p = host(new URL(req.url).searchParams.get("providerId"));
    const base = ollamaBase(p);
    const h = ollamaHeaders(p);
    const [tags, ps, version] = await Promise.all([
      fetch(`${base}/api/tags`, { headers: h }).then((r) => r.json()),
      fetch(`${base}/api/ps`, { headers: h }).then((r) => r.json()),
      fetch(`${base}/api/version`, { headers: h }).then((r) => r.json()).catch(() => ({})),
    ]);
    const installed = await Promise.all(
      ((tags.models ?? []) as { name: string; size: number; modified_at: string; details?: Record<string, string> }[]).map(async (m) => ({
        name: m.name,
        size: m.size,
        modified_at: m.modified_at,
        family: m.details?.family,
        parameter_size: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        capabilities: await capabilities(p, m.name),
      })),
    );
    const loaded = ((ps.models ?? []) as { name: string; size: number; size_vram: number; expires_at: string; context_length?: number }[]).map((m) => ({
      name: m.name,
      size: m.size,
      size_vram: m.size_vram,
      expires_at: m.expires_at,
      context_length: m.context_length,
    }));
    return Response.json({ provider: { id: p.id, name: p.name, base_url: p.base_url }, version: version.version, installed, loaded });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Actions: pull (streams progress as NDJSON), delete, unload, sync. */
export async function POST(req: Request) {
  const { action, model, providerId } = (await req.json()) as { action: string; model?: string; providerId?: string };
  try {
    const p = host(providerId ?? null);
    const base = ollamaBase(p);
    const h = ollamaHeaders(p);
    if (action === "sync") return Response.json(await discoverModels(p));
    if (!model) return Response.json({ error: "Modèle manquant" }, { status: 400 });
    if (action === "delete") {
      const r = await fetch(`${base}/api/delete`, { method: "DELETE", headers: h, body: JSON.stringify({ model }) });
      if (!r.ok) throw new Error(await r.text());
      await discoverModels(p);
      return Response.json({ ok: true });
    }
    if (action === "unload") {
      await fetch(`${base}/api/generate`, { method: "POST", headers: h, body: JSON.stringify({ model, keep_alive: 0 }) });
      return Response.json({ ok: true });
    }
    if (action === "pull") {
      const r = await fetch(`${base}/api/pull`, { method: "POST", headers: h, body: JSON.stringify({ model, stream: true }), signal: req.signal });
      if (!r.ok || !r.body) throw new Error(await r.text());
      // Relay Ollama's NDJSON progress, then resync the catalog once the pull finishes.
      const relay = new TransformStream<Uint8Array, Uint8Array>({
        async flush() {
          await discoverModels(p).catch(() => {});
        },
      });
      return new Response(r.body.pipeThrough(relay), { headers: { "content-type": "application/x-ndjson" } });
    }
    return Response.json({ error: `Action inconnue : ${action}` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
