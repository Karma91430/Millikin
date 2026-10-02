import { getSettings, list, type Provider } from "@/lib/db";
import { ollamaBase, ollamaHeaders } from "@/lib/gateway";
import { assess, detectHardware, recommend } from "@/lib/machine";

/** Hardware, Ollama state and model recommendations for this machine. */
export async function GET() {
  const hardware = await detectHardware();
  const s = getSettings();
  const numCtx = Number(s.num_ctx) || 16384;
  const p = list<Provider>("providers").find((x) => x.enabled);
  let installed: { name: string; size: number; parameter_size?: string }[] = [];
  let loaded: { name: string; size: number; size_vram: number }[] = [];
  let version: string | undefined;
  let ollamaError: string | undefined;
  if (p) {
    const base = ollamaBase(p);
    const h = ollamaHeaders(p);
    try {
      const [tags, ps, v] = await Promise.all([
        fetch(`${base}/api/tags`, { headers: h }).then((r) => r.json()),
        fetch(`${base}/api/ps`, { headers: h }).then((r) => r.json()),
        fetch(`${base}/api/version`, { headers: h }).then((r) => r.json()).catch(() => ({})),
      ]);
      installed = (tags.models ?? []).map((m: { name: string; size: number; details?: { parameter_size?: string } }) => ({ name: m.name, size: m.size, parameter_size: m.details?.parameter_size }));
      loaded = (ps.models ?? []).map((m: { name: string; size: number; size_vram: number }) => ({ name: m.name, size: m.size, size_vram: m.size_vram }));
      version = v.version;
    } catch (e) {
      ollamaError = e instanceof Error ? e.message : String(e);
    }
  } else ollamaError = "Aucun hôte Ollama configuré";
  const models = assess(hardware, numCtx, installed.map((m) => m.name));
  return Response.json({
    hardware,
    numCtx,
    defaults: { chat: s.default_model.replace(/^ollama\//, ""), embedding: s.embedding_model.replace(/^ollama\//, "") },
    ollama: { version, installed, loaded, error: ollamaError },
    models,
    recommendations: recommend(models),
  });
}
