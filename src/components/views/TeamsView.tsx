"use client";

import { FolderPlus, Plus, Sparkles, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { specFromTeam, teamColumns, type TeamSpec } from "@/lib/team";
import { api, crud, type Agent, type Team } from "../api";
import { TeamBuilder } from "../TeamBuilder";
import { Avatar, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Textarea } from "../ui";

export function TeamsView({ agents, teams, onChange, onCreateProject }: { agents: Agent[]; teams: Team[]; onChange: () => void; onCreateProject: (templateId: string) => void }) {
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; spec: TeamSpec } | null>(null);
  const [gen, setGen] = useState(false);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const { t } = useT();
  return (
    <div>
      <PageHeader
        title={t("Modèles d'équipe")}
        subtitle={t("Une équipe est un modèle : à la création d'un projet, sa composition (agents, liens, premiers contacts) est copiée dans le projet.")}
        actions={
          <>
            <Button onClick={() => setGen(true)}>
              <Sparkles size={15} className="text-accent" /> {t("Générer une équipe")}
            </Button>
            <Button variant="primary" onClick={() => setEdit({ name: "", description: "", spec: specFromTeam({}) })}>
              <Plus size={15} /> {t("Nouveau modèle")}
            </Button>
          </>
        }
      />
      <div className="grid gap-3 p-6 lg:grid-cols-2">
        {teams.map((team) => {
          const spec = specFromTeam(team);
          const entries = spec.entry_ids.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
          const others = spec.agent_ids.filter((id) => !spec.entry_ids.includes(id)).map((id) => byId.get(id)).filter((a): a is Agent => !!a);
          return (
            <Card key={team.id} onClick={() => setEdit({ id: team.id, name: team.name, description: team.description, spec })} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{team.name}</div>
                  <div className="line-clamp-2 text-sm text-fg-muted">{team.description}</div>
                </div>
                <Button
                  size="sm"
                  variant="soft"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateProject(team.id);
                  }}
                >
                  <FolderPlus size={14} /> {t("Créer un projet")}
                </Button>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex gap-2">
                  {entries.map((a) => (
                    <div key={a.id} className="flex flex-col items-center gap-1">
                      <Avatar emoji={a.emoji} color={a.color} size={42} />
                      <span className="max-w-20 truncate text-[11px] font-medium">★ {a.name}</span>
                    </div>
                  ))}
                </div>
                {others.length > 0 && <div className="h-px w-8 bg-line-strong" />}
                <div className="flex flex-wrap gap-3">
                  {others.map((m) => (
                    <div key={m.id} className="flex flex-col items-center gap-1">
                      <Avatar emoji={m.emoji} color={m.color} size={32} />
                      <span className="max-w-20 truncate text-[11px] text-fg-muted">{m.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex gap-3 text-[11px] text-fg-subtle">
                <span>{t("{n} lien(s)", { n: spec.links.length })}</span>
                {spec.clarify && <span>· {t("cadrage avant délégation")}</span>}
                {spec.entry_ids.length > 1 && spec.concert && <span>· {t("concertation des premiers contacts")}</span>}
              </div>
            </Card>
          );
        })}
      </div>
      {!teams.length && (
        <Empty icon={<Users size={28} />} title={t("Aucun modèle d'équipe")}>
          {t("Construis une équipe visuellement, ou décris-la et laisse le modèle générer les agents.")}
        </Empty>
      )}
      {edit && <TeamEditor initial={edit} agents={agents} onClose={() => setEdit(null)} onSaved={onChange} />}
      <GenerateTeam open={gen} onClose={() => setGen(false)} onDone={onChange} />
    </div>
  );
}

/** Full-screen editor: name + options on top, visual builder below. Also used for a project's team. */
export function TeamEditorShell({
  title,
  name,
  description,
  spec,
  agents,
  onName,
  onDescription,
  onSpec,
  onClose,
  onSave,
  onDelete,
  onAgentCreated,
  error,
}: {
  title: string;
  name?: string;
  description?: string;
  spec: TeamSpec;
  agents: Agent[];
  onName?: (v: string) => void;
  onDescription?: (v: string) => void;
  onSpec: (s: TeamSpec) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onAgentCreated?: () => void;
  error?: string;
}) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-0">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="text-base font-semibold">{title}</div>
        <div className="flex-1" />
        {onDelete && (
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 size={13} /> {t("Supprimer")}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t("Annuler")}
        </Button>
        <Button variant="primary" onClick={onSave}>
          {t("Enregistrer")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("Fermer")}>
          <X size={16} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto]">
          {onName && (
            <Field label={t("Nom")}>
              <Input value={name} onChange={(e) => onName(e.target.value)} placeholder={t("Équipe produit")} />
            </Field>
          )}
          {onDescription && (
            <Field label={t("Description")}>
              <Input value={description} onChange={(e) => onDescription(e.target.value)} placeholder={t("À quoi sert cette équipe")} />
            </Field>
          )}
          <div className="flex flex-col justify-end gap-1.5 text-sm">
            <label className="flex items-center gap-2" title={t("Les premiers contacts posent leurs questions et attendent ta validation avant de répartir le travail.")}>
              <input type="checkbox" checked={spec.clarify} onChange={(e) => onSpec({ ...spec, clarify: e.target.checked })} className="accent-[var(--accent)]" />
              {t("Cadrage avant délégation")}
            </label>
            <label className="flex items-center gap-2" title={t("Avec plusieurs premiers contacts, ils se consultent avant de te répondre.")}>
              <input type="checkbox" checked={spec.concert} onChange={(e) => onSpec({ ...spec, concert: e.target.checked })} className="accent-[var(--accent)]" />
              {t("Concertation entre premiers contacts")}
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <TeamBuilder agents={agents} value={spec} onChange={onSpec} onAgentCreated={onAgentCreated} />
        </div>
      </div>
    </div>
  );
}

