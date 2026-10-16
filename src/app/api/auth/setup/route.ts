import { NextResponse, type NextRequest } from "next/server";
import { hasUsers, login, saveUser, SESSION_COOKIE } from "@/lib/access";

/** First launch with accounts: create the administrator (only possible while no account exists, from this machine). */
export async function POST(req: NextRequest) {
  if (hasUsers()) return NextResponse.json({ error: "Un compte administrateur existe déjà" }, { status: 409 });
  // Convenience check (the Host header comes from the client); the binding to 127.0.0.1 is what keeps this local.
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "") || req.nextUrl.hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return NextResponse.json({ error: "À faire depuis la machine Millikin" }, { status: 403 });
  const { email, name, password } = (await req.json()) as { email: string; name?: string; password: string };
  try {
    saveUser(null, { email, name: name ?? "", password, role: "admin", can_create_projects: true, can_manage_agents: true });
    const s = login(email, password);
    const res = NextResponse.json({ user: s.user });
    res.cookies.set(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: s.maxAge });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
