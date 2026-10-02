import { list, upsert, type Agent, type Skill } from "@/lib/db";
import { SKILL_LIBRARY } from "@/lib/skillLibrary";

const key = (name: string) => name.trim().toLowerCase();

/** The built-in skills, with their install state (matched by name) and whether the library has a newer text. */
export async function GET() {
  const installed = new Map(list<Skill>("skills").map((s) => [key(s.name), s]));
  return Response.json(
    SKILL_LIBRARY.map((s) => {
      const mine = installed.get(key(s.name));
      return { ...s, installed: !!mine, id: mine?.id, outdated: !!mine && (mine.content !== s.content || mine.description !== s.description || mine.category !== s.category) };
    }),
  );
}

/**
 * Install library skills (all, or `names`); installed ones are left untouched unless listed in `update`,
 * which replaces their text with the library version. `assign` also gives each skill to the agents
 * whose name matches one of its recommended profiles.
 */
export async function POST(req: Request) {
  const { names, update, assign } = (await req.json().catch(() => ({}))) as { names?: string[]; update?: string[]; assign?: boolean };
  const wanted = SKILL_LIBRARY.filter((s) => (!names?.length && !update?.length) || names?.includes(s.name) || update?.includes(s.name));
  const byName = new Map(list<Skill>("skills").map((s) => [key(s.name), s]));
  let added = 0;
  let updated = 0;
  const ids = new Map<string, string>();
  for (const s of wanted) {
    let skill = byName.get(key(s.name));
    const text = { description: s.description, content: s.content, category: s.category };
    if (!skill) {
      skill = upsert<Skill>("skills", { name: s.name, ...text });
      added++;
    } else if (update?.includes(s.name)) {
      skill = upsert<Skill>("skills", { id: skill.id, ...text });
      updated++;
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
  return Response.json({ added, updated, assigned, total: wanted.length });
}
