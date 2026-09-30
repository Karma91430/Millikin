import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { get, type Project } from "@/lib/db";
import { workspaceFor } from "@/lib/tools";

const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".DS_Store"]);
type Entry = { path: string; dir: boolean; size: number; mtime: number };

async function walk(root: string, dir: string, out: Entry[]) {
  if (out.length > 2000) return;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (IGNORED.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    out.push({ path: path.relative(root, abs), dir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
    if (e.isDirectory()) await walk(root, abs, out);
  }
}

async function rootFor(projectId: string | null) {
  const project = projectId ? get<Project>("projects", projectId) : undefined;
  return workspaceFor(project?.name ?? null, project?.path);
}

/** Resolve a relative path inside the workspace (symlinks included), or null if it escapes. */
async function inside(root: string, rel: string) {
  const real = await fs.realpath(path.resolve(root, rel || ".")).catch(() => "");
  return real && (real === root || real.startsWith(root + path.sep)) ? real : null;
}

/** Read-only view of a project workspace: ?projectId=…[&file=relative/path]. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const root = await rootFor(sp.get("projectId"));
  const file = sp.get("file");
  if (file) {
    const abs = await inside(root, file);
    if (!abs) return Response.json({ error: "Chemin invalide" }, { status: 400 });
    const text = await fs.readFile(abs, "utf8");
    return Response.json({ path: file, absolute: abs, content: text.slice(0, 200_000) });
  }
  const entries: Entry[] = [];
  await walk(root, root, entries);
  return Response.json({ root, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) });
}

/** Open the workspace (or a file in it) in Finder or VS Code on this Mac. */
export async function POST(req: Request) {
  const { projectId, file, app } = (await req.json()) as { projectId?: string; file?: string; app: "finder" | "vscode" };
  const root = await rootFor(projectId ?? null);
  const target = await inside(root, file ?? "");
  if (!target) return Response.json({ error: "Chemin invalide" }, { status: 400 });
  // Fixed binaries and argument arrays only: no shell is involved.
  const [cmd, args] =
    app === "vscode" ? ["open", ["-a", "Visual Studio Code", target]] : file ? ["open", ["-R", target]] : ["open", [target]];
  return new Promise<Response>((resolve) =>
    execFile(cmd, args as string[], (err) => resolve(err ? Response.json({ error: err.message }, { status: 500 }) : Response.json({ ok: true }))),
  );
}
