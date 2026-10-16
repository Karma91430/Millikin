import { withAccess } from "@/lib/access";
import { list, type Agent } from "@/lib/db";
import { complete } from "@/lib/gateway";
import { ALL_MODULES, PROJECT_MODULES } from "@/lib/modules";
import { BUILTIN_PROFILES } from "@/lib/profiles";

const parse = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as T;
  } catch {
    return null;
  }
};

/**
 * Suggestions for a new project, from its name and description, with the default model:
 * `team` picks members among existing agents and built-in profiles (closed list), `modules` picks the sections.
 */
async function handlePOST(req: Request) {
  const { name, description, what } = (await req.json()) as { name: string; description?: string; what: "team" | "modules" };
  const brief = `Projet « ${name} »${description ? ` : ${description}` : ""}`;
  try {
    if (what === "modules") {
      const raw = await complete({
        temperature: 0.1,
        source: "generator",
        schema: {
          type: "object",
          properties: { modules: { type: "array", items: { type: "string", enum: ALL_MODULES } }, raison: { type: "string" } },
          required: ["modules"],
        },
        messages: [
          {
            role: "system",
            content: `Tu configures un projet dans une plateforme d'agents IA. Choisis les modules utiles à ce projet, ni plus ni moins. Réponds en JSON : {"modules": [...], "raison": "une phrase"}.
Modules disponibles :
${PROJECT_MODULES.map((m) => `- ${m.id} : ${m.label} — ${m.description}`).join("\n")}`,
          },
          { role: "user", content: brief },
        ],
      });
      const j = parse<{ modules?: string[]; raison?: string }>(raw);
      const modules = (j?.modules ?? []).filter((m) => (ALL_MODULES as string[]).includes(m));
      return Response.json({ modules: modules.length ? modules : ["board", "files"], reason: j?.raison ?? "" });
    }

    // Team: a closed list of candidates (existing agents first, then profiles not instantiated yet).
    const agents = list<Agent>("agents");
    const candidates = [
      ...agents.map((a) => ({ id: a.id, label: a.name, role: a.role })),
      ...BUILTIN_PROFILES.filter((p) => !agents.some((a) => a.name === p.name)).map((p) => ({ id: p.id, label: p.name, role: p.role })),
    ];
    const labels = [...new Set(candidates.map((c) => c.label))];
    const raw = await complete({
      temperature: 0.2,
      source: "generator",
      schema: {
        type: "object",
        properties: {
          membres: { type: "array", items: { type: "string", enum: labels }, minItems: 2, maxItems: 8 },
          premiers_contacts: { type: "array", items: { type: "string", enum: labels }, minItems: 1, maxItems: 2 },
          raison: { type: "string" },
        },
        required: ["membres", "premiers_contacts"],
      },
      messages: [
        {
          role: "system",
          content: `Tu composes l'équipe d'agents IA d'un projet. Choisis 3 à 6 membres complémentaires adaptés au projet (pas de doublon de rôle), et 1 ou 2 premiers contacts parmi eux : ceux qui pilotent (cadrage, découpage, contrôle), en général un chef de projet ou product owner et un tech lead pour un projet technique.
Réponds en JSON : {"membres": [...], "premiers_contacts": [...], "raison": "une phrase"}.
Candidats :
${candidates.map((c) => `- ${c.label} : ${c.role}`).join("\n")}`,
        },
        { role: "user", content: brief },
      ],
    });
    const j = parse<{ membres?: string[]; premiers_contacts?: string[]; raison?: string }>(raw);
    const idOf = (label: string) => candidates.find((c) => c.label === label)?.id;
    const members = [...new Set((j?.membres ?? []).map(idOf).filter((x): x is string => !!x))];
    const entries = [...new Set((j?.premiers_contacts ?? []).map(idOf).filter((x): x is string => !!x))];
    for (const e of entries) if (!members.includes(e)) members.unshift(e);
    if (!members.length) throw new Error("Aucune équipe proposée, réessaie");
    return Response.json({ members, entries: entries.length ? entries : members.slice(0, 1), reason: j?.raison ?? "" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const POST = withAccess("edit", handlePOST, { credits: true });
