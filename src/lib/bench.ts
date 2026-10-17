// Test bench: runs reference scenarios end to end (planning, tickets, controls) with a chosen configuration,
// then checks the result with hidden checks and records the figures. Bench projects live in the database
// like any project but are hidden from the lists; their folders are under data/bench/.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BENCH_SCENARIOS, type BenchCheck, type BenchScenario } from "./benchScenarios";
import { db, dataDir, list, newId, now, remove, upsert, type Agent, type Project, type Task } from "./db";
import { resolveModel, withModelOverride } from "./gateway";
import { startPlanRun } from "./planner";
import { type Rigor } from "./rigor";
import { stopRun, type Run } from "./runs";
import { startChainRun } from "./taskrun";

export type BenchConfig = {
  /** Shown in the results to tell configurations apart. */
  label: string;
  /** Models for the first contacts and for the builders ("" = each agent's own model). */
  leadModel: string;
  builderModel: string;
  rigor: Rigor;
  /** Reference run: the scenario is given directly to this engine's own CLI agent (Claude Code or Codex), without Millikin. */
  baseline?: string;
};

export type BenchResult = {
  checks: { name: string; ok: boolean; detail: string }[];
  passed: number;
  total: number;
  tasks: number;
  done: number;
  firstTry: number;
  attempts: number;
  needsHuman: number;
  planMs: number;
  buildMs: number;
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  modelErrors: number;
};

export type BenchRun = {
  id: string;
  batch: string;
  scenario: string;
  config: BenchConfig;
  status: "queued" | "running" | "done" | "error" | "stopped";
  phase: string;
  started_at: number | null;
  ended_at: number | null;
  result: BenchResult | null;
  error: string;
  project_id: string;
};

const g = globalThis as unknown as { __millikinBench?: { batch: string; stop: boolean; current?: Run; kill?: () => void } };

