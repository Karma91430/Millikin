import { withAccess } from "@/lib/access";
import { benchBusy, deleteBenchBatch, listBenchRuns, startBench, stopBench, type BenchConfig } from "@/lib/bench";
import { BENCH_SCENARIOS } from "@/lib/benchScenarios";
import { rigorOf } from "@/lib/rigor";

/** Scenarios, past runs and whether a bench is running. */
async function handleGET() {
  return Response.json({
    scenarios: BENCH_SCENARIOS.map(({ id, name, summary, brief, leads, builders, checks }) => ({ id, name, summary, brief, leads, builders, checks: checks.map((c) => c.name) })),
    runs: listBenchRuns(),
    busy: benchBusy(),
  });
}

/** start {scenarios, config} · stop */
async function handlePOST(req: Request) {
  const b = (await req.json()) as { action: "start" | "stop"; scenarios?: string[]; config?: Partial<BenchConfig> };
  if (b.action === "stop") {
    stopBench();
    return Response.json({ ok: true });
  }
  try {
    const c = b.config ?? {};
    const baseline = c.baseline ? String(c.baseline) : undefined;
    const config: BenchConfig = {
      label: String(c.label ?? "").trim() || (baseline ? `Moteur seul · ${baseline}` : "Configuration actuelle"),
      leadModel: c.leadModel ?? "",
      builderModel: c.builderModel ?? "",
      rigor: rigorOf(c),
      ...(baseline ? { baseline } : {}),
    };
    return Response.json({ batch: startBench(b.scenarios ?? [], config) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** ?batch= : delete a batch of runs, their hidden projects and folders. */
async function handleDELETE(req: Request) {
  const batch = new URL(req.url).searchParams.get("batch");
  if (!batch) return Response.json({ error: "batch manquant" }, { status: 400 });
  await deleteBenchBatch(batch);
  return Response.json({ ok: true });
}

export const GET = withAccess("admin", handleGET);
export const POST = withAccess("admin", handlePOST, { credits: true });
export const DELETE = withAccess("admin", handleDELETE);
