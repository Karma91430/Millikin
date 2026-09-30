import { get, getSettings, list, newId, type Agent, type McpServer, type Skill } from "./db";
import { appendDecision, readDecisions } from "./decisions";
import { chatStream, resolveModel, type ChatMessage, type ToolDef } from "./gateway";
import { callMcpTool, listMcpTools } from "./mcp";
import { search } from "./rag";
import { reportsOf, type TeamSpec } from "./team";
import { buildTools, type ToolContext } from "./tools";
import type { TraceEvent } from "./trace";

export { BUILTIN_TOOLS } from "./tools";

type Emit = (ev: TraceEvent) => void;
type ToolImpl = (args: Record<string, unknown>, toolCallId: string) => Promise<string>;

/** cadrage: entries analyse and ask questions, no delegation · execution: approved, delegate and review · free: no phases */
export type Phase = "cadrage" | "execution" | "free";

const MAX_TOOL_RESULT = 6000;
const MAX_DEPTH = 4;
const ANNOUNCES_ACTION = /\b(je (vais|demande|délègue|lance|transmets|passe la main|contacte|sollicite)|maintenant,? je|je m'en occupe|laisse-moi)\b/i;

const PHASE_CADRAGE = `## Phase de cadrage (l'utilisateur n'a pas encore validé)
Ne fais pas réaliser le travail maintenant. Ton rôle :
1. Reformule le besoin tel que tu le comprends.
2. Propose une approche : périmètre, grandes étapes, répartition envisagée entre les membres de l'équipe.
3. Pose les questions nécessaires pour lever les ambiguïtés (numérotées, 3 à 6 maximum, les plus importantes d'abord).
Termine en demandant à l'utilisateur de répondre aux questions ou de valider pour lancer la réalisation.`;

const PHASE_EXECUTION = `## Phase de réalisation (validée par l'utilisateur)
1. Répartis le travail avec ask_agent : une consigne précise et autonome par membre (objectif, contraintes, fichiers attendus).
2. Contrôle chaque résultat reçu : s'il est incomplet, faux ou hors sujet, redemande une correction au même membre en expliquant quoi corriger.
3. Tiens le tableau à jour si tu en as l'outil.
4. Consigne les décisions importantes (choix techniques, arbitrages) avec record_decision.
5. Termine par un compte rendu : ce qui est fait, ce que tu as contrôlé, ce qui reste à faire ou à décider.`;

const FILE_RULES = `## Organisation des fichiers
Tes outils fichiers agissent dans le dossier du projet (chemins relatifs). Commence par list_files pour voir l'existant.
Range les fichiers dans une arborescence claire (src/, tests/, docs/, config/…) et donne-leur des noms explicites
(snake_case pour Python, kebab-case sinon). Un fichier par responsabilité. N'utilise jamais de noms génériques (test.py, file1.txt, output.md).`;

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "agent";

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : { value: v };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Arguments JSON invalides");
  }
}

export type TeamRuntime = { spec: TeamSpec; agents: Map<string, Agent> };

export type RunParams = {
  agent: Agent;
  input: string;
  history?: ChatMessage[];
  /** Team graph (projects). Without it, the agent works alone. */
  team?: TeamRuntime;
  phase?: Phase;
  parentCallId?: string | null;
  viaToolCallId?: string;
  depth?: number;
  /** Agent ids from the root down to the caller: never delegate back up the chain. */
  chain?: string[];
  /** Extra system sections (e.g. co-leads' opinions). */
  extra?: string[];
  /** Consulted co-lead: gives an opinion only, never delegates. */
  consultOnly?: boolean;
  /** Tools withheld for this run and its delegations (e.g. board edits during a task review). */
  excludeTools?: string[];
  emit: Emit;
  signal?: AbortSignal;
  /** Workspace + project shared by every agent of the run (files, commands, tasks). */
  ctx: Omit<ToolContext, "agent">;
};

