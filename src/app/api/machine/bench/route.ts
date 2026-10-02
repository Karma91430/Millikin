import { getSettings, list, type Provider } from "@/lib/db";
import { ollamaBase, ollamaHeaders } from "@/lib/gateway";

/** Measure real speed on this machine: a short generation, timings reported by Ollama. */
export async function POST(req: Request) {
  const { model } = (await req.json()) as { model: string };
  const p = list<Provider>("providers").find((x) => x.enabled);
  if (!p || !model) return Response.json({ error: "Modèle ou hôte manquant" }, { status: 400 });
  try {
    const r = await fetch(`${ollamaBase(p)}/api/generate`, {
      method: "POST",
      headers: ollamaHeaders(p),
      body: JSON.stringify({
        model,
        prompt: "Explique en cinq phrases ce qu'est une base de données relationnelle.",
        stream: false,
        think: false,
        keep_alive: getSettings().keep_alive || "10m",
        options: { num_predict: 160, temperature: 0 },
      }),
      signal: req.signal,
    });
    const j = (await r.json()) as { error?: string; eval_count?: number; eval_duration?: number; prompt_eval_count?: number; prompt_eval_duration?: number; load_duration?: number; total_duration?: number };
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    const rate = (n?: number, ns?: number) => (n && ns ? Math.round((n / (ns / 1e9)) * 10) / 10 : undefined);
    return Response.json({
      model,
      tokensPerSec: rate(j.eval_count, j.eval_duration),
      promptTokensPerSec: rate(j.prompt_eval_count, j.prompt_eval_duration),
      loadSec: j.load_duration ? Math.round((j.load_duration / 1e9) * 10) / 10 : 0,
      totalSec: j.total_duration ? Math.round((j.total_duration / 1e9) * 10) / 10 : undefined,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
