"use client";

import { FileText, Library, Plus, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api, crud, useData, type Kb } from "../api";
import { Button, Card, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Textarea } from "../ui";

type Doc = { id: string; name: string; chars: number; chunks: number; created_at: number };
type Hit = { text: string; doc: string; kb: string; score: number };

export function KnowledgeView() {
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const [sel, setSel] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const kb = kbs.data?.find((k) => k.id === sel) ?? kbs.data?.[0];
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Connaissances"
        subtitle="RAG interne : tes documents sont découpés et indexés avec un modèle d'embedding local, puis servis aux agents."
        actions={
          <Button variant="primary" onClick={() => setCreate(true)}>
            <Plus size={15} /> Nouvelle base
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-[260px_1fr]">
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
          <Empty icon={<Library size={28} />} title="Aucune base de connaissances">
            Crée une base, importe des documents (texte, Markdown, code, PDF), puis attache-la à un agent.
          </Empty>
        )}
      </div>
      <CreateKb open={create} onClose={() => setCreate(false)} onCreated={(id) => (setSel(id), kbs.reload())} />
    </div>
  );
}

function KbDetail({ kb, onDeleted }: { kb: Kb; onDeleted: () => void }) {
  const docs = useData<Doc[]>(`/api/kb?kbId=${kb.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [paste, setPaste] = useState({ name: "", text: "" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const fd = new FormData();
    fd.set("kbId", kb.id);
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
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (!confirm(`Supprimer la base « ${kb.name} » et tous ses documents ?`)) return;
            await crud.remove("kbs", kb.id);
            onDeleted();
          }}
        >
          <Trash2 size={13} /> Supprimer la base
        </Button>
      </div>
      <ErrorNote>{error && <pre className="whitespace-pre-wrap font-sans">{error}</pre>}</ErrorNote>

      <div
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        className={cx(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition",
          drag ? "border-accent bg-accent/5" : "border-line hover:border-line-strong",
        )}
      >
        <Upload size={20} className="text-fg-muted" />
        <div className="text-sm">{busy ? "Indexation en cours…" : "Dépose des fichiers ou clique pour choisir"}</div>
        <div className="text-xs text-fg-subtle">.txt .md .pdf .json .csv, code source…</div>
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

      <Card className="flex flex-col gap-2 p-3">
        <div className="text-sm font-medium">Coller du texte</div>
        <Input placeholder="Titre du document" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} />
        <Textarea rows={4} placeholder="Contenu…" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            disabled={!paste.text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/kb", { method: "POST", json: { kbId: kb.id, name: paste.name, text: paste.text } });
                setPaste({ name: "", text: "" });
                docs.reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Indexer
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-line px-3 py-2 text-sm font-medium">Documents ({docs.data?.length ?? 0})</div>
        {(docs.data ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
            <FileText size={14} className="text-fg-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.name}</div>
              <div className="text-xs text-fg-subtle">
                {d.chunks} passages · {Math.round(d.chars / 1000)}k caractères
              </div>
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
        {!docs.data?.length && <div className="px-3 py-3 text-xs text-fg-subtle">Aucun document.</div>}
      </Card>

      <Card className="flex flex-col gap-2 p-3">
        <div className="text-sm font-medium">Tester la recherche</div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setHits(await api<Hit[]>("/api/kb/search", { method: "POST", json: { kbIds: [kb.id], query: q } }));
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pose une question…" />
          <Button type="submit" disabled={!q.trim()}>
            <Search size={14} />
          </Button>
        </form>
        {hits?.map((h, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-2.5 text-xs">
            <div className="mb-1 flex justify-between text-fg-subtle">
              <span>{h.doc}</span>
              <span>score {h.score.toFixed(3)}</span>
            </div>
            <div className="line-clamp-4 whitespace-pre-wrap text-fg-muted">{h.text}</div>
          </div>
        ))}
        {hits && !hits.length && <div className="text-xs text-fg-subtle">Aucun résultat.</div>}
      </Card>
    </div>
  );
}

function CreateKb({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle base de connaissances"
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
          Créer
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Docs techniques du projet" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
