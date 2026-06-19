import { useState, useEffect, useCallback } from "react";
import { useApi, postApi, fetchJson } from "../hooks/use-api";
import { appAlert } from "../lib/app-dialog";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { PageHero } from "../components/PageHero";
import {
  Clock,
  AlertTriangle,
  RefreshCw,
  Hash,
  Calendar,
  Users,
  ArrowRight,
  ChevronLeft,
  Search,
  Sparkles,
  Calculator,
  Eye,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from "lucide-react";

interface TimelineAnchor {
  readonly chapter: number;
  readonly timeDescription: string;
  readonly parsedDate?: string;
  readonly charactersPresent: string[];
  readonly eventSummary: string;
  readonly position?: number;
  readonly contextParagraph?: string;
}

interface TimelineData {
  readonly bookId: string;
  readonly anchors: TimelineAnchor[];
  readonly lastRebuilt?: string;
}

interface ValidationIssue {
  readonly chapter: number;
  readonly issue: string;
}

interface Nav {
  toBookSettings: (id: string) => void;
  toChapter: (bookId: string, chapterNumber: number) => void;
}

export function TimelinePage({ bookId, nav, theme: _theme, t }: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const { data, loading, error, refetch } = useApi<TimelineData>(`/books/${bookId}/timeline`);
  const [rebuilding, setRebuilding] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [calcA, setCalcA] = useState<number>(-1);
  const [calcB, setCalcB] = useState<number>(-1);
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null);
  const isZh = t("analytics.title") !== "Analytics";

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await postApi(`/books/${bookId}/timeline/rebuild`);
      refetch();
    } catch (error) {
      await appAlert({ title: "重建失败", message: `时间线重建失败：${error instanceof Error ? error.message : "未知错误"}` });
    } finally {
      setRebuilding(false);
    }
  };

  const handleValidate = useCallback(async () => {
    try {
      const result = await fetchJson<{ issues: ValidationIssue[] }>(`/books/${bookId}/timeline/validate`);
      setIssues(result?.issues ?? []);
    } catch (error) {
      await appAlert({ title: "校验失败", message: `时间线校验失败：${error instanceof Error ? error.message : "未知错误"}` });
    }
  }, [bookId]);

  useEffect(() => { handleValidate(); }, [handleValidate]);

  const anchors = data?.anchors ?? [];

  // Calculator: find two selected anchors
  const anchorA = calcA >= 0 ? anchors[calcA] : null;
  const anchorB = calcB >= 0 ? anchors[calcB] : null;

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <div className="w-10 h-10 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm font-medium text-muted-foreground animate-pulse">正在梳理时空脉络...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 fade-in">
      {/* Navigation */}
      <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <button onClick={() => nav.toBookSettings(bookId)} className="flex items-center gap-1.5 transition-colors hover:text-primary">
          <ChevronLeft size={14} />
          <span>书籍设置</span>
        </button>
        <span className="text-border/60">/</span>
        <span className="text-foreground">时间线计算器</span>
      </nav>

      {/* Hero Section */}
      <PageHero
        label="CHRONOLOGY & LOGIC"
        title="时间线计算器"
        description="把控故事的时空跨度。精准捕捉每一个章节的时间锚点，自动计算情节间隔，严谨校验逻辑漏洞，让你的世界观坚不可摧。"
      >
        <button
          onClick={handleValidate}
          className="soft-pill inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-bold text-foreground transition-all hover:border-primary/40 active:scale-95"
        >
          <AlertTriangle size={18} className="text-amber-500" />
          一致性检查
        </button>
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw size={18} className={rebuilding ? "animate-spin" : ""} />
          {rebuilding ? "正在重建脉络..." : "重建时间线"}
        </button>
      </PageHero>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        {/* Sidebar / Calculator */}
        <aside className="lg:col-span-1 space-y-6">
           <div className="paper-sheet rounded-[2rem] p-6 space-y-5">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                 <Calculator size={14} className="text-primary" />
                 间隔计算器
              </h3>
              
              {anchorA && anchorB ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-left-2">
                   <div className="space-y-3">
                      <div className="rounded-2xl bg-secondary/40 p-4 border border-border/30">
                         <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">起点章节</div>
                         <div className="text-sm font-bold text-foreground">第 {anchorA.chapter} 章</div>
                         <div className="text-xs text-muted-foreground truncate">{anchorA.parsedDate || anchorA.timeDescription}</div>
                      </div>
                      <div className="flex justify-center -my-2 relative z-10">
                         <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
                            <ArrowRight size={14} className="rotate-90" />
                         </div>
                      </div>
                      <div className="rounded-2xl bg-secondary/40 p-4 border border-border/30">
                         <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">终点章节</div>
                         <div className="text-sm font-bold text-foreground">第 {anchorB.chapter} 章</div>
                         <div className="text-xs text-muted-foreground truncate">{anchorB.parsedDate || anchorB.timeDescription}</div>
                      </div>
                   </div>
                   
                   <div className="rounded-2xl bg-primary/5 p-4 border border-primary/20 text-center">
                      <div className="text-[10px] font-bold text-primary uppercase mb-1">推算间隔</div>
                      <div className="text-xl font-serif font-bold text-foreground">
                         跨越 {Math.abs(anchorB.chapter - anchorA.chapter)} 个章节
                      </div>
                      {(() => {
                        // Try to compute a more precise time gap
                        const parseYear = (d: string) => {
                          const m = d.match(/第(\d+)年/);
                          return m ? parseInt(m[1]) : null;
                        };
                        const parseDate = (d: string) => {
                          const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
                          return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : null;
                        };
                        const aDate = anchorA.parsedDate;
                        const bDate = anchorB.parsedDate;
                        if (aDate && bDate) {
                          const aYear = parseYear(aDate);
                          const bYear = parseYear(bDate);
                          if (aYear !== null && bYear !== null) {
                            const diff = Math.abs(bYear - aYear);
                            if (diff > 0) return <p className="mt-1 text-xs text-primary/80 font-medium">约 {diff} 年</p>;
                          }
                          const aD = parseDate(aDate);
                          const bD = parseDate(bDate);
                          if (aD && bD) {
                            const days = Math.abs(Math.round((bD.getTime() - aD.getTime()) / 86400000));
                            if (days > 30) return <p className="mt-1 text-xs text-primary/80 font-medium">约 {Math.round(days / 30)} 个月（{days} 天）</p>;
                            if (days > 0) return <p className="mt-1 text-xs text-primary/80 font-medium">{days} 天</p>;
                          }
                        }
                        return <p className="mt-1 text-[10px] text-muted-foreground leading-tight px-2">选择具有日期信息的节点可获得精确间隔</p>;
                      })()}
                   </div>
                   
                   <button 
                     onClick={() => { setCalcA(-1); setCalcB(-1); }}
                     className="w-full h-10 rounded-xl bg-secondary text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                   >
                     重置计算器
                   </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                   <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground mb-4">
                      <Hash size={24} />
                   </div>
                   <p className="text-xs text-muted-foreground leading-relaxed">
                     点击右侧时间线上的任意两个节点，即可计算它们之间的章节跨度与逻辑间隔。
                   </p>
                </div>
              )}
           </div>

           {/* Validation Issues Sidebar */}
           {issues.length > 0 && (
             <div className="glass-panel rounded-[2rem] p-6 border-l-4 border-l-destructive shadow-lg">
                <h3 className="text-sm font-bold text-destructive mb-4 flex items-center gap-2">
                   <AlertTriangle size={16} />
                   检测到逻辑冲突 ({issues.length})
                </h3>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                   {issues.map((issue, i) => (
                     <div key={i} className="space-y-1">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase">第 {issue.chapter} 章</div>
                        <p className="text-xs font-medium text-foreground leading-relaxed">{issue.issue}</p>
                     </div>
                   ))}
                </div>
             </div>
           )}
        </aside>

        {/* Timeline Visualization */}
        <div className="lg:col-span-3 space-y-6">
           <h2 className="flex items-center gap-2 text-xl font-bold text-foreground ml-2">
             <Search size={20} className="text-primary" />
             时空节点全览
           </h2>

           {anchors.length === 0 ? (
             <div className="paper-sheet flex flex-col items-center justify-center rounded-[3rem] py-24 text-center">
                <div className="relative mb-6 h-20 w-20 flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                   <Clock size={40} />
                </div>
                <h3 className="text-xl font-bold text-foreground">静止的时光</h3>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
                  目前尚未提取任何时间节点。点击右上方“重建时间线”让 AI 扫描章节中的时间信息。
                </p>
             </div>
           ) : (
             <div className="relative ml-4 border-l-2 border-border/40 pl-10 pr-2 py-4 space-y-10">
               {anchors.map((anchor, i) => {
                 const isSelected = calcA === i || calcB === i;
                 const hasIssue = issues.some(iss => iss.chapter === anchor.chapter);
                 
                 return (
                   <div key={i} className="relative">
                      {/* Node Circle */}
                      <div className={`absolute -left-[3.15rem] top-4 z-10 h-6 w-6 rounded-full border-4 shadow-sm transition-all duration-300 ${
                        hasIssue ? "border-background bg-destructive scale-110" :
                        isSelected ? "border-background bg-primary scale-125 shadow-primary/30" :
                        "border-background bg-border group-hover:bg-primary/50"
                      }`} />

                      {/* Content Card */}
                      <button
                        onClick={() => {
                          if (calcA === -1) setCalcA(i);
                          else if (calcB === -1 && i !== calcA) setCalcB(i);
                          else { setCalcA(i); setCalcB(-1); }
                          setSelectedAnchor(selectedAnchor === i ? null : i);
                        }}
                        className={`paper-sheet w-full rounded-[2rem] p-6 text-left transition-all duration-300 hover:shadow-3d hover:-translate-y-1 ${
                          isSelected ? "ring-2 ring-primary bg-primary/[0.03]" :
                          hasIssue ? "ring-2 ring-destructive/20 bg-destructive/[0.02]" :
                          ""
                        }`}
                      >
                         <div className="flex flex-wrap items-center gap-3 mb-4">
                            <div className={`flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-bold ${
                              isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
                            }`}>
                               <Hash size={12} />
                               第 {anchor.chapter} 章
                            </div>
                            
                            {anchor.parsedDate ? (
                               <div className="flex items-center gap-1.5 rounded-full bg-secondary/80 px-4 h-8 text-[11px] font-bold text-muted-foreground">
                                  <Calendar size={12} className="text-primary/60" />
                                  <span className="font-mono">{anchor.parsedDate}</span>
                               </div>
                            ) : anchor.timeDescription && (
                               <div className="flex items-center gap-1.5 rounded-full bg-secondary/80 px-4 h-8 text-[11px] font-bold text-muted-foreground italic">
                                  <Clock size={12} className="text-primary/60" />
                                  {anchor.timeDescription}
                               </div>
                            )}

                            {hasIssue && (
                               <div className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-4 h-8 text-[11px] font-bold text-destructive animate-pulse">
                                  <AlertTriangle size={12} />
                                  逻辑存疑
                               </div>
                            )}
                         </div>

                         <p className="text-lg font-medium leading-relaxed text-foreground mb-5">
                            {anchor.eventSummary.length > 120 && selectedAnchor !== i
                              ? `${anchor.eventSummary.slice(0, 117)}…`
                              : anchor.eventSummary
                            }
                         </p>

                         {anchor.charactersPresent.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-border/30">
                               <Users size={14} className="text-muted-foreground/60 mr-1" />
                               {anchor.charactersPresent.map((char, idx) => (
                                 <span key={idx} className="text-xs font-bold text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-lg">
                                    {char}
                                 </span>
                               ))}
                            </div>
                         )}
                      </button>

                      {/* Detail Panel */}
                      {selectedAnchor === i && (
                        <div className="mt-3 paper-sheet rounded-[1.5rem] p-6 space-y-4 animate-in fade-in slide-in-from-top-2 border border-primary/10">
                          {/* Full paragraph */}
                          {anchor.contextParagraph && anchor.contextParagraph !== anchor.eventSummary && (
                            <div>
                              <div className="flex items-center gap-2 text-xs font-bold text-primary mb-2">
                                <Eye size={12} />
                                完整上下文
                              </div>
                              <div className="text-sm leading-relaxed text-foreground/80 bg-muted/20 rounded-xl p-4 max-h-[300px] overflow-y-auto">
                                <span className="text-primary font-bold">{anchor.timeDescription}</span>
                                <span className="ml-1">{(anchor.contextParagraph || "").replace(anchor.timeDescription, "").trim()}</span>
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-3 pt-2 border-t border-border/20">
                            <button
                              onClick={(e) => { e.stopPropagation(); nav.toChapter(bookId, anchor.chapter); }}
                              className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
                            >
                              <ExternalLink size={12} />
                              前往第 {anchor.chapter} 章
                            </button>
                            {anchor.position !== undefined && (
                              <span className="text-[10px] text-muted-foreground">
                                段落位置：字符 {anchor.position}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                   </div>
                 );
               })}
               
               {/* Timeline footer info */}
               <div className="pt-10 pb-4 text-center">
                  <div className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                     <Sparkles size={12} className="text-primary" />
                     {data?.lastRebuilt ? `最后由 AI 梳理于 ${new Date(data.lastRebuilt).toLocaleString()}` : "AI 脉络引擎就绪"}
                  </div>
               </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
