// Team composition, shared by team templates and projects (client + server safe).

export type Link = { from: string; to: string };

export type TeamSpec = {
  agent_ids: string[];
  /** Directed "can delegate to" edges. */
  links: Link[];
  /** First points of contact: they receive the user's messages. The first one speaks for the group. */
  entry_ids: string[];
  /** Node positions from the visual builder. */
  layout: Record<string, { x: number; y: number }>;
  /** Scoping phase: entries ask questions and wait for approval before delegating. */
  clarify: boolean;
  /** With several entries, they consult each other before answering. */
  concert: boolean;
};

export type TeamLike = {
  lead_id?: string;
  member_ids?: string[];
  links?: Link[];
  entry_ids?: string[];
  layout?: Record<string, { x: number; y: number }>;
  clarify?: boolean;
  concert?: boolean;
};

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Normalise a team row (or an older lead + members team) into a full spec. */
export function specFromTeam(t: TeamLike): TeamSpec {
  const entry_ids = uniq(t.entry_ids?.length ? t.entry_ids : t.lead_id ? [t.lead_id] : []);
  const agent_ids = uniq([...entry_ids, t.lead_id ?? "", ...(t.member_ids ?? []), ...(t.links ?? []).flatMap((l) => [l.from, l.to])]);
  const lead = entry_ids[0];
  const links = t.links?.length ? t.links : lead ? agent_ids.filter((id) => !entry_ids.includes(id)).map((to) => ({ from: lead, to })) : [];
  return { agent_ids, links, entry_ids, layout: t.layout ?? {}, clarify: t.clarify ?? true, concert: t.concert ?? true };
}

/** Spec → columns stored on a team row (lead = first entry, members = everyone else). */
export function teamColumns(s: TeamSpec) {
  return {
    lead_id: s.entry_ids[0] ?? s.agent_ids[0] ?? "",
    member_ids: s.agent_ids.filter((id) => id !== (s.entry_ids[0] ?? s.agent_ids[0])),
    links: s.links,
    entry_ids: s.entry_ids,
    layout: s.layout,
    clarify: s.clarify,
    concert: s.concert,
  };
}

export const reportsOf = (s: TeamSpec, agentId: string) => uniq(s.links.filter((l) => l.from === agentId).map((l) => l.to));

/** Default positions: user on the left, entries next, then one column per delegation level. */
export function autoLayout(s: TeamSpec): Record<string, { x: number; y: number }> {
  const level = new Map<string, number>();
  let frontier = [...s.entry_ids];
  frontier.forEach((id) => level.set(id, 0));
  for (let d = 1; frontier.length && d < 10; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const to of reportsOf(s, id))
        if (!level.has(to)) {
          level.set(to, d);
          next.push(to);
        }
    frontier = next;
  }
  const maxLevel = Math.max(0, ...level.values());
  for (const id of s.agent_ids) if (!level.has(id)) level.set(id, maxLevel + 1);
  const cols = new Map<number, string[]>();
  for (const id of s.agent_ids) cols.set(level.get(id)!, [...(cols.get(level.get(id)!) ?? []), id]);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [lvl, ids] of cols) ids.forEach((id, i) => (out[id] = { x: 300 + lvl * 400, y: (i - (ids.length - 1) / 2) * 230 }));
  return out;
}

export const layoutOf = (s: TeamSpec) => {
  const auto = autoLayout(s);
  return Object.fromEntries(s.agent_ids.map((id) => [id, s.layout[id] ?? auto[id]]));
};
