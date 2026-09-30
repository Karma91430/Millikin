import { upsert } from "@/lib/db";
import { generateAgent, generateSkill, generateTeam } from "@/lib/generator";

type Body = { kind: "agent" | "team" | "skill"; description: string; size?: number; save?: boolean };

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  if (!b.description?.trim()) return Response.json({ error: "Description vide" }, { status: 400 });
  try {
    if (b.kind === "agent") {
      const draft = await generateAgent(b.description);
      return Response.json(b.save ? upsert("agents", draft) : draft);
    }
    if (b.kind === "skill") {
      const draft = await generateSkill(b.description);
      return Response.json(b.save ? upsert("skills", draft) : draft);
    }
    const t = await generateTeam(b.description, Math.min(6, Math.max(1, b.size ?? 3)));
    const lead = upsert<{ id: string }>("agents", t.lead);
    const members = t.members.map((m) => upsert<{ id: string }>("agents", m));
    const team = upsert("teams", {
      name: t.name,
      description: t.description,
      lead_id: lead.id,
      member_ids: members.map((m) => m.id),
      entry_ids: [lead.id],
      links: members.map((m) => ({ from: lead.id, to: m.id })),
      clarify: true,
      concert: true,
    });
    return Response.json(team);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
