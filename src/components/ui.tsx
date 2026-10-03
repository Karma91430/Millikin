"use client";

import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/i18n";
import { useCallback, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft"; size?: "sm" | "md" };
export function Button({ variant = "soft", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-accent-strong",
        variant === "soft" && "border border-line bg-surface-2 text-fg hover:bg-surface-3",
        variant === "ghost" && "text-fg-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" && "border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-fg-subtle">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface-1 px-3 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, "h-9", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, "py-2 leading-relaxed", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, "h-9", p.className)} />;

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx("rounded-xl border border-line bg-surface-1", onClick && "cursor-pointer transition hover:border-line-strong hover:bg-surface-2", className)}>
      {children}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", !color && "bg-surface-3 text-fg-muted", className)}
      style={color ? { background: `${color}22`, color } : undefined}
    >
      {children}
    </span>
  );
}

export function Avatar({ emoji, color, size = 36 }: { emoji: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, fontSize: size * 0.5, background: `${color}26`, boxShadow: `inset 0 0 0 1.5px ${color}` }}
    >
      {emoji}
    </span>
  );
}

export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={cx("flex h-full w-full flex-col border-l border-line bg-surface-0 shadow-2xl", wide ? "max-w-3xl" : "max-w-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-base font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("Fermer")}>
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t } = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface-0 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="text-base font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("Fermer")}>
            <X size={16} />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pb-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Toggle chips for picking several items. */
export function Pick<T extends { id: string }>({
  items,
  value,
  onChange,
  render,
  empty,
}: {
  items: T[];
  value: string[];
  onChange: (v: string[]) => void;
  render: (item: T) => ReactNode;
  empty?: string;
}) {
  const { t } = useT();
  if (!items.length) return <div className="text-xs text-fg-subtle">{empty ?? t("Rien à sélectionner")}</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = value.includes(it.id);
        return (
          <button
            type="button"
            key={it.id}
            onClick={() => onChange(on ? value.filter((v) => v !== it.id) : [...value, it.id])}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition",
              on ? "border-accent bg-accent/15 text-fg" : "border-line bg-surface-1 text-fg-muted hover:border-line-strong",
            )}
          >
            {render(it)}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
    </div>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{children}</div>;
}

/** A boolean UI preference remembered in this browser (the app renders client-only, so localStorage is safe here). */
export function usePersistentFlag(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {}
      return !v;
    });
  }, [key]);
  return [value, toggle];
}
