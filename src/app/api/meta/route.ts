import { list, type ModelRow, type Provider } from "@/lib/db";
import { discoverModels, ollamaBase, ollamaHeaders, PROVIDER_PRESETS } from "@/lib/gateway";
import { BUILTIN_TOOLS } from "@/lib/orchestrator";

/** Static catalogs the UI needs: presets, built-in tools, and the model list as "slug/model" refs. */
export async function GET() {
  const providers = list<Provider>("providers");
  // Keep the catalog in sync with Ollama (models pulled or removed from the CLI, first launch…).
  const catalog = list<ModelRow>("models");
  for (const p of providers.filter((x) => x.enabled)) {
    const installed = await fetch(`${ollamaBase(p)}/api/tags`, { headers: ollamaHeaders(p), signal: AbortSignal.timeout(2000) })
      .then((r) => r.json() as Promise<{ models?: { name: string }[] }>)
      .then((j) => (j.models ?? []).map((m) => m.name).sort())
      .catch(() => null);
    if (!installed) continue;
    const known = catalog.filter((m) => m.provider_id === p.id).map((m) => m.model).sort();
    if (installed.join("|") !== known.join("|")) await discoverModels(p).catch(() => {});
  }
  const models = list<ModelRow>("models")
    .filter((m) => m.enabled)
    .map((m) => {
      const p = providers.find((x) => x.id === m.provider_id);
      return p ? { ref: `${p.slug}/${m.model}`, label: m.label || m.model, provider: p.name, kind: m.kind, supports_tools: m.supports_tools } : null;
    })
    .filter(Boolean);
  return Response.json({ presets: PROVIDER_PRESETS, tools: BUILTIN_TOOLS, models });
}
