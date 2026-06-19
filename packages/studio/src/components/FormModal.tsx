import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface FormModalProps {
  /** 标题 */
  title: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 表单内容 */
  children: ReactNode;
  /** 底部按钮区域 */
  footer: ReactNode;
  /** 弹窗最大宽度，默认 max-w-md */
  maxWidth?: string;
}

export function FormModal({ title, onClose, children, footer, maxWidth = "max-w-md" }: FormModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-xl fade-in"
      onClick={() => onClose()}
    >
      <div
        className={`glass-panel w-full ${maxWidth} overflow-hidden rounded-[2.5rem] shadow-3d`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 md:px-8 py-6">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="soft-pill flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 md:p-8 space-y-6">
          {children}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-border/40 bg-muted/20 px-5 md:px-8 py-6">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