function TeamEditor({ initial, agents, onClose, onSaved }: { initial: { id?: string; name: string; description: string; spec: TeamSpec }; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState(initial);
  const [error, setError] = useState<string>();
  const { t: tr } = useT();
  return (
    <TeamEditorShell
      title={t.id ? tr("Modèle : {name}", { name: t.name }) : tr("Nouveau modèle d'équipe")}
      name={t.name}
      description={t.description}
      spec={t.spec}
      agents={agents}
      onName={(name) => setT({ ...t, name })}
      onDescription={(description) => setT({ ...t, description })}
      onSpec={(spec) => setT({ ...t, spec })}
      onClose={onClose}
      onAgentCreated={onSaved}
      error={error}
      onDelete={
        t.id
          ? async () => {
              if (!confirm(tr("Supprimer le modèle « {name} » ? Les projets déjà créés et les agents sont conservés.", { name: t.name }))) return;
              await crud.remove("teams", t.id!);
              onSaved();
              onClose();
            }
          : undefined
      }
      onSave={async () => {
        if (!t.name.trim()) return setError(tr("Le nom est obligatoire"));
        if (!t.spec.entry_ids.length) return setError(tr("Définis au moins un premier contact (★)"));
        await crud.save("teams", { id: t.id, name: t.name, description: t.description, ...teamColumns(t.spec) });
        onSaved();
        onClose();
      }}
    />
  );
}

function GenerateTeam({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [desc, setDesc] = useState("");
  const [size, setSize] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { t } = useT();
  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/generate", { method: "POST", json: { kind: "team", description: desc, size } });
      onDone();
      onClose();
      setDesc("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Générer une équipe avec l'IA")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" onClick={run} disabled={!desc.trim() || busy}>
            <Sparkles size={14} /> {busy ? t("Génération… (≈ 1 min)") : t("Générer")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t("Quelle équipe ?")}>
          <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("ex : une équipe marketing pour lancer un produit SaaS B2B : stratégie, rédaction, SEO")} />
        </Field>
        <Field label={t("Nombre de spécialistes : {n}", { n: size })}>
          <input type="range" min={1} max={6} value={size} onChange={(e) => setSize(Number(e.target.value))} className="accent-[var(--accent)]" />
        </Field>
        <p className="text-xs text-fg-subtle">{t("Tu pourras ensuite ajuster les liens et les premiers contacts dans le constructeur.")}</p>
      </div>
    </Modal>
  );
}
