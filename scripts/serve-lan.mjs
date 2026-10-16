// Start Millikin for the local network (bound to 0.0.0.0). Refuses unless an admin account exists and
// network access is enabled in Settings: every request from the network then needs a session.
// Usage: npm run dev:lan  |  npm run start:lan
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const mode = process.argv[2] === "start" ? "start" : "dev";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dbFile = path.join(root, "data", "millikin.db");
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!fs.existsSync(dbFile)) fail("Lance d'abord Millikin en local (npm run dev) et crée le compte administrateur.");
const db = new DatabaseSync(dbFile, { readOnly: true });
const admin = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get() && db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND active = 1 LIMIT 1").get();
if (!admin) fail("Aucun compte administrateur : crée-le d'abord en local (npm run dev), depuis cette machine.");
const network = db.prepare("SELECT value FROM settings WHERE key = 'network_access'").get();
if (network?.value !== "on") fail("L'accès réseau est désactivé : active-le dans Réglages → Accès, puis relance cette commande.");
db.close();

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => `http://${a.address}:3210`);
console.log(`\nMillikin sur le réseau local : ${addresses.join(", ") || "http://<ip>:3210"}\n`);
const child = spawn(path.join(root, "node_modules", ".bin", "next"), [mode, "-H", "0.0.0.0", "-p", "3210"], { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 0));
