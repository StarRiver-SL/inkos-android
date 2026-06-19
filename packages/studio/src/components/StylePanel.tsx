import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Palette } from "lucide-react";
import { FONT_OPTIONS, COLOR_PRESETS, DEFAULT_HUE, DEFAULT_SATURATION } from "../lib/style-presets";
import type { CustomStyle } from "../hooks/use-style";

interface StylePanelProps {
  readonly customStyle: CustomStyle;
  readonly setFontFamily: (family: string | null) => void;
  readonly setAccentColor: (hue: number, saturation?: number) => void;
  readonly resetStyle: () => void;
}

export function StylePanel({ customStyle, setFontFamily, setAccentColor, resetStyle }: StylePanelProps) {
  const [open, setOpen] = useState(false);

  const isDefaultFont = customStyle.fontFamily === null;
  const isDefaultColor = customStyle.accentHue === DEFAULT_HUE && customStyle.accentSaturation === DEFAULT_SATURATION;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="soft-pill flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        aria-label="自定义风格"
      >
        <Palette size={14} />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>自定义风格</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
          {/* Font Selection */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">字体风格</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {FONT_OPTIONS.map((font) => {
                const isActive = font.value === customStyle.fontFamily || (font.value === null && isDefaultFont);
                return (
                  <button
                    key={font.label}
                    onClick={() => setFontFamily(font.value)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 bg-card hover:border-primary/30 hover:bg-card/80"
                    }`}
                    style={{ fontFamily: font.value ?? undefined }}
                  >
                    <span className="text-xs font-medium">{font.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Selection */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">主题色彩</h3>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset) => {
                const isActive = customStyle.accentHue === preset.accentHue && customStyle.accentSaturation === preset.accentSaturation;
                return (
                  <button
                    key={preset.name}
                    onClick={() => setAccentColor(preset.accentHue, preset.accentSaturation)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 bg-card hover:border-primary/30"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: `oklch(0.65 ${preset.accentSaturation / 100} ${preset.accentHue})` }}
                    />
                    {preset.name}
                  </button>
                );
              })}
            </div>

            {/* Custom hue slider */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">自定义色相</span>
                <span className="text-[11px] font-mono text-muted-foreground">{customStyle.accentHue}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={customStyle.accentHue}
                onChange={(e) => setAccentColor(parseInt(e.target.value, 10))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right,
                    oklch(0.65 0.15 0),
                    oklch(0.65 0.15 60),
                    oklch(0.65 0.15 120),
                    oklch(0.65 0.15 180),
                    oklch(0.65 0.15 240),
                    oklch(0.65 0.15 300),
                    oklch(0.65 0.15 360)
                  )`,
                }}
              />
            </div>

            {/* Saturation slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">饱和度</span>
                <span className="text-[11px] font-mono text-muted-foreground">{customStyle.accentSaturation}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                value={customStyle.accentSaturation}
                onChange={(e) => setAccentColor(customStyle.accentHue, parseInt(e.target.value, 10))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right,
                    oklch(0.65 0 ${customStyle.accentHue}),
                    oklch(0.65 0.3 ${customStyle.accentHue})
                  )`,
                }}
              />
            </div>
          </div>

          {/* Reset */}
          {(!isDefaultFont || !isDefaultColor) && (
            <button
              onClick={resetStyle}
              className="sticky bottom-0 w-full shrink-0 rounded-xl border border-border/50 bg-card py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:text-destructive"
            >
              恢复默认风格
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
