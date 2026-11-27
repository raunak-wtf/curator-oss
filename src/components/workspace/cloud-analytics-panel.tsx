"use client";

import { BarChart3, Globe2, Laptop, Monitor, RefreshCw, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PixelLoader } from "@/components/pixel-loader";
import type { ProjectAnalyticsSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type CloudAnalyticsPanelProps = {
  projectId: string;
  publishedUrl: string;
  isPublished: boolean;
};

export function CloudAnalyticsPanel({ projectId, publishedUrl, isPublished }: CloudAnalyticsPanelProps) {
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<ProjectAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(
    async (windowDays: 7 | 30) => {
      const response = await fetch(`/api/projects/${projectId}/analytics?days=${windowDays}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load traffic analytics. Try again.");
      }
      return payload as ProjectAnalyticsSummary;
    },
    [projectId],
  );

  useEffect(() => {
    let active = true;
    fetchAnalytics(days)
      .then((summary) => {
        if (!active) return;
        setData(summary);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load traffic analytics. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, fetchAnalytics]);

  async function reload(nextDays: 7 | 30 = days) {
    setDays(nextDays);
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchAnalytics(nextDays);
      setData(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load traffic analytics. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const maxDailyViews = Math.max(1, ...(data?.dailySeries.map((item) => item.pageviews) ?? [1]));
  const viewsPerVisitor =
    data && data.uniqueVisitors > 0 ? (data.totalPageviews / data.uniqueVisitors).toFixed(1) : "0.0";

  return (
    <section aria-labelledby="cloud-analytics-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-analytics-heading" className="text-lg font-semibold tracking-tight text-white">
            Analytics
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Cookieless edge traffic across your published subdomain and attached custom domains.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-white/10 bg-[#101010] p-0.5" role="group" aria-label="Analytics time range">
            {([7, 30] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => void reload(option)}
                disabled={loading && days === option}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[12px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 [@media(pointer:coarse)]:h-10",
                  days === option ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
                )}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void reload(days)}
            disabled={loading}
            aria-label="Refresh analytics"
            title="Refresh analytics"
            className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/65 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-40 [@media(pointer:coarse)]:size-11"
          >
            {loading ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2 text-[12px] text-emerald-200/85">
        <ShieldCheck className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
        <span>Privacy-friendly edge counting: no client scripts, no cookies, and no raw IP addresses stored.</span>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-400/25 bg-red-500/10 p-4">
          <p className="text-[13px] font-medium text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void reload(days)}
            className="mt-2.5 inline-flex h-8 items-center rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
          <p className="text-[11.5px] font-medium text-white/45">Unique visitors ({days}d)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {loading && !data ? "…" : (data?.uniqueVisitors ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
          <p className="text-[11.5px] font-medium text-white/45">Pageviews ({days}d)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {loading && !data ? "…" : (data?.totalPageviews ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
          <p className="text-[11.5px] font-medium text-white/45">Views / visitor</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {loading && !data ? "…" : viewsPerVisitor}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium text-white">Daily traffic</h3>
          {publishedUrl && isPublished ? (
            <span className="truncate font-mono text-[11.5px] text-white/45">{publishedUrl}</span>
          ) : null}
        </div>

        {!loading && data && data.totalPageviews === 0 ? (
          <div className="py-10 text-center">
            <BarChart3 className="mx-auto size-5 text-white/30" aria-hidden="true" />
            <p className="mt-2 text-[13px] font-medium text-white/75">
              {isPublished ? "No published pageviews recorded yet" : "Publish your app to start recording traffic"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-white/45">
              {isPublished
                ? "Open your published link in a browser tab and refresh here to see visitors, top routes, referrers, and devices."
                : "Development previews are excluded so your own building sessions never skew visitor metrics."}
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Daily pageviews over the last ${days} days`}>
              {(data?.dailySeries ?? []).map((point) => {
                const heightPct = point.pageviews > 0 ? Math.max(8, Math.round((point.pageviews / maxDailyViews) * 100)) : 3;
                return (
                  <div key={point.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                    <div
                      title={`${point.date}: ${point.pageviews} views · ${point.visitors} visitors`}
                      style={{ height: `${heightPct}%` }}
                      className={cn(
                        "w-full rounded-t transition-opacity",
                        point.pageviews > 0 ? "bg-emerald-400/80 group-hover:bg-emerald-300" : "bg-white/[0.06]",
                      )}
                    />
                    <span className="truncate text-[10px] tabular-nums text-white/35">
                      {point.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data && data.totalPageviews > 0 ? (
        <div className="grid gap-3 @[680px]:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-[13px] font-medium text-white">Top pages</h3>
            <ul className="mt-2.5 divide-y divide-white/[0.06]">
              {data.topPaths.map((entry) => (
                <li key={entry.path} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <code className="min-w-0 truncate font-mono text-white/80">{entry.path}</code>
                  <span className="shrink-0 tabular-nums text-white/55">
                    {entry.views.toLocaleString()} {entry.views === 1 ? "view" : "views"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-[13px] font-medium text-white">Referrers</h3>
            <ul className="mt-2.5 divide-y divide-white/[0.06]">
              {data.topReferrers.map((entry) => (
                <li key={entry.referrer} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate text-white/80">{entry.referrer}</span>
                  <span className="shrink-0 tabular-nums text-white/55">{entry.views.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-[13px] font-medium text-white">Devices</h3>
            <ul className="mt-2.5 space-y-2">
              {data.devices.map((item) => {
                const Icon = item.device === "mobile" ? Smartphone : item.device === "tablet" ? Tablet : Monitor;
                return (
                  <li key={item.device} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-2 capitalize text-white/80">
                      <Icon className="size-3.5 text-white/45" aria-hidden="true" />
                      {item.device}
                    </span>
                    <span className="tabular-nums text-white/55">
                      {item.views.toLocaleString()} ({item.percentage}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-[13px] font-medium text-white">Hostnames</h3>
            <ul className="mt-2.5 divide-y divide-white/[0.06]">
              {data.topHosts.map((item) => (
                <li key={item.hostname} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                  <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-white/80">
                    {item.hostname ? <Globe2 className="size-3.5 shrink-0 text-white/45" aria-hidden="true" /> : <Laptop className="size-3.5 shrink-0 text-white/45" aria-hidden="true" />}
                    <span className="truncate">{item.hostname}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/55">{item.views.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
