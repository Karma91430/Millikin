import { NextResponse } from "next/server";
import { login, SESSION_COOKIE } from "@/lib/access";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as { email: string; password: string };
  try {
    const s = login(String(email ?? ""), String(password ?? ""));
    const res = NextResponse.json({ user: s.user });
    res.cookies.set(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: s.maxAge });
    return res;
  } catch (e) {
    // Same answer whether the e-mail exists or not, after a short delay against guessing.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
