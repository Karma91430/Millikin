"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { EN } from "./en";

// The French text is the source and the key: t("Projets") shows "Projects" in English and falls
// back to French when a translation is missing, so untranslated strings never break the UI.
export type Lang = "fr" | "en";
export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: "fr", label: "Français", flag: "🇫🇷" },
  { id: "en", label: "English", flag: "🇬🇧" },
];

export type Vars = Record<string, string | number>;
const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);

export function translate(lang: Lang, fr: string, vars?: Vars) {
  return fill(lang === "en" ? (EN[fr] ?? fr) : fr, vars);
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (fr: string, vars?: Vars) => string };
const I18n = createContext<Ctx>({ lang: "fr", setLang: () => {}, t: (fr, vars) => fill(fr, vars) });

export function I18nProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
  const t = useCallback((fr: string, vars?: Vars) => translate(lang, fr, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

/** `const { t, lang } = useT();` then `t("Texte en français")` or `t("{n} tâche(s)", { n })`. */
export const useT = () => useContext(I18n);
