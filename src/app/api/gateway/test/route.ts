import { chatStream } from "@/lib/gateway";

export async function POST(req: Request) {
  const { model } = (await req.json()) as { model: string };
  const t = Date.now();
  try {
    const r = await chatStream({ ref: model, source: "test", messages: [{ role: "user", content: "Réponds seulement : OK" }] });
    return Response.json({ ok: true, reply: r.content.trim().slice(0, 200), latency_ms: Date.now() - t, usage: r.usage });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - t });
  }
}
