import { list } from "@/lib/db";
import { BUILTIN_PROFILES, PROFILE_CATEGORIES, type Profile } from "@/lib/profiles";

/** Built-in profiles followed by the user's own (editable) profiles. */
export async function GET() {
  const custom = list<Omit<Profile, "builtin">>("profiles").map((p) => ({ ...p, builtin: false, category: p.category || "Mes profils" }));
  const categories = [...new Set(["Mes profils", ...PROFILE_CATEGORIES, ...custom.map((p) => p.category)])];
  return Response.json({ profiles: [...custom, ...BUILTIN_PROFILES], categories });
}
