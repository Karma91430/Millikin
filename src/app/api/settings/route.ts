import { denied, guard } from "@/lib/access";
import { getSettings, setSettings } from "@/lib/db";

// Settings anyone may change (interface language); everything else is for admins.
const PERSONAL = new Set(["language"]);

export async function GET(req: Request) {
  try {
    const u = guard(req, "read");
    const s = getSettings();
    // Secrets stay with admins.
    return Response.json(!u || u.role === "admin" ? s : { ...s, proxy_key: s.proxy_key ? "••••••••" : "" });
  } catch (e) {
    return denied(e);
  }
}

export async function POST(req: Request) {
  try {
    const values = (await req.json()) as Record<string, string>;
    guard(req, Object.keys(values).every((k) => PERSONAL.has(k)) ? "read" : "admin");
    setSettings(values);
    return Response.json(getSettings());
  } catch (e) {
    return denied(e);
  }
}
