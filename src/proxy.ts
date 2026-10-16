// Authentication in front of every request. It verifies the session and passes the user on to the
// route handlers in a header it always overwrites (clients cannot set it); permissions are then
// checked in the routes. While no account exists Millikin stays single-user and local-only.
import { NextResponse, type NextRequest } from "next/server";
import { hasUsers, SESSION_COOKIE, USER_HEADER, userFromSession } from "@/lib/access";
import { getSettings } from "@/lib/db";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PUBLIC_API = ["/api/auth/"];
// The OpenAI-compatible proxy is used by other tools (no browser session): it has its own key.

const deny = (req: NextRequest, status: number, message: string) =>
  req.nextUrl.pathname.startsWith("/api/") ? NextResponse.json({ error: message }, { status }) : new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Hostname the browser asked for. It is a client header, so this check only gives a clear message to
  // network users when access is off: the real boundary is the binding (127.0.0.1 unless dev:lan, which
  // requires an admin account, so every network request needs a valid session anyway).
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const local = LOCAL_HOSTS.has(host || req.nextUrl.hostname);
  const users = hasUsers();

  // Other machines only when allowed, and never before an admin account exists.
  if (!local && (!users || getSettings().network_access !== "on")) {
    return deny(req, 403, users ? "Accès réseau désactivé : active-le dans Réglages → Accès sur la machine Millikin." : "Crée d'abord le compte administrateur depuis la machine Millikin.");
  }

  const headers = new Headers(req.headers);
  headers.delete(USER_HEADER);
  if (!users || PUBLIC_API.some((p) => path.startsWith(p))) return NextResponse.next({ request: { headers } });
  if (path.startsWith("/api/v1/")) {
    if (!local && !getSettings().proxy_key) return deny(req, 403, "Proxy API : définis une clé dans Réglages pour l'utiliser depuis le réseau");
    return NextResponse.next({ request: { headers } });
  }

  const user = userFromSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    // The page itself loads and shows the login screen; data needs a session.
    if (!path.startsWith("/api/")) return NextResponse.next({ request: { headers } });
    return deny(req, 401, "Connexion requise");
  }
  if (path.startsWith("/api/admin/") && user.role !== "admin") return deny(req, 403, "Réservé aux administrateurs");
  headers.set(USER_HEADER, user.id);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
