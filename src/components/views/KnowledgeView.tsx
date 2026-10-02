"use client";

import { FileText, Library, Network, Plus, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "@/i18n";
import { api, crud, useData, type Kb } from "../api";
import { KnowledgeGraph, tagColor, type GDoc } from "../KnowledgeGraph";
import { Badge, Button, Card, cx, Drawer, Empty, ErrorNote, Field, Input, Modal, PageHeader, Textarea } from "../ui";

type Doc = { id: string; kb_id: string; name: string; chars: number; chunks: number; tags: string[]; created_at: number };
type Hit = { text: string; doc: string; kb: string; tags: string[]; score: number };

export function KnowledgeView() {
  const { t } = useT();
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const [view, setView] = useState<"list" | "graph">("list");
  const [sel, setSel] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [openDoc, setOpenDoc] = useState<GDoc | null>(null);
  const kb = kbs.data?.find((k) => k.id === sel) ?? kbs.data?.[0];
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Connaissances")}
        subtitle={t("RAG interne : documents découpés et indexés localement, organisés par tags. Les projets choisissent quelles bases et quels tags leurs agents utilisent.")}
        actions={
          <>
            <div className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ["list", "Bases", Library],
                  ["graph", "Graphe", Network],
                ] as const
              ).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setView(id)} className={cx("flex items-center gap-1.5 rounded-md px-3 py-1 text-sm", view === id ? "bg-surface-3 text-fg" : "text-fg-muted")}>
                  <Icon size={14} /> {t(label)}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setCreate(true)}>
              <Plus size={15} /> {t("Nouvelle base")}
            </Button>
          </>
        }
      />
      {view === "graph" ? (
        <div className="min-h-0 flex-1">
          <KnowledgeGraph onOpenDoc={setOpenDoc} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-2">
            {(kbs.data ?? []).map((k) => (
              <Card key={k.id} onClick={() => setSel(k.id)} className={cx("p-3", kb?.id === k.id && "border-accent")}>
                <div className="text-sm font-medium">📚 {k.name}</div>
                <div className="line-clamp-2 text-xs text-fg-muted">{k.description}</div>
              </Card>
            ))}
          </div>
          {kb ? (
            <KbDetail key={kb.id} kb={kb} onDeleted={() => (setSel(null), kbs.reload())} />
          ) : (
            <Empty icon={<Library size={28} />} title={t("Aucune base de connaissances")}>
              {t("Crée une base, importe des documents (texte, Markdown, code, PDF) avec des tags, puis connecte-la à un projet.")}
            </Empty>
          )}
        </div>
      )}
      <CreateKb open={create} onClose={() => setCreate(false)} onCreated={(id) => (setSel(id), kbs.reload())} />
      {openDoc && <DocDrawer doc={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

type RetagEvent = { themes?: string[]; doc?: string; tags?: string[]; error?: string; done?: number; total?: number };

/** Retag a whole base with the local model, showing the themes and each document as it is done. */
function Retag({ kbIds, count, onDone }: { kbIds: string[]; count: number; onDone: () => void }) {
  const { t } = useT();
  const [log, setLog] = useState<RetagEvent[] | null>(null);
  const [running, setRunning] = useState(false);
  const themes = log?.findLast((e) => e.themes)?.themes;
  const last = log?.findLast((e) => e.total);
  async function run() {
    if (!confirm(t("Le modèle local va proposer des thèmes puis retaguer chaque document de la base (les tags actuels seront remplacés). Continuer ?"))) return;
    setRunning(true);
    setLog([]);
    try {
      const res = await fetch("/api/kb/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retag: true, kbIds }) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        const evs = lines.filter(Boolean).map((l) => JSON.parse(l) as RetagEvent);
        if (evs.length) setLog((cur) => [...(cur ?? []), ...evs]);
      }
    } finally {
      setRunning(false);
      onDone();
    }
  }
  return (
    <>
      <Button size="sm" onClick={run} disabled={running || !count} title={t("Le modèle local définit les thèmes de la base puis retague chaque document")}>
        <Sparkles size={13} /> {running ? t("Tags… {done}/{total}", { done: last?.done ?? 0, total: last?.total ?? count }) : t("Retaguer avec le modèle local")}
      </Button>
      {log && (
        <Modal open onClose={() => !running && setLog(null)} title={t("Retag par le modèle local")}>
          <div className="flex flex-col gap-3 text-sm">
            {!themes && <p className="text-fg-muted">{t("Le modèle lit les documents et propose les thèmes principaux…")}</p>}
            {themes && (
              <div>
                <div className="mb-1 text-xs text-fg-muted">{t("Thèmes retenus (un par document, ils forment les constellations du graphe)")}</div>
                <div className="flex flex-wrap gap-1">
                  {themes.map((th) => (
                    <span key={th} className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: tagColor(th) }}>
                      #{th}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
              {log
                .filter((e) => e.doc)
                .map((e, i) => (
                  <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs last:border-0">
                    <span className="min-w-0 flex-1 truncate">{e.doc}</span>
                    {e.error ? (
                      <span className="text-red-400">{e.error}</span>
                    ) : (
                      <span className="flex flex-wrap justify-end gap-1">
                        {e.tags?.map((tag, k) => (
                          <span key={tag} className={cx("rounded-full px-1.5 text-[10px]", k === 0 ? "text-white" : "text-fg-muted")} style={k === 0 ? { background: tagColor(tag) } : undefined}>
                            #{tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
            </div>
            <div className="text-xs text-fg-subtle">{running ? t("En cours : {done}/{total} documents", { done: last?.done ?? 0, total: last?.total ?? count }) : t("Terminé.")}</div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Editable tag chips with an AI suggestion button. */
function TagEditor({ docId, tags, onChange }: { docId: string; tags: string[]; onChange: (t: string[]) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (next: string[]) => {
    const r = await api<{ tags: string[] }>("/api/kb", { method: "PATCH", json: { docId, tags: next } });
    onChange(r.tags);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: tagColor(tag) }}>
          #{tag}
          <button onClick={() => save(tags.filter((x) => x !== tag))} aria-label={t("retirer {tag}", { tag })} className="opacity-70 hover:opacity-100">
            <X size={10} />
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) save([...tags, draft]).then(() => setDraft(""));
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="+ tag" className="h-6 w-20 rounded-md border border-line bg-surface-1 px-1.5 text-[11px] outline-none focus:border-accent" />
      </form>
      <button
        disabled={busy}
        title={t("Suggérer des tags avec l'IA")}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ tags: string[] }>("/api/kb/tags", { method: "POST", json: { docId } });
            await save([...new Set([...tags, ...r.tags])]);
          } finally {
            setBusy(false);
          }
        }}
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        <Sparkles size={11} /> {busy ? "…" : t("suggérer")}
      </button>
    </div>
  );
}

function DocDrawer({ doc, onClose }: { doc: GDoc; onClose: () => void }) {
  const { t } = useT();
  const [tags, setTags] = useState(doc.tags);
  return (
    <Drawer open onClose={onClose} title={`📄 ${doc.name}`}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="text-fg-muted">
          {t("Base :")} <b className="text-fg">{doc.kb}</b> · {t("{n} passages", { n: doc.chunks })} · {t("{k}k caractères", { k: Math.round(doc.chars / 1000) })}
        </div>
        <Field label={t("Tags")} hint={t("Les tags regroupent les documents en constellations et servent de filtres pour les projets et la recherche.")}>
          <TagEditor docId={doc.id} tags={tags} onChange={setTags} />
        </Field>
      </div>
    </Drawer>
  );
}

function KbDetail({ kb, onDeleted }: { kb: Kb; onDeleted: () => void }) {
  const { t } = useT();
  const docs = useData<Doc[]>(`/api/kb?kbId=${kb.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [paste, setPaste] = useState({ name: "", text: "" });
  const [uploadTags, setUploadTags] = useState("");
  const [q, setQ] = useState("");
  const [qTag, setQTag] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tagsInUse = [...new Set((docs.data ?? []).flatMap((d) => d.tags))].sort();

  async function upload(files: FileList | File[]) {
    const fd = new FormData();
    fd.set("kbId", kb.id);
    fd.set("tags", uploadTags);
    for (const f of Array.from(files)) fd.append("files", f);
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<{ name: string; error?: string }[]>("/api/kb", { method: "POST", body: fd });
      const failed = res.filter((r) => r.error);
      if (failed.length) setError(failed.map((f) => `${f.name} : ${f.error}`).join("\n"));
      docs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{kb.name}</div>
          <div className="text-sm text-fg-muted">{kb.description}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Retag kbIds={[kb.id]} count={docs.data?.length ?? 0} onDone={docs.reload} />
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (!confirm(t("Supprimer la base « {name} » et tous ses documents ?", { name: kb.name }))) return;
              await crud.remove("kbs", kb.id);
              onDeleted();
            }}
          >
            <Trash2 size={13} /> {t("Supprimer la base")}
          </Button>
        </div>
      </div>
      <ErrorNote>{error && <pre className="whitespace-pre-wrap font-sans">{error}</pre>}</ErrorNote>

      <Card className="flex flex-col gap-3 p-3">
        <Field
          label={t("Tags appliqués aux prochains imports (séparés par des virgules)")}
          hint={t("Laisse vide pour que le modèle local tague chaque document : un thème principal puis des tags précis.")}
        >
          <Input value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} placeholder={t("ex : commander, règles")} />
        </Field>
        <div
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={cx("flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition", drag ? "border-accent bg-accent/5" : "border-line hover:border-line-strong")}
        >
          <Upload size={20} className="text-fg-muted" />
          <div className="text-sm">{busy ? t("Indexation en cours…") : t("Dépose des fichiers ou clique pour choisir")}</div>
          <div className="text-xs text-fg-subtle">{t(".txt .md .pdf .json .csv, code source…")}</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-3">
        <div className="text-sm font-medium">{t("Coller du texte")}</div>
        <Input placeholder={t("Titre du document")} value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} />
        <Textarea rows={4} placeholder={t("Contenu…")} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            disabled={!paste.text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/kb", { method: "POST", json: { kbId: kb.id, name: paste.name, text: paste.text, tags: uploadTags.split(",") } });
                setPaste({ name: "", text: "" });
                docs.reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Indexer")}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-line px-3 py-2 text-sm font-medium">{t("Documents ({n})", { n: docs.data?.length ?? 0 })}</div>
        {(docs.data ?? []).map((d) => (
          <div key={d.id} className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-0">
            <FileText size={14} className="mt-0.5 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.name}</div>
              <div className="mb-1 text-xs text-fg-subtle">
                {t("{n} passages", { n: d.chunks })} · {t("{k}k caractères", { k: Math.round(d.chars / 1000) })}
              </div>
              <TagEditor docId={d.id} tags={d.tags} onChange={(tg) => docs.setData((xs) => xs?.map((x) => (x.id === d.id ? { ...x, tags: tg } : x)))} />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api(`/api/kb?docId=${d.id}`, { method: "DELETE" });
                docs.reload();
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        {!docs.data?.length && <div className="px-3 py-3 text-xs text-fg-subtle">{t("Aucun document.")}</div>}
      </Card>

      <Card className="flex flex-col gap-2 p-3">
        <div className="text-sm font-medium">{t("Tester la recherche")}</div>
        {tagsInUse.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagsInUse.map((t) => (
              <button
                key={t}
                onClick={() => setQTag(qTag === t ? null : t)}
                className={cx("rounded-full border px-2 py-0.5 text-[11px]", qTag === t ? "text-white" : "text-fg-muted")}
                style={{ borderColor: tagColor(t), background: qTag === t ? tagColor(t) : undefined }}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setHits(await api<Hit[]>("/api/kb/search", { method: "POST", json: { kbIds: [kb.id], query: q, tags: qTag ? [qTag] : [] } }));
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Pose une question…")} />
          <Button type="submit" disabled={!q.trim()}>
            <Search size={14} />
          </Button>
        </form>
        {hits?.map((h, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-2.5 text-xs">
            <div className="mb-1 flex justify-between gap-2 text-fg-subtle">
              <span className="truncate">{h.doc}</span>
              <span className="shrink-0">{t("score {s}", { s: h.score.toFixed(3) })}</span>
            </div>
            <div className="mb-1 flex flex-wrap gap-1">
              {h.tags.map((t) => (
                <Badge key={t} color={tagColor(t)}>
                  #{t}
                </Badge>
              ))}
            </div>
            <div className="line-clamp-4 whitespace-pre-wrap text-fg-muted">{h.text}</div>
          </div>
        ))}
        {hits && !hits.length && <div className="text-xs text-fg-subtle">{t("Aucun résultat.")}</div>}
      </Card>
    </div>
  );
}

function CreateKb({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Nouvelle base de connaissances")}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            const kb = await crud.save<Kb>("kbs", { name, description });
            setName("");
            setDescription("");
            onCreated(kb.id);
            onClose();
          }}
        >
          {t("Créer")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("Nom")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Docs techniques du projet")} />
        </Field>
        <Field label={t("Description")}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