const parse = (r: Record<string, unknown>): BenchRun => ({
  ...(r as unknown as BenchRun),
  config: JSON.parse(String(r.config || "{}")),
  result: r.result ? JSON.parse(String(r.result)) : null,
});
export const listBenchRuns = () => (db().prepare("SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT 300").all() as Record<string, unknown>[]).map(parse);
const save = (id: string, patch: Partial<Omit<BenchRun, "config" | "result">> & { result?: BenchResult | null }) => {
  const cols = Object.keys(patch);
  const vals = cols.map((k) => {
    const v = (patch as Record<string, unknown>)[k];
    return k === "result" ? JSON.stringify(v ?? null) : (v as string | number | null);
  });
  db().prepare(`UPDATE bench_runs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
};

export const benchBusy = () => !!g.__millikinBench;

/** Queue the scenarios with this configuration and run them one after the other in the background. */
export function startBench(scenarioIds: string[], config: BenchConfig) {
  if (g.__millikinBench) throw new Error("Un banc d'essai est déjà en cours");
  const scenarios = BENCH_SCENARIOS.filter((s) => scenarioIds.includes(s.id));
  if (!scenarios.length) throw new Error("Choisis au moins un scénario");
  const batch = newId();
  const ids = scenarios.map((s) => {
    const id = newId();
    db()
      .prepare("INSERT INTO bench_runs (id, batch, scenario, config, status, phase, created_at) VALUES (?, ?, ?, ?, 'queued', '', ?)")
      .run(id, batch, s.id, JSON.stringify(config), now());
    return { id, s };
  });
  g.__millikinBench = { batch, stop: false };
  void (async () => {
    try {
      for (const { id, s } of ids) {
        if (g.__millikinBench?.stop) {
          save(id, { status: "stopped", phase: "" });
          continue;
        }
        await runScenario(id, s, config).catch((e) => save(id, { status: "error", phase: "", error: e instanceof Error ? e.message : String(e), ended_at: now() }));
      }
    } finally {
      g.__millikinBench = undefined;
    }
  })();
  return batch;
}

export function stopBench() {
  const b = g.__millikinBench;
  if (!b) return;
  b.stop = true;
  if (b.current) stopRun(b.current.id);
  b.kill?.();
}

/** Delete the bench runs of a batch, their hidden projects and folders. */
export async function deleteBenchBatch(batch: string) {
  const runs = listBenchRuns().filter((r) => r.batch === batch);
  for (const r of runs) {
    if (r.project_id) {
      for (const t of list<Task>("tasks").filter((t) => t.project_id === r.project_id)) remove("tasks", t.id);
      remove("projects", r.project_id);
    }
    await fs.rm(path.join(dataDir(), "bench", r.id), { recursive: true, force: true });
  }
  db().prepare("DELETE FROM bench_runs WHERE batch = ?").run(batch);
}

const findAgent = (agents: Agent[], name: string) => agents.find((a) => a.name === name) ?? agents.find((a) => a.name.toLowerCase().includes(name.toLowerCase().split(" ")[0]));

async function runScenario(id: string, s: BenchScenario, config: BenchConfig) {
  if (config.baseline) return runBaseline(id, s, config.baseline);
  const agents = list<Agent>("agents");
  const leads = s.leads.map((n) => findAgent(agents, n));
  const builders = s.builders.map((n) => findAgent(agents, n));
  const missing = [...s.leads, ...s.builders].filter((_, i) => !(i < s.leads.length ? leads[i] : builders[i - s.leads.length]));
  if (missing.length) throw new Error(`Agent introuvable : ${missing.join(", ")} (crée-le depuis la bibliothèque de profils)`);
  const leadIds = leads.map((a) => a!.id);
  const builderIds = builders.map((a) => a!.id).filter((x) => !leadIds.includes(x));

  const dir = path.join(dataDir(), "bench", id);
  await fs.mkdir(dir, { recursive: true });
  for (const [f, content] of Object.entries(s.files ?? {})) await fs.writeFile(path.join(dir, f), content, "utf8");

  const project = upsert<Project>("projects", {
    name: `Banc d'essai · ${s.name}`,
    description: s.brief,
    path: dir,
    team: { agent_ids: [...leadIds, ...builderIds], entry_ids: leadIds, links: [], clarify: false, concert: false, layout: {} },
    modules: ["board"],
    rigor: config.rigor,
    bench: id,
  });
  save(id, { status: "running", phase: "planning", started_at: now(), project_id: project.id });

  // Model choice for this run only: the agents themselves are not modified.
  const models: Record<string, string> = {};
  if (config.leadModel) for (const a of leadIds) models[a] = config.leadModel;
  if (config.builderModel) for (const a of builderIds) models[a] = config.builderModel;

  const t0 = now();
  await withModelOverride({ byAgent: models, fallback: config.leadModel || undefined }, async () => {
    const plan = startPlanRun(project.id, { sprints: false });
    g.__millikinBench!.current = plan;
    await plan.finished;
  });
  const planMs = now() - t0;
  const planned = list<Task>("tasks").filter((t) => t.project_id === project.id);
  if (!planned.length) throw new Error("La planification n'a produit aucune tâche");

  const t1 = now();
  if (!g.__millikinBench?.stop) {
    save(id, { phase: "build" });
    await withModelOverride({ byAgent: models, fallback: config.leadModel || undefined }, async () => {
      const chain = startChainRun(project.id, { parallel: 2 });
      g.__millikinBench!.current = chain;
      await chain.finished;
    });
  }
  const buildMs = now() - t1;

  save(id, { phase: "checks" });
  const checks = [];
  for (const c of s.checks) checks.push(await runCheck(c, dir));

  const tasks = list<Task>("tasks").filter((t) => t.project_id === project.id);
  const usage = db()
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS pin, COALESCE(SUM(completion_tokens),0) AS pout, COALESCE(SUM(status = 'error'),0) AS err FROM usage_logs WHERE project_id = ?")
    .get(project.id) as { n: number; pin: number; pout: number; err: number };
  const result: BenchResult = {
    checks,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    tasks: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    firstTry: tasks.filter((t) => t.status === "done" && !t.attempts).length,
    attempts: tasks.reduce((n, t) => n + 1 + (t.attempts || 0), 0),
    needsHuman: tasks.filter((t) => t.needs_human).length,
    planMs,
    buildMs,
    modelCalls: usage.n,
    promptTokens: usage.pin,
    completionTokens: usage.pout,
    modelErrors: usage.err,
  };
  save(id, { status: g.__millikinBench?.stop ? "stopped" : "done", phase: "", ended_at: now(), result });
}

