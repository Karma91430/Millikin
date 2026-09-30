"use client";

import { Library, Plug } from "lucide-react";
import { useState } from "react";
import { normalizeResources, type ProjectResources } from "@/lib/resources";
import { specFromTeam } from "@/lib/team";
import { crud, useData, type Agent, type Kb, type McpServer, type Project } from "./api";
import { Avatar, Button, Card, cx, Field, Pick, Select } from "./ui";

/** Knowledge and MCP servers connected to a project, and which agents may use each. */
export function ProjectResourcesPanel({ project, agents, onSaved }: { project: Project; agents: Agent[]; onSaved: () => void }) {
  const [res, setRes] = useState<ProjectResources>(() => normalizeResources(project.resources));
  const [dirty, setDirty] = useState(false);
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const servers = useData<McpServer[]>("/api/crud/mcp");
  const tags = useData<{ tag: string; count: number }[]>(res.rag.kb_ids.length ? `/api/kb/tags?kbIds=${res.rag.kb_ids.join(",")}` : null);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const team = specFromTeam(project.team).agent_ids.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
  const update = (r: ProjectResources) => (setRes(r), setDirty(true));
  const setRag = (patch: Partial<ProjectResources["rag"]>) => update({ ...res, rag: { ...res.rag, ...patch } });
  const connected = res.mcp.map((m) => servers.data?.find((s) => s.id === m.server_id)).filter((s): s is McpServer => !!s);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const columns: { key: string; label: React.ReactNode; has: (a: string) => boolean; flip: (a: string) => void; all: (on: boolean) => void }[] = [
    ...(res.rag.kb_ids.length
      ? [
          {
            key: "rag",
            label: (
              <>
                <Library size={13} /> Connaissances
              </>
            ),
            has: (a: string) => res.rag.agent_ids.includes(a),
            flip: (a: string) => setRag({ agent_ids: toggle(res.rag.agent_ids, a) }),
            all: (on: boolean) => setRag({ agent_ids: on ? team.map((t) => t.id) : [] }),
          },
        ]
      : []),
    ...connected.map((s) => ({
      key: s.id,
      label: (
        <>
          <Plug size={13} /> {s.name}
        </>
      ),
      has: (a: string) => !!res.mcp.find((m) => m.server_id === s.id)?.agent_ids.includes(a),
      flip: (a: string) => update({ ...res, mcp: res.mcp.map((m) => (m.server_id === s.id ? { ...m, agent_ids: toggle(m.agent_ids, a) } : m)) }),
      all: (on: boolean) => update({ ...res, mcp: res.mcp.map((m) => (m.server_id === s.id ? { ...m, agent_ids: on ? team.map((t) => t.id) : [] } : m)) }),
    })),
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-fg-muted">
          Connecte des bases de connaissances et des serveurs MCP au projet, puis choisis qui y a accès. Un agent sans accès ne reçoit ni extraits ni outils supplémentaires : ses réflexions restent plus rapides.
        </p>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            await crud.save("projects", { id: project.id, resources: res });
            setDirty(false);
            onSaved();
          }}
        >
          {dirty ? "Enregistrer les ressources" : "Enregistré ✓"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Library size={15} /> Connaissances (RAG)
          </div>
          <Field label="Bases connectées">
            <Pick
              items={kbs.data ?? []}
              value={res.rag.kb_ids}
              onChange={(v) => setRag({ kb_ids: v, tags: v.length ? res.rag.tags : [] })}
              render={(k) => `📚 ${k.name}`}
              empty="Aucune base : crée-en dans l'onglet Connaissances."
            />
          </Field>
          {res.rag.kb_ids.length > 0 && (
            <>
              <Field label="Filtrer par tags" hint="Seuls les documents portant l'un de ces tags sont utilisés. Aucun tag sélectionné = tous les documents.">
                <Pick
                  items={(tags.data ?? []).map((t) => ({ id: t.tag, ...t }))}
                  value={res.rag.tags}
                  onChange={(v) => setRag({ tags: v })}
                  render={(t) => `#${t.tag} (${t.count})`}
                  empty="Aucun tag dans ces bases : ajoute des tags aux documents dans l'onglet Connaissances."
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Utilisation">
                  <Select value={res.rag.mode} onChange={(e) => setRag({ mode: e.target.value as ProjectResources["rag"]["mode"] })}>
                    <option value="auto">Extraits injectés automatiquement</option>
                    <option value="tool">Recherche à la demande (plus rapide)</option>
                  </Select>
                </Field>
                <Field label="Extraits par recherche">
                  <Select value={res.rag.top_k} onChange={(e) => setRag({ top_k: Number(e.target.value) })}>
                    {[2, 3, 4, 5, 6, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Recherche hybride">
                  <Select value={res.rag.hybrid ? "on" : "off"} onChange={(e) => setRag({ hybrid: e.target.value === "on" })}>
                    <option value="on">Sens + mots-clés (recommandé)</option>
                    <option value="off">Sens uniquement</option>
                  </Select>
                </Field>
                <Field label="Reranking">
                  <Select value={res.rag.rerank} onChange={(e) => setRag({ rerank: e.target.value as ProjectResources["rag"]["rerank"] })}>
                    <option value="none">Aucun (le plus rapide)</option>
                    <option value="mmr">MMR (varier les sources)</option>
                    <option value="llm">LLM (plus pertinent, plus lent)</option>
                  </Select>
                </Field>
              </div>
              <p className="text-[11px] text-fg-subtle">
                « Injectés » : les meilleurs passages sont ajoutés avant chaque réponse (plus complet, plus lent). « À la demande » : l&apos;agent appelle search_knowledge seulement quand il en a besoin.
              </p>
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Plug size={15} /> Serveurs MCP
          </div>
          <Field label="Serveurs connectés">
            <Pick
              items={servers.data ?? []}
              value={res.mcp.map((m) => m.server_id)}
              onChange={(v) => update({ ...res, mcp: v.map((id) => res.mcp.find((m) => m.server_id === id) ?? { server_id: id, agent_ids: [] }) })}
              render={(m) => `🔌 ${m.name}${m.enabled ? "" : " (désactivé)"}`}
              empty="Aucun serveur : ajoute-en dans l'onglet MCP."
            />
          </Field>
          <p className="text-[11px] text-fg-subtle">Chaque serveur ajoute ses outils aux agents autorisés ci-dessous. Peu d&apos;outils par agent = de meilleurs choix pour les petits modèles.</p>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Qui a accès à quoi</div>
        {!columns.length ? (
          <div className="px-4 py-4 text-sm text-fg-subtle">Connecte d&apos;abord une base de connaissances ou un serveur MCP.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-muted">
                <th className="px-4 py-2 font-medium">Agent</th>
                {columns.map((c) => {
                  const allOn = team.length > 0 && team.every((t) => c.has(t.id));
                  return (
                    <th key={c.key} className="px-4 py-2 text-center font-medium">
                      <button onClick={() => c.all(!allOn)} className="inline-flex items-center gap-1.5 hover:text-fg" title={allOn ? "Tout décocher" : "Tout cocher"}>
                        {c.label}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {team.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar emoji={a.emoji} color={a.color} size={24} />
                      <span>
                        <span className="block text-sm">{a.name}</span>
                        <span className="block text-[11px] text-fg-subtle">{a.role}</span>
                      </span>
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-center">
                      <input type="checkbox" checked={c.has(a.id)} onChange={() => c.flip(a.id)} className={cx("h-4 w-4 accent-[var(--accent)]")} aria-label={`${a.name} : accès`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
