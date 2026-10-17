// Project map: a compact view of the project's files (path, size, what each one contains), built from the
// files themselves without any model call. Given to every agent working on a ticket so it does not have to
// rediscover the project with list_files and a dozen reads at each attempt.
import fs from "node:fs/promises";
import path from "node:path";

const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", "venv", "env", "__pycache__", ".DS_Store", "coverage", "htmlcov", ".idea", ".vscode", ".millikin"]);

/** Folders and files that are tooling, caches or environments, never project content. */
export const isIgnoredEntry = (name: string) =>
  IGNORED.has(name) ||
  name.startsWith(".venv") ||
  name.endsWith(".egg-info") ||
  /^\.(pytest|ruff|mypy|tox|nox|parcel|turbo|cache|coverage)/.test(name) ||
  name === ".coverage" ||
  name.endsWith(".pyc");

const TEXT = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".json", ".toml", ".yaml", ".yml", ".txt", ".sql", ".sh", ".html", ".css", ".csv", ".ini", ".cfg", ".env", ".example"]);

/** Every project file (relative paths), tooling and caches excluded. */
export async function listProjectFiles(root: string, dir = root, out: string[] = [], limit = 2000): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= limit) break;
    if (isIgnoredEntry(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listProjectFiles(root, full, out, limit);
    else out.push(path.relative(root, full));
  }
  return out;
}

/** One line on what a file holds: its title or docstring and its main definitions. */
function describe(file: string, text: string): string {
  const ext = path.extname(file).toLowerCase();
  const first = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (ext === ".md") return first(text.match(/^#+\s+(.+)$/m)?.[1]);
  if (ext === ".py") {
    const doc = first(text.match(/^\s*(?:"""|''')\s*([^\n]+)/)?.[1]).replace(/"""$/, "");
    if (/(^|\/)test_[^/]*\.py$/.test(file)) {
      const n = (text.match(/^\s*(?:async\s+)?def\s+test_/gm) ?? []).length;
      return [doc, `${n} test(s)`].filter(Boolean).join(" · ");
    }
    const defs = [...text.matchAll(/^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/gm)].map((m) => m[2]).filter((n) => !n.startsWith("_") || n.startsWith("__init"));
    return [doc, defs.length ? defs.slice(0, 6).join(", ") + (defs.length > 6 ? "…" : "") : ""].filter(Boolean).join(" · ");
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const doc = first(text.match(/^\s*(?:\/\/|\/\*\*?)\s*([^\n*]+)/)?.[1]);
    const exp = [...text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
    return [doc, exp.length ? exp.slice(0, 8).join(", ") + (exp.length > 8 ? "…" : "") : ""].filter(Boolean).join(" · ");
  }
  if (ext === ".json") {
    try {
      const j = JSON.parse(text) as unknown;
      return Array.isArray(j) ? `tableau de ${j.length} éléments` : `clés : ${Object.keys(j as object).slice(0, 6).join(", ")}`;
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * The map, grouped by folder, within `maxChars`. Big folders of similar files (fixtures, data) are summarised
 * as a count so the code and documents stay visible.
 */
export async function projectMap(root: string, maxChars = 6000): Promise<string> {
  const files = await listProjectFiles(root);
  if (!files.length) return "";
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = path.dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  const out: string[] = [];
  let size = 0;
  // Code first, then the root and other folders, then documentation, scripts and tests.
  const rank = (d: string) => (/^(src|app|lib|packages?|server|client|api)(\/|$)/.test(d) ? 0 : d === "." ? 1 : /^(docs?|scripts?|tests?|spec|fixtures?)(\/|$)/.test(d) ? 3 : 2);
  for (const [dir, list] of [...byDir].sort(([a], [b]) => rank(a) - rank(b) || a.split("/").length - b.split("/").length || a.localeCompare(b))) {
    const lines: string[] = [`${dir === "." ? "(racine)" : `${dir}/`}`];
    const shown = list.length > 15 ? list.slice(0, 6) : list;
    for (const f of shown) {
      const ext = path.extname(f).toLowerCase();
      let info = "";
      if (TEXT.has(ext) || !ext) {
        const stat = await fs.stat(path.join(root, f)).catch(() => null);
        if (stat && stat.size < 400_000) {
          const text = await fs.readFile(path.join(root, f), "utf8").catch(() => "");
          const what = describe(f, text);
          info = ` (${text.split("\n").length} l.)${what ? ` : ${what}` : ""}`;
        }
      }
      lines.push(`  ${path.basename(f)}${info}`.slice(0, 170));
    }
    if (shown.length < list.length) lines.push(`  … et ${list.length - shown.length} autre(s) fichier(s)`);
    const block = lines.join("\n");
    if (size + block.length > maxChars) {
      out.push(`… (${byDir.size - out.length} dossier(s) non détaillés : list_files pour les voir)`);
      break;
    }
    out.push(block);
    size += block.length + 1;
  }
  return out.join("\n");
}
