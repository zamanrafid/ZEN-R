export function ZoroLogo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/40 to-fuchsia-500/40 blur-md" />
        <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ZORO AI logo" className="relative">
          <defs>
            <linearGradient id="zg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#60A5FA" />
              <stop offset="0.55" stopColor="#8B5CF6" />
              <stop offset="1" stopColor="#E879F9" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="60" height="60" rx="14" fill="#0d1426" stroke="url(#zg)" strokeWidth="2.5" />
          <path d="M18 20 H46 L28 32 H44" fill="none" stroke="url(#zg)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 44 H44" stroke="url(#zg)" strokeWidth="6" strokeLinecap="round" />
          <circle cx="46" cy="42" r="3.4" fill="#E879F9" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-extrabold tracking-wide">
          ZORO <span className="grad-text">AI</span>
        </span>
        <span className="block text-[11px] text-muted">One Prompt. Consistent Characters. Cinematic Videos.</span>
      </span>
    </span>
  );
}

const DOT: Record<string, string> = {
  succeeded: "bg-emerald-400",
  processing: "bg-blue-400 animate-pulse",
  queued: "bg-amber-400 animate-pulse",
  failed: "bg-red-400",
  cancelled: "bg-slate-500",
  approved: "bg-emerald-400",
  "needs approval": "bg-amber-400"
};

export function StatusBadge({ status }: { status: string }) {
  const base = status.toLowerCase();
  const color =
    base.includes("succeed") || base.includes("approv") || base.includes("ready") || base.includes("free)")
      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
      : base.includes("fail")
        ? "border-red-500/40 text-red-300 bg-red-500/10"
        : base.includes("process") || base.includes("doing") || base.includes("render") || base.includes("running")
          ? "border-blue-500/40 text-blue-300 bg-blue-500/10"
          : base.includes("cancel")
            ? "border-slate-500/40 text-slate-300 bg-slate-500/10"
            : "border-amber-500/40 text-amber-300 bg-amber-500/10";
  const dot = DOT[base] ?? DOT[base.split(" ")[0]] ?? "bg-amber-400";
  return (
    <span className={`badge ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

export function SectionHead({
  num,
  title,
  hint
}: {
  num: string;
  title: string;
  hint?: string;
}) {
  return (
    <div>
      <h2 className="section-title">
        <span className="section-num">{num}</span>
        {title}
      </h2>
      {hint && <p className="mt-1.5 pl-[38px] text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center">
      <p className="font-semibold text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-300">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
      {label ?? "Working…"}
    </span>
  );
}
