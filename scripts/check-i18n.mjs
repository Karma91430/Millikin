// Check the English dictionaries: t("…") keys missing from src/i18n/en, and keys translated differently in two files.
// Usage: node scripts/check-i18n.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dictDir = path.join(root, "src/i18n/en");
const entry = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\p{L}_$][\p{L}\p{N}_$]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gmu;
const unquote = (s) => (/^["']/.test(s) ? JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s) : s);

const known = new Map();
let conflicts = 0;
for (const f of fs.readdirSync(dictDir).filter((x) => x !== "index.ts")) {
  for (const m of fs.readFileSync(path.join(dictDir, f), "utf8").matchAll(entry)) {
    const [k, v] = [unquote(m[1]), unquote(m[2])];
    if (known.has(k) && known.get(k).v !== v) {
      conflicts++;
      console.log(`conflict ${JSON.stringify(k)}: ${known.get(k).f}=${JSON.stringify(known.get(k).v)} vs ${f}=${JSON.stringify(v)}`);
    } else known.set(k, { v, f });
  }
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(path.join(root, "src/components"));

const missing = new Map();
for (const f of files)
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\b(?:t|tr)\(\s*("(?:[^"\\]|\\.)*")/g)) {
    const k = JSON.parse(m[1]);
    if (!known.has(k)) missing.set(k, path.relative(root, f));
  }
for (const [k, f] of missing) console.log(`missing ${JSON.stringify(k)} (${f})`);
console.log(`${known.size} keys · ${missing.size} missing · ${conflicts} conflicts`);
process.exit(missing.size || conflicts ? 1 : 0);
