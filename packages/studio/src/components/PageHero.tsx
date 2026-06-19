import type { ReactNode } from "react";

interface PageHeroProps {
  /** 英文标签（如 CHARACTERS、FORESHADOWING） */
  label: string;
  /** 页面标题 */
  title: string;
  /** 描述文字 */
  description?: string;
  /** 右侧操作按钮区域 */
  children?: ReactNode;
  /** 额外 className */
  className?: string;
}

export function PageHero({ label, title, description, children, className }: PageHeroProps) {
  return (
    <section
      className={`glass-panel relative overflow-hidden rounded-[2rem] md:rounded-[2.5rem] p-5 sm:p-10 shadow-3d${className ? ` ${className}` : ""}`}
    >
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 text-sm font-bold text-primary">
            <span>{label}</span>
          </div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground sm:text-5xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children && (
          <div className="flex flex-wrap gap-3">{children}</div>
        )}
      </div>

      {/* Decorative blurs */}
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-accent/5 blur-3xl" />
    </section>
  );
}
