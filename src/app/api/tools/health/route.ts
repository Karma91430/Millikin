import { execFile } from "node:child_process";
import { getSettings, list, type Provider } from "@/lib/db";
import { ollamaBase } from "@/lib/gateway";

type Check = { ok: boolean; detail: string };

const run = (cmd: string, args: string[]) =>
  new Promise<Check>((resolve) =>
    execFile("/bin/zsh", ["-lc", [cmd, ...args].join(" ")], { timeout: 8000 }, (err, stdout, stderr) =>
      resolve(err ? { ok: false, detail: "introuvable" } : { ok: true, detail: (stdout || stderr).trim().split("\n")[0].slice(0, 80) }),
    ),
  );

async function probe(url: string, ok: (r: Response) => boolean | Promise<boolean>, label: (r: Response) => string): Promise<Check> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 Millikin" } });
    return (await ok(r)) ? { ok: true, detail: label(r) } : { ok: false, detail: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 80) : "injoignable" };
  }
}

/** Can the agent tools actually work on this machine? */
export async function GET() {
  const s = getSettings();
  const searx = s.searxng_url.replace(/\/+$/, "");
  const host = list<Provider>("providers").find((p) => p.enabled);
  const [searxng, fallback, ollama, node, python, git] = await Promise.all([
    probe(`${searx}/search?q=test&format=json`, async (r) => r.ok && !!(await r.json().catch(() => null)), () => searx),
    s.web_fallback === "off" ? Promise.resolve({ ok: false, detail: "désactivé" }) : probe("https://html.duckduckgo.com/html/?q=test", (r) => r.ok, () => "html.duckduckgo.com"),
    host ? probe(`${ollamaBase(host)}/api/version`, (r) => r.ok, () => host.name) : Promise.resolve({ ok: false, detail: "aucun hôte" }),
    run("node", ["--version"]),
    run("python3", ["--version"]),
    run("git", ["--version"]),
  ]);
  return Response.json({
    checks: { searxng, fallback, ollama, node, python, git },
    tools: {
      web_search: searxng.ok || fallback.ok,
      fetch_url: true,
      http_request: true,
      run_command: node.ok || python.ok || git.ok,
    },
  });
}
