export interface StylePreset {
  readonly name: string;
  readonly fontFamily: string | null;
  readonly accentHue: number;
  readonly accentSaturation: number;
}

export const FONT_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: string | null; readonly preview: string }> = [
  { label: "默认", value: null, preview: "系统字体" },
  { label: "快乐体", value: '"ZCOOL KuaiLe", sans-serif', preview: "圆润可爱" },
  { label: "黄油体", value: '"ZCOOL QingKe HuangYou", sans-serif', preview: "独特个性" },
  { label: "小薇体", value: '"ZCOOL XiaoWei", sans-serif', preview: "优雅精致" },
  { label: "手写体", value: '"Ma Shan Zheng", serif', preview: "文艺手写" },
  { label: "宋体", value: '"Noto Serif SC Variable", serif', preview: "经典衬线" },
  { label: "黑体", value: '"Noto Sans SC Variable", sans-serif', preview: "现代无衬线" },
];

export const COLOR_PRESETS: ReadonlyArray<StylePreset> = [
  { name: "玫瑰", fontFamily: null, accentHue: 16, accentSaturation: 12 },
  { name: "樱花", fontFamily: null, accentHue: 340, accentSaturation: 15 },
  { name: "薄荷", fontFamily: null, accentHue: 160, accentSaturation: 14 },
  { name: "星空", fontFamily: null, accentHue: 260, accentSaturation: 16 },
  { name: "琥珀", fontFamily: null, accentHue: 50, accentSaturation: 14 },
  { name: "海洋", fontFamily: null, accentHue: 220, accentSaturation: 15 },
  { name: "森林", fontFamily: null, accentHue: 130, accentSaturation: 12 },
];

export const DEFAULT_HUE = 16;
export const DEFAULT_SATURATION = 12;
