import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly statusDistribution: Record<string, number>;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function Analytics({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<AnalyticsData>(`/books/${bookId}/analytics`);

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const statuses = Object.entries(data.statusDistribution);
  const totalFromDist = statuses.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("analytics.title")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("analytics.title")}</h1>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label={t("analytics.totalChapters")} value={data.totalChapters.toString()} c={c} />
        <StatCard
          label={t("analytics.totalWords")}
          value={formatChineseWordCount(data.totalWords)}
          exact={`${data.totalWords.toLocaleString()} 字`}
          c={c}
        />
        <StatCard
          label={t("analytics.avgWords")}
          value={formatChineseWordCount(data.avgWordsPerChapter)}
          exact={`${data.avgWordsPerChapter.toLocaleString()} 字`}
          c={c}
        />
      </div>

      {statuses.length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.statusDist")}</h2>
          <div className="space-y-3">
            {statuses.map(([status, count]) => (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={c.subtle}>{status}</span>
                  <span className={c.muted}>{count}</span>
                </div>
                <div className={`h-2 ${c.btnSecondary} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-zinc-500 rounded-full transition-all"
                    style={{ width: `${totalFromDist > 0 ? (count / totalFromDist) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatChineseWordCount(value: number): string {
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(value >= 100_000 ? 1 : 2).replace(/\.?0+$/, "")}万字`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}千字`;
  }
  return `${value}字`;
}

function StatCard({ label, value, exact, c }: {
  label: string;
  value: string;
  exact?: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className={`min-w-0 border ${c.cardStatic} rounded-lg p-3 sm:p-5`}>
      <div className={`mb-1 text-[11px] leading-4 sm:text-sm ${c.muted}`}>{label}</div>
      <div className="break-words text-base font-semibold tabular-nums sm:text-2xl">{value}</div>
      {exact ? <div className={`mt-1 text-[9px] leading-3 tabular-nums sm:text-[11px] ${c.muted}`}>{exact}</div> : null}
    </div>
  );
}
