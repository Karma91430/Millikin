import { list, type ModelRow, type Provider } from "@/lib/db";
import { discoverModels, PROVIDER_PRESETS } from "@/lib/gateway";
import { BUILTIN_TOOLS } from "@/lib/orchestrator";

/** Static catalogs the UI needs: presets, built-in tools, and the model list as "slug/model" refs. */
export async function GET() {
  const providers = list<Provider>("providers");
  // First launch: fill the catalog from the installed Ollama models.
  if (!list("models").length)
    for (const p of providers.filter((x) => x.enabled)) await discoverModels(p).catch(() => {});
  const models = list<ModelRow>("models")
    .filter((m) => m.enabled)
    .map((m) => {
      const p = providers.find((x) => x.id === m.provider_id);
      return p ? { ref: `${p.slug}/${m.model}`, label: m.label || m.model, provider: p.name, kind: m.kind, supports_tools: m.supports_tools } : null;
    })
    .filter(Boolean);
  return Response.json({ presets: PROVIDER_PRESETS, tools: BUILTIN_TOOLS, models });
}
