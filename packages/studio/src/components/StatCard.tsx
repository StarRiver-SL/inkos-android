interface StatCardProps {
  /** 数值 */
  value: string | number;
  /** 标签 */
  label: string;
  /** 数值文字颜色（Tailwind class），默认 text-foreground */
  valueClassName?: string;
  /** 额外 className */
  className?: string;
}

export function StatCard({ value, label, valueClassName = "text-foreground", className }: StatCardProps) {
  return (
    <div
      className={`paper-sheet flex flex-col items-center justify-center rounded-3xl p-5 text-center transition-all hover:-translate-y-1${className ? ` ${className}` : ""}`}
    >
      <div className={`text-3xl font-serif font-bold ${valueClassName}`}>{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</div>
    </div>
  );
}
