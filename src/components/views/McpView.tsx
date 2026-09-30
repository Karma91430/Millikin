"use client";

import { CheckCircle2, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { api, crud, useData, type McpServer } from "../api";
import { Badge, Button, Card, cx, Empty, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "../ui";

const PRESETS: { label: string; hint: string; server: Partial<McpServer> }[] = [
  {
    label: "Fichiers",
    hint: "Lire/écrire dans un dossier choisi",
    server: { name: "filesystem", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/moi/Projets"] },
  },
  { label: "Git", hint: "Historique, diff, commits d'un dépôt", server: { name: "git", transport: "stdio", command: "uvx", args: ["mcp-server-git", "--repository", "/Users/moi/Projets/mon-repo"] } },
  { label: "Playwright", hint: "Piloter un navigateur", server: { name: "playwright", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] } },
  { label: "Mémoire", hint: "Graphe de connaissances persistant", server: { name: "memory", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
  { label: "Fetch", hint: "Lire des pages web en Markdown", server: { name: "fetch", transport: "stdio", command: "uvx", args: ["mcp-server-fetch"] } },
  {
    label: "GitHub",
    hint: "Issues, PR, dépôts (jeton requis)",
    server: { name: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer <ton-token-github>" } },
  },
];

const toLines = (o: Record<string, string> = {}) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
const fromLines = (s: string) =>
  Object.fromEntries(
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
const headerLines = (o: Record<string, string> = {}) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
const fromHeaderLines = (s: string) =>
  Object.fromEntries(
    s
      .split("\n")
      .filter((l) => l.includes(":"))
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );

export function McpView() {
  const servers = useData<McpServer[]>("/api/crud/mcp");
  const [cur, setCur] = useState<Partial<McpServer> | null>(null);
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Serveurs MCP"
        subtitle="Branche des outils externes (fichiers, Git, navigateur, GitHub, Jira…) et attache-les aux agents qui en ont besoin."
        actions={
          <Button variant="primary" onClick={() => setCur({ name: "", transport: "stdio", command: "", args: [], env: {}, url: "", headers: {}, enabled: true })}>
            <Plus size={15} /> Nouveau serveur
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2">
          {(servers.data ?? []).map((s) => (
            <Card key={s.id} onClick={() => setCur(s)} className={cx("p-3", cur?.id === s.id && "border-accent")}>
              <div className="flex items-center gap-2">
                <span className={cx("h-2 w-2 rounded-full", s.enabled ? "bg-emerald-400" : "bg-fg-subtle")} />
                <span className="text-sm font-medium">{s.name}</span>
                <Badge className="ml-auto">{s.transport}</Badge>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : s.url}</div>
            </Card>
          ))}
          <div className="mt-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Modèles</div>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setCur({ args: [], env: {}, headers: {}, url: "", command: "", enabled: true, ...p.server })}
              className="rounded-lg border border-dashed border-line px-3 py-2 text-left hover:border-line-strong"
            >
              <div className="text-sm">{p.label}</div>
              <div className="text-[11px] text-fg-subtle">{p.hint}</div>
            </button>
          ))}
        </div>
        {cur ? (
          <McpEditor key={cur.id ?? `new-${cur.name}`} initial={cur} onSaved={(s) => (setCur(s), servers.reload())} onDeleted={() => (setCur(null), servers.reload())} />
        ) : (
          <Empty icon={<Plug size={28} />} title="Aucun serveur sélectionné">
            Part d&apos;un modèle à gauche ou crée un serveur. Les serveurs stdio sont lancés localement (npx, uvx, docker…).
          </Empty>
        )}
      </div>
    </div>
  );
}

function McpEditor({ initial, onSaved, onDeleted }: { initial: Partial<McpServer>; onSaved: (s: McpServer) => void; onDeleted: () => void }) {
  const [s, setS] = useState(initial);
  const [args, setArgs] = useState((initial.args ?? []).join("\n"));
  const [env, setEnv] = useState(toLines(initial.env));
  const [headers, setHeaders] = useState(headerLines(initial.headers));
  const [test, setTest] = useState<{ ok: boolean; tools?: { name: string; description: string }[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const payload = (): Partial<McpServer> => ({
    ...s,
    args: args
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean),
    env: fromLines(env),
    headers: fromHeaderLines(headers),
  });

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <ErrorNote>{error}</ErrorNote>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <Field label="Nom" hint="Préfixe des outils côté agent (ex : github__create_issue).">
          <Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </Field>
        <Field label="Transport">
          <Select value={s.transport} onChange={(e) => setS({ ...s, transport: e.target.value as McpServer["transport"] })}>
            <option value="stdio">stdio (local)</option>
            <option value="http">HTTP streamable</option>
            <option value="sse">SSE (ancien)</option>
          </Select>
        </Field>
      </div>
      {s.transport === "stdio" ? (
        <>
          <Field label="Commande">
            <Input className="font-mono" value={s.command} onChange={(e) => setS({ ...s, command: e.target.value })} placeholder="npx" />
          </Field>
          <Field label="Arguments (un par ligne)">
            <Textarea rows={4} className="font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <Field label="Variables d'environnement (CLE=valeur, une par ligne)">
            <Textarea rows={3} className="font-mono text-xs" value={env} onChange={(e) => setEnv(e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL">
            <Input className="font-mono" value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} placeholder="https://…/mcp" />
          </Field>
          <Field label="En-têtes (Nom: valeur, un par ligne)">
            <Textarea rows={3} className="font-mono text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </Field>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="accent-[var(--accent)]" />
        Activé
      </label>

      <div className="flex flex-wrap gap-2">
        {s.id && (
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm(`Supprimer le serveur « ${s.name} » ?`)) return;
              await crud.remove("mcp", s.id!);
              onDeleted();
            }}
          >
            <Trash2 size={14} />
          </Button>
        )}
        <div className="flex-1" />
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setTest(null);
            setTest(
              await api<{ ok: boolean; tools?: { name: string; description: string }[]; error?: string }>("/api/mcp/test", { method: "POST", json: payload() }).catch((e) => ({
                ok: false,
                error: String(e.message ?? e),
              })),
            );
            setBusy(false);
          }}
        >
          {busy ? "Connexion…" : "Tester"}
        </Button>
        <Button
          variant="primary"
          onClick={async () => {
            if (!s.name?.trim()) return setError("Le nom est obligatoire");
            try {
              onSaved(await crud.save<McpServer>("mcp", payload()));
              setError(undefined);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Enregistrer
        </Button>
      </div>

      {test && (
        <div className={cx("rounded-lg border p-3 text-sm", test.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            {test.ok ? <CheckCircle2 size={15} className="text-emerald-400" /> : <XCircle size={15} className="text-red-400" />}
            {test.ok ? `Connecté · ${test.tools?.length} outil(s)` : "Échec de connexion"}
          </div>
          {test.error && <pre className="whitespace-pre-wrap text-xs text-red-300">{test.error}</pre>}
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {test.tools?.map((t) => (
              <div key={t.name} className="text-xs">
                <span className="font-mono text-fg">{t.name}</span> <span className="text-fg-muted">— {t.description.slice(0, 140)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
