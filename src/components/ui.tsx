import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-orange text-navy hover:bg-orange-600",
        variant === "secondary" && "border border-line bg-white text-navy hover:bg-surface",
        variant === "ghost" && "text-navy hover:bg-surface",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
    />
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-navy placeholder:text-muted/70 focus:border-navy-700 focus:outline-none";

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(control, p.className)} />;
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(control, p.className)} />;
}

export function Card({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-white p-5", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-navy">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "brand" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface text-muted",
        tone === "success" && "bg-green-50 text-green-800",
        tone === "warning" && "bg-amber-50 text-amber-800",
        tone === "danger" && "bg-red-50 text-red-800",
        tone === "brand" && "bg-orange/15 text-orange-text",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3 py-2 text-sm",
        tone === "info" && "border-navy-700/20 bg-navy/5 text-navy",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "success" && "border-green-200 bg-green-50 text-green-800",
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export const ROLE_LABEL: Record<string, string> = { org_admin: "Administrador", manager: "Gestor", rep: "Vendedor" };
export const JOB_LABEL: Record<string, string> = { sdr: "SDR", closer: "Closer", manager: "Gestão", other: "Outro" };
