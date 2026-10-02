import { list, upsert, type Agent, type Skill } from "@/lib/db";
import { SKILL_LIBRARY } from "@/lib/skillLibrary";

/** The built-in skills, with whether each one is already installed (matched by name). */
export async function GET() {
  const installed = new Set(list<Skill>("skills").map((s) => s.name.toLowerCase()));
  return Response.json(SKILL_LIBRARY.map((s) => ({ ...s, installed: installed.has(s.name.toLowerCase()) })));
}

/**
 * Install library skills (all, or `names`). Already installed ones are left untouched.
 * `assign`: also give each skill to the agents whose name matches one of its profiles.
 */
export async function POST(req: Request) {
  const { names, assign } = (await req.json().catch(() => ({}))) as { names?: string[]; assign?: boolean };
  const wanted = SKILL_LIBRARY.filter((s) => !names?.length || names.includes(s.name));
  const byName = new Map(list<Skill>("skills").map((s) => [s.name.toLowerCase(), s]));
  let added = 0;
  const ids = new Map<string, string>();
  for (const s of wanted) {
    let skill = byName.get(s.name.toLowerCase());
    if (!skill) {
      skill = upsert<Skill>("skills", { name: s.name, description: s.description, content: s.content });
      added++;
    }
    ids.set(s.name, skill.id);
  }
  let assigned = 0;
  if (assign)
    for (const a of list<Agent>("agents")) {
      const extra = wanted.filter((s) => s.profiles.includes(a.name)).map((s) => ids.get(s.name)!);
      const next = [...new Set([...(a.skill_ids ?? []), ...extra])];
      if (next.length !== (a.skill_ids ?? []).length) {
        upsert("agents", { id: a.id, skill_ids: next });
        assigned++;
      }
    }
  return Response.json({ added, assigned, total: wanted.length });
}
