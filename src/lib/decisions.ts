// Project decision log (docs/DECISIONS.md in the project folder), shared with every agent of the project.
import fs from "node:fs/promises";
import path from "node:path";

export const DECISIONS_FILE = "docs/DECISIONS.md";
const HEADER = "# Journal des décisions\n\nDécisions prises sur le projet (cadrage validé, choix techniques, contrôles des tâches). Tenu à jour par Millikin et les premiers contacts.\n";

export async function appendDecision(workspace: string, title: string, body: string, by: string) {
  const file = path.join(workspace, DECISIONS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const exists = await fs.stat(file).then(() => true, () => false);
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const entry = `\n## ${date} — ${title}\n_par ${by}_\n\n${body.trim()}\n`;
  await fs.appendFile(file, (exists ? "" : HEADER) + entry, "utf8");
}

/** Most recent part of the log (entries are appended, so the tail is the freshest). */
export async function readDecisions(workspace: string, maxChars = 4000): Promise<string> {
  const text = await fs.readFile(path.join(workspace, DECISIONS_FILE), "utf8").catch(() => "");
  if (!text.trim()) return "";
  return text.length > maxChars ? "…\n" + text.slice(-maxChars) : text;
}