/**
 * Reference: the same brief handed to the engine's own agent in one request (its tools, its loop), then the
 * same hidden checks. Only a yardstick for Millikin's overhead; Millikin itself never relies on it.
 */
async function runBaseline(id: string, s: BenchScenario, ref: string) {
  const res = resolveModel(ref);
  const type = res.provider.type;
  if (type !== "claude-code" && type !== "codex") throw new Error("La référence « moteur seul » existe pour Claude Code et Codex");
  const dir = path.join(dataDir(), "bench", id);
  await fs.mkdir(dir, { recursive: true });
  for (const [f, content] of Object.entries(s.files ?? {})) await fs.writeFile(path.join(dir, f), content, "utf8");
  save(id, { status: "running", phase: "build", started_at: now() });
  const prompt = `${s.brief}\n\nRéalise ce projet dans le dossier courant, exécute les tests, puis donne un compte rendu court.`;
  const cmd = res.provider.base_url || (type === "codex" ? "codex" : "claude");
  const args =
    type === "claude-code"
      ? ["-p", "--output-format", "json", "--model", res.model, "--permission-mode", "acceptEdits", "--no-session-persistence", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(python3:*),Bash(python:*),Bash(pytest:*),Bash(ls:*),Bash(mkdir:*),Bash(cat:*),Bash(cd:*)"]
      : ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "--model", res.model, "-"];
  const t0 = now();
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: dir, env: process.env });
    let text = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60_000);
    g.__millikinBench!.kill = () => child.kill("SIGTERM");
    child.stdout.on("data", (d: Buffer) => (text += d.toString("utf8")));
    child.on("error", (e) => reject(e));
    child.on("close", () => (clearTimeout(timer), resolve(text)));
    child.stdin.end(prompt);
  });
  let calls = 0;
  let pin = 0;
  let pout = 0;
  if (type === "claude-code") {
    const j = JSON.parse(out.slice(out.indexOf("{"))) as { num_turns?: number; usage?: Record<string, number>; is_error?: boolean; result?: string };
    if (j.is_error) throw new Error(`Claude Code : ${String(j.result).slice(0, 300)}`);
    const u = j.usage ?? {};
    calls = j.num_turns ?? 0;
    pin = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    pout = u.output_tokens ?? 0;
  } else {
    for (const line of out.split("\n")) {
      try {
        const e = JSON.parse(line) as { type?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        if (e.type === "turn.completed" && e.usage) {
          calls++;
          pin += e.usage.input_tokens ?? 0;
          pout += e.usage.output_tokens ?? 0;
        }
      } catch {}
    }
  }
  save(id, { phase: "checks" });
  const checks = [];
  for (const c of s.checks) checks.push(await runCheck(c, dir));
  save(id, {
    status: "done",
    phase: "",
    ended_at: now(),
    result: { checks, passed: checks.filter((c) => c.ok).length, total: checks.length, tasks: 0, done: 0, firstTry: 0, attempts: 0, needsHuman: 0, planMs: 0, buildMs: now() - t0, modelCalls: calls, promptTokens: pin, completionTokens: pout, modelErrors: 0 },
  });
}

/** Run one hidden check; a scratch check gets an empty folder and $PROJECT. */
async function runCheck(c: BenchCheck, project: string): Promise<{ name: string; ok: boolean; detail: string }> {
  const cwd = c.scratch ? await fs.mkdtemp(path.join(os.tmpdir(), "millikin-bench-")) : project;
  const out = await new Promise<{ code: number; text: string }>((resolve) =>
    execFile("/bin/sh", ["-c", c.run], { cwd, timeout: 60_000, env: { ...process.env, PROJECT: project, PYTHONPATH: project, PYTHONDONTWRITEBYTECODE: "1" } }, (err, stdout, stderr) =>
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) || 1 : 0, text: `${stdout}\n${stderr}`.trim() }),
    ),
  );
  if (c.scratch) await fs.rm(cwd, { recursive: true, force: true });
  const missing = (c.expect?.includes ?? []).filter((s) => !out.text.includes(s));
  const ok = out.code === 0 && !missing.length;
  return { name: c.name, ok, detail: ok ? "" : (missing.length ? `attendu : ${missing.join(" / ")}\n` : `code ${out.code}\n`) + out.text.slice(-600) };
}
