"use client";

import { Blocks, FileUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { api, crud, useData, type Skill } from "../api";
import { Button, Card, cx, Empty, ErrorNote, Field, Input, Markdown, PageHeader, Textarea } from "../ui";

/** Parse a SKILL.md (YAML-ish frontmatter with name/description, then the body). */
function parseSkillMd(text: string, fallbackName: string): Partial<Skill> {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { name: fallbackName, description: "", content: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { name: meta.name || fallbackName, description: meta.description || "", content: m[2].trim() };
}

export function SkillsView() {
  const skills = useData<Skill[]>("/api/crud/skills");
  const [cur, setCur] = useState<Partial<Skill> | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!cur?.name?.trim()) return setError("Le nom est obligatoire");
    const s = await crud.save<Skill>("skills", cur);
    setCur(s);
    setError(undefined);
    skills.reload();
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        subtitle="Des méthodes et formats réutilisables, injectés dans le prompt des agents qui les possèdent."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              hidden
              onChange={async (e) => {
                for (const f of Array.from(e.target.files ?? [])) await crud.save("skills", parseSkillMd(await f.text(), f.name.replace(/\.(md|markdown|txt)$/i, "")));
                e.target.value = "";
                skills.reload();
              }}
            />
            <Button onClick={() => fileRef.current?.click()}>
              <FileUp size={15} /> Importer SKILL.md
            </Button>
            <Button variant="primary" onClick={() => setCur({ name: "", description: "", content: "" })}>
              <Plus size={15} /> Nouveau skill
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-2">
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Sparkles size={14} className="text-accent" /> Générer avec l&apos;IA
            </div>
            <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="ex : revue de code orientée sécurité, avec une grille de sévérité" />
            <Button
              className="mt-2 w-full"
              variant="primary"
              size="sm"
              disabled={!brief.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  setCur(await api<Skill>("/api/generate", { method: "POST", json: { kind: "skill", description: brief } }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Génération…" : "Générer un brouillon"}
            </Button>
          </Card>
          {(skills.data ?? []).map((s) => (
            <Card key={s.id} onClick={() => setCur(s)} className={cx("p-3", cur?.id === s.id && "border-accent")}>
              <div className="text-sm font-medium">{s.name}</div>
              <div className="line-clamp-2 text-xs text-fg-muted">{s.description}</div>
            </Card>
          ))}
        </div>
        <div className="min-w-0">
          {cur ? (
            <Card className="flex flex-col gap-3 p-4">
              <ErrorNote>{error}</ErrorNote>
              <Field label="Nom">
                <Input value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} />
              </Field>
              <Field label="Quand l'utiliser">
                <Input value={cur.description} onChange={(e) => setCur({ ...cur, description: e.target.value })} />
              </Field>
              <Field label="Instructions (Markdown)">
                <div className="mb-1 flex gap-1">
                  <Button size="sm" variant={preview ? "ghost" : "soft"} onClick={() => setPreview(false)}>
                    Éditer
                  </Button>
                  <Button size="sm" variant={preview ? "soft" : "ghost"} onClick={() => setPreview(true)}>
                    Aperçu
                  </Button>
                </div>
                {preview ? (
                  <div className="min-h-64 rounded-lg border border-line bg-surface-0 p-3">
                    <Markdown>{cur.content || "_vide_"}</Markdown>
                  </div>
                ) : (
                  <Textarea rows={16} className="font-mono text-xs" value={cur.content} onChange={(e) => setCur({ ...cur, content: e.target.value })} />
                )}
              </Field>
              <div className="flex gap-2">
                {cur.id && (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(`Supprimer le skill « ${cur.name} » ?`)) return;
                      await crud.remove("skills", cur.id!);
                      setCur(null);
                      skills.reload();
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
                <div className="flex-1" />
                <Button variant="primary" onClick={save}>
                  Enregistrer
                </Button>
              </div>
            </Card>
          ) : (
            <Empty icon={<Blocks size={28} />} title="Sélectionne ou crée un skill">
              Un skill décrit une méthode (ex : format ADR, grille de revue de code). Attache-le ensuite aux agents concernés.
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
