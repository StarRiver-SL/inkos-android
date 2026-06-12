"use client";

import { cn } from "@/lib/utils";
import {
  memo,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

type MarkdownPreset = "cjk" | "full";

type StreamdownLikeProps = {
  children?: ReactNode;
  className?: string;
  isAnimating?: boolean;
  mode?: string;
  plugins?: Record<string, unknown>;
};

type LoadedMarkdown = {
  Streamdown: ComponentType<StreamdownLikeProps>;
  plugins: Record<string, unknown>;
};

const markdownCache = new Map<MarkdownPreset, Promise<LoadedMarkdown>>();

const loadMarkdown = (preset: MarkdownPreset): Promise<LoadedMarkdown> => {
  const cached = markdownCache.get(preset);
  if (cached) return cached;

  const loader =
    preset === "cjk"
      ? Promise.all([import("streamdown"), import("@streamdown/cjk")]).then(
          ([streamdown, cjkModule]) => ({
            Streamdown: streamdown.Streamdown as ComponentType<StreamdownLikeProps>,
            plugins: { cjk: cjkModule.cjk },
          })
        )
      : Promise.all([
          import("streamdown"),
          import("@streamdown/cjk"),
          import("@streamdown/code"),
          import("@streamdown/math"),
          import("@streamdown/mermaid"),
        ]).then(
          ([streamdown, cjkModule, codeModule, mathModule, mermaidModule]) => ({
            Streamdown: streamdown.Streamdown as ComponentType<StreamdownLikeProps>,
            plugins: {
              cjk: cjkModule.cjk,
              code: codeModule.code,
              math: mathModule.math,
              mermaid: mermaidModule.mermaid,
            },
          })
        );

  markdownCache.set(preset, loader);
  return loader;
};

export type MarkdownViewProps = Omit<StreamdownLikeProps, "plugins"> & {
  preset?: MarkdownPreset;
};

export const MarkdownView = memo(
  ({ children, className, preset = "full", ...props }: MarkdownViewProps) => {
    const [loaded, setLoaded] = useState<LoadedMarkdown | null>(null);

    useEffect(() => {
      let cancelled = false;
      setLoaded(null);

      void loadMarkdown(preset).then((next) => {
        if (!cancelled) setLoaded(next);
      });

      return () => {
        cancelled = true;
      };
    }, [preset]);

    if (!loaded) {
      return (
        <div className={cn("whitespace-pre-wrap", className)}>{children}</div>
      );
    }

    const { Streamdown, plugins } = loaded;

    return (
      <Streamdown className={className} plugins={plugins} {...props}>
        {children}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.mode === nextProps.mode &&
    prevProps.preset === nextProps.preset
);

MarkdownView.displayName = "MarkdownView";
