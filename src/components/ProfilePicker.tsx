"use client";

import { FilePlus2, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useData, type Profile } from "./api";
import { Avatar, Badge, Button, cx, Input } from "./ui";

export type ProfilesData = { profiles: Profile[]; categories: string[] };

/** Filterable grid of profiles, shared by the picker modal and the Profiles tab. */
export function ProfileGrid({
  data,
  onPick,
  actions,
}: {
  data?: ProfilesData;
  onPick: (p: Profile) => void;
  actions?: (p: Profile) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const { t } = useT();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = useMemo(
    () =>
      (data?.profiles ?? []).filter(
        (p) => (!cat || p.category === cat) && (!q || norm(`${p.name} ${p.role} ${p.category}`).includes(norm(q))),
      ),
    [data, q, cat],
  );
  const cats = (data?.categories ?? []).filter((c) => data?.profiles.some((p) => p.category === c));
  const groups = cats.map((c) => [c, shown.filter((p) => p.category === c)] as const).filter(([, ps]) => ps.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <Input className="pl-8" placeholder={t("Rechercher un profil (ex : sécurité, SEO, data…)")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setCat(null)} className={cx("rounded-lg px-2.5 py-1 text-xs", !cat ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
            {t("Tous")}
          </button>
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c === cat ? null : c)} className={cx("rounded-lg px-2.5 py-1 text-xs", cat === c ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {groups.map(([c, ps]) => (
        <div key={c}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{c}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ps.map((p) => (
              <div
                key={p.id}
                onClick={() => onPick(p)}
                className="group flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-2.5 transition hover:border-line-strong hover:bg-surface-2"
              >
                <Avatar emoji={p.emoji} color={p.color} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {!p.builtin && <Badge color="#8b5cf6">{t("perso")}</Badge>}
                  </div>
                  <div className="line-clamp-2 text-xs text-fg-muted">{p.role}</div>
                </div>
                {actions && <div onClick={(e) => e.stopPropagation()}>{actions(p)}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <div className="py-8 text-center text-sm text-fg-subtle">{t("Aucun profil ne correspond.")}</div>}
    </div>
  );
}

/** Modal: start from a profile, a blank sheet, or an AI-generated profile. */
export function ProfilePicker({
  open,
  onClose,
  onPick,
  onBlank,
  onGenerate,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: Profile) => void;
  onBlank?: () => void;
  onGenerate?: () => void;
  title?: string;
}) {
  const data = useData<ProfilesData>(open ? "/api/profiles" : null);
  const { t } = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-surface-0 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="text-base font-semibold">{title ?? t("Nouvel agent")}</div>
            <div className="text-xs text-fg-muted">{t("Pars d'un profil : tout reste modifiable avant d'enregistrer.")}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("Fermer")}>
            <X size={16} />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {(onBlank || onGenerate) && (
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              {onBlank && (
                <button onClick={onBlank} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-left hover:border-line-strong">
                  <FilePlus2 size={20} className="text-fg-muted" />
                  <span>
                    <span className="block text-sm font-medium">{t("Fiche vierge")}</span>
                    <span className="block text-xs text-fg-muted">{t("Tout définir soi-même")}</span>
                  </span>
                </button>
              )}
              {onGenerate && (
                <button onClick={onGenerate} className="flex items-center gap-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-3 text-left hover:border-accent">
                  <Sparkles size={20} className="text-accent" />
                  <span>
                    <span className="block text-sm font-medium">{t("Générer avec l'IA")}</span>
                    <span className="block text-xs text-fg-muted">{t("Décris le rôle, le modèle local rédige le profil")}</span>
                  </span>
                </button>
              )}
            </div>
          )}
          <ProfileGrid data={data.data} onPick={onPick} />
        </div>
      </div>
    </div>
  );
}