/** Emit a delegation the way ask_agent would, so the UI shows it identically. */
async function delegate(p: RunParams, callId: string, target: Agent, message: string, extra: Partial<RunParams> = {}) {
  const toolCallId = `call_${newId()}`;
  p.emit({ type: "tool_call", callId, toolCallId, name: "ask_agent", args: { agent: slugify(target.name), message } });
  const out = await runAgent({
    ...p,
    agent: target,
    input: message,
    history: undefined,
    extra: undefined,
    consultOnly: false,
    parentCallId: callId,
    viaToolCallId: toolCallId,
    depth: (p.depth ?? 0) + 1,
    chain: [...(p.chain ?? []), p.agent.id],
    ...extra,
  });
  p.emit({ type: "tool_result", callId, toolCallId, result: out.slice(0, 2000) });
  return out;
}

/** Run one agent turn (with tool loop). Delegation spawns nested runs that emit their own events. */
export async function runAgent(p: RunParams): Promise<string> {
  const { agent, emit, signal, team } = p;
  const depth = p.depth ?? 0;
  const phase: Phase = p.phase ?? "free";
  const callId = newId();
  emit({ type: "agent_start", callId, agentId: agent.id, parentCallId: p.parentCallId ?? null, viaToolCallId: p.viaToolCallId, input: p.input });

  try {
    const tools: ToolDef[] = [];
    const impls: Record<string, ToolImpl> = {};
    const sys: string[] = [agent.system_prompt || `Tu es ${agent.name}. ${agent.role}`];

    // Skills are injected directly: small local models follow inline instructions far better than a lookup tool.
    const skills = (agent.skill_ids ?? []).map((id) => get<Skill>("skills", id)).filter(Boolean) as Skill[];
    if (skills.length) sys.push("## Compétences\n" + skills.map((s) => `### ${s.name}\n${s.description}\n\n${s.content}`).join("\n\n"));

    // ---- team position
    const entries = team?.spec.entry_ids ?? [];
    const isSpeaker = depth === 0 && !!team;
    const coLeads = isSpeaker ? entries.filter((id) => id !== agent.id).map((id) => team!.agents.get(id)).filter((a): a is Agent => !!a) : [];
    const blocked = new Set([...(p.chain ?? []), agent.id]);
    const delegateIds = team && !p.consultOnly && depth < MAX_DEPTH ? [...reportsOf(team.spec, agent.id), ...coLeads.map((c) => c.id)] : [];
    const delegates = [...new Set(delegateIds)].filter((id) => !blocked.has(id)).map((id) => team!.agents.get(id)).filter((a): a is Agent => !!a);
    const canDelegate = delegates.length > 0 && phase !== "cadrage";

    if (team && depth === 0) {
      const everyone = team.spec.agent_ids.map((id) => team.agents.get(id)).filter((a): a is Agent => !!a && a.id !== agent.id);
      if (everyone.length)
        sys.push("## L'équipe du projet\n" + everyone.map((m) => `- ${m.emoji} ${m.name} : ${m.role}${entries.includes(m.id) ? " (premier contact avec toi)" : ""}`).join("\n"));
      if (phase === "cadrage") sys.push(PHASE_CADRAGE);
      if (phase === "execution") sys.push(PHASE_EXECUTION);
    }

    if (canDelegate) {
      const bySlug = new Map(delegates.map((m) => [slugify(m.name), m]));
      sys.push(
        "## Délégation\nTu peux faire travailler ces membres avec l'outil ask_agent :\n" +
          [...bySlug].map(([slug, m]) => `- ${slug} (${m.emoji} ${m.name}) : ${m.role}`).join("\n") +
          "\nChaque membre ne voit que ton message : donne-lui tout le contexte utile. Contrôle ce qu'il te renvoie avant de conclure.",
      );
      tools.push({
        type: "function",
        function: {
          name: "ask_agent",
          description:
            "Faire travailler un membre de l'équipe : il exécute la consigne (répondre, écrire du code, tester…) et te renvoie son résultat. C'est le SEUL moyen de faire agir un membre ; ajouter une carte au tableau ne le fait pas travailler.",
          parameters: {
            type: "object",
            properties: {
              agent: { type: "string", enum: [...bySlug.keys()], description: "Identifiant du membre" },
              message: { type: "string", description: "Consigne complète et autonome pour le membre" },
            },
            required: ["agent", "message"],
          },
        },
      });
      impls.ask_agent = async (args, toolCallId) => {
        const target = bySlug.get(slugify(String(args.agent ?? "")));
        if (!target) return `Membre inconnu « ${args.agent} ». Membres : ${[...bySlug.keys()].join(", ")}`;
        return runAgent({
          ...p,
          agent: target,
          input: String(args.message ?? ""),
          history: undefined,
          extra: undefined,
          consultOnly: false,
          phase: phase === "free" ? "free" : "execution",
          parentCallId: callId,
          viaToolCallId: toolCallId,
          depth: depth + 1,
          chain: [...(p.chain ?? []), agent.id],
        });
      };
    }

    const excluded = new Set(p.excludeTools ?? []);
    for (const [def, impl] of buildTools({ ...p.ctx, agent })) {
      if (excluded.has(def.function.name)) continue;
      tools.push(def);
      impls[def.function.name] = impl;
    }
    // First contacts keep the project's decision log up to date.
    if (team && entries.includes(agent.id) && p.ctx.projectId && !excluded.has("record_decision")) {
      tools.push({
        type: "function",
        function: {
          name: "record_decision",
          description: "Consigner une décision du projet dans le journal des décisions (partagé avec toute l'équipe).",
          parameters: {
            type: "object",
            properties: { decision: { type: "string", description: "La décision, en une ou deux phrases" }, raison: { type: "string", description: "Pourquoi" } },
            required: ["decision"],
          },
        },
      });
      impls.record_decision = async (a) => {
        await appendDecision(p.ctx.workspace, String(a.decision ?? "").slice(0, 200), a.raison ? `Raison : ${a.raison}` : "", agent.name);
        return "Décision consignée dans docs/DECISIONS.md.";
      };
    }

    // Everyone working on a project sees the latest decisions.
    if (p.ctx.projectId) {
      const log = await readDecisions(p.ctx.workspace);
      if (log) sys.push(`## Décisions du projet (docs/DECISIONS.md, à respecter)\n${log}`);
    }

    if (agent.tools?.includes("files_write") && !excluded.has("write_file")) sys.push(FILE_RULES);
    else if (agent.tools?.some((t) => t.startsWith("files_") || t === "run_command"))
      sys.push("## Dossier de travail\nTes outils fichiers et commandes agissent dans le dossier du projet (chemins relatifs). Commence par list_files pour t'orienter.");

    // Internal RAG: auto-inject the best passages, and expose a search tool for follow-ups.
    const kbIds = agent.kb_ids ?? [];
    if (kbIds.length) {
      try {
        const hits = await search(kbIds, p.input, 4);
        if (hits.length)
          sys.push("## Extraits de la base de connaissances (cite la source)\n" + hits.map((h) => `[${h.doc}] (score ${h.score.toFixed(2)})\n${h.text}`).join("\n---\n"));
      } catch (e) {
        emit({ type: "tool_result", callId, toolCallId: "rag", result: `RAG indisponible : ${String(e)}`, error: true });
      }
      tools.push({
        type: "function",
        function: {
          name: "search_knowledge",
          description: "Rechercher dans la base de connaissances interne.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      });
      impls.search_knowledge = async (a) => {
        const hits = await search(kbIds, String(a.query ?? ""), 5);
        return hits.length ? hits.map((h) => `[${h.doc}] ${h.text}`).join("\n---\n") : "Aucun passage pertinent.";
      };
    }

    // MCP servers attached to this agent.
    for (const id of agent.mcp_ids ?? []) {
      const server = get<McpServer>("mcp", id);
      if (!server?.enabled) continue;
      try {
        for (const t of await listMcpTools(server)) {
          const name = `${slugify(server.name)}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
          tools.push({ type: "function", function: { name, description: t.description?.slice(0, 1000) || t.name, parameters: t.inputSchema ?? { type: "object", properties: {} } } });
          impls[name] = (a) => callMcpTool(server, t.name, a);
        }
      } catch (e) {
        sys.push(`(Le serveur MCP « ${server.name} » est indisponible : ${e instanceof Error ? e.message : e})`);
      }
    }

    // ---- concertation: the speaker consults the other first contacts before answering
    if (isSpeaker && coLeads.length && team!.spec.concert && phase !== "execution") {
      const opinions = await Promise.all(
        coLeads.map(async (c) => {
          const brief = `${agent.name} et toi êtes les premiers contacts de l'utilisateur sur ce projet. Voici son dernier message :\n« ${p.input} »\n\nDonne ton analyse selon ton rôle (${c.role}) : points clés, risques, approche proposée, et les questions à poser à l'utilisateur. Sois concis et concret.`;
          const out = await delegate(p, callId, c, brief, { history: p.history, consultOnly: true, phase });
          return `### ${c.emoji} ${c.name} (${c.role})\n${out}`;
        }),
      );
      sys.push(
        "## Avis de tes co-responsables\n" +
          opinions.join("\n\n") +
          "\n\nRédige une réponse commune qui intègre ces avis (cite qui a soulevé quel point quand c'est utile) et regroupe les questions sans doublon.",
      );
    }

    if (p.extra?.length) sys.push(...p.extra);
    sys.push(`Date du jour : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "full" })}.`);

    const messages: ChatMessage[] = [{ role: "system", content: sys.join("\n\n") }, ...(p.history ?? []), { role: "user", content: p.input }];
    const toolsOk = resolveModel(agent.model).row?.supports_tools !== false;
    const maxSteps = Math.max(1, Number(getSettings().max_steps) || 8);

    let nudged = false;
    let carried = ""; // text already streamed before a nudge, kept in the final answer
    for (let step = 0; step < maxSteps; step++) {
      const last = step === maxSteps - 1;
      const res = await chatStream({
        ref: agent.model,
        messages,
        tools: toolsOk && !last ? tools : undefined,
        temperature: agent.temperature,
        think: agent.think,
        agentId: agent.id,
        projectId: p.ctx.projectId || null,
        signal,
        onText: (text) => emit({ type: "text", callId, text }),
        onReasoning: (text) => emit({ type: "reasoning", callId, text }),
      });
      if (!res.toolCalls.length) {
        // Small local models often announce an action ("je demande maintenant au développeur…") and stop.
        // Nudge once so the announced step actually runs (not during scoping, where asking is the goal).
        if (!nudged && tools.length && !last && phase !== "cadrage" && ANNOUNCES_ACTION.test(res.content.slice(-400))) {
          nudged = true;
          carried += res.content.trim() + "\n\n";
          messages.push({ role: "assistant", content: res.content });
          messages.push({ role: "user", content: "Tu viens d'annoncer une action sans l'exécuter. Exécute-la maintenant avec l'outil approprié, puis donne ta réponse finale complète." });
          emit({ type: "text", callId, text: "\n\n" });
          continue;
        }
        const content = (carried + res.content).trim() || "(pas de réponse)";
        emit({ type: "agent_end", callId, content });
        return content;
      }
      messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });
      const results = await Promise.all(
        res.toolCalls.map(async (tc) => {
          let args: Record<string, unknown> = {};
          let out: string;
          let error = false;
          let announced = false;
          try {
            args = parseArgs(tc.function.arguments);
            emit({ type: "tool_call", callId, toolCallId: tc.id, name: tc.function.name, args });
            announced = true;
            const impl = impls[tc.function.name];
            out = impl ? await impl(args, tc.id) : `Outil inconnu : ${tc.function.name}`;
            error = !impl;
          } catch (e) {
            if (signal?.aborted) throw e;
            if (!announced) emit({ type: "tool_call", callId, toolCallId: tc.id, name: tc.function.name, args: tc.function.arguments });
            out = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
            error = true;
          }
          emit({ type: "tool_result", callId, toolCallId: tc.id, result: out.slice(0, 2000), error });
          return { id: tc.id, out };
        }),
      );
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.out.slice(0, MAX_TOOL_RESULT) });
    }
    return "(limite d'étapes atteinte)";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emit({ type: "error", callId, message });
    if (depth > 0 && !signal?.aborted) return `Erreur chez ${agent.name} : ${message}`;
    throw e;
  }
}

/** Load the runtime team (agents by id) for a spec. */
export function teamRuntime(spec: TeamSpec): TeamRuntime {
  const agents = new Map(list<Agent>("agents").map((a) => [a.id, a]));
  return { spec: { ...spec, agent_ids: spec.agent_ids.filter((id) => agents.has(id)), entry_ids: spec.entry_ids.filter((id) => agents.has(id)) }, agents };
}
