import { creditStatus, hasUsers, SESSION_COOKIE, userFromSession } from "@/lib/access";

/** Who is connected: setup mode (no account yet), the current user and their credits, or nobody (login needed). */
export async function GET(req: Request) {
  if (!hasUsers()) return Response.json({ setup: true, user: null });
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const user = userFromSession(token);
  if (!user) return Response.json({ setup: false, user: null }, { status: 401 });
  return Response.json({ setup: false, user, credits: creditStatus(user) });
}
