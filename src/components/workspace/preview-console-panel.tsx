"use client";

import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { selectActionableConsoleErrors } from "@/lib/preview-console";
import type { PreviewConsoleEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ConsoleFilter = "all" | "errors" | "warnings" | "browser" | "network" | "server";

type PreviewConsolePanelProps = {
  entries: PreviewConsoleEntry[];
  serverLogs: string;
  loading: boolean;
  error: string | null;
  isBuilding: boolean;
  filterRequest?: { value: ConsoleFilter; nonce: number };
  onRefresh: () => void;
  onClear: () => void;
  onFixErrors: (entries: PreviewConsoleEntry[]) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onCloseDrawer?: () => void;
};

const FILTER_OPTIONS: { id: ConsoleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "errors", label: "Errors" },
  { id: "warnings", label: "Warnings" },
  { id: "browser", label: "Browser" },
  { id: "network", label: "API" },
  { id: "server", label: "Server output" },
];

function formatLogTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sourceBadgeLabel(source: PreviewConsoleEntry["source"]) {
  if (source === "network") return "API";
  if (source === "server") return "Server";
  return "Browser";
}

export function PreviewConsolePanel({
  entries,
  serverLogs,
  loading,
  error,
  isBuilding,
  filterRequest,
  onRefresh,
  onClear,
  onFixErrors,
  expanded = false,
  onToggleExpand,
  onCloseDrawer,
}: PreviewConsolePanelProps) {
  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (filterRequest) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs explicit external filter jump from error banner
      setFilter(filterRequest.value);
    }
  }, [filterRequest]);

  const actionableErrors = useMemo(() => selectActionableConsoleErrors(entries), [entries]);
  const errorCount = useMemo(
    () => entries.filter((entry) => entry.level === "error").length,
    [entries],
  );
  const warningCount = useMemo(
    () => entries.filter((entry) => entry.level === "warn").length,
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === "errors" && entry.level !== "error") return false;
      if (filter === "warnings" && entry.level !== "warn") return false;
      if (filter === "browser" && entry.source !== "browser") return false;
      if (filter === "network" && entry.source !== "network") return false;
      if (!normalizedQuery) return true;
      const haystack = `${entry.message} ${entry.route ?? ""} ${entry.stack ?? ""} ${entry.statusCode ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [entries, filter, query]);

  const filteredServerLogs = useMemo(() => {
    if (!query.trim() || !serverLogs) return serverLogs;
    const normalizedQuery = query.trim().toLowerCase();
    return serverLogs
      .split("\n")
      .filter((line) => line.toLowerCase().includes(normalizedQuery))
      .join("\n");
  }, [query, serverLogs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length, serverLogs, filter]);

  async function copyVisibleLogs() {
    const text =
      filter === "server"
        ? filteredServerLogs || "No server output recorded."
        : filteredEntries
            .map(
              (entry) =>
                `[${formatLogTime(entry.createdAt)}] [${entry.source.toUpperCase()}:${entry.level.toUpperCase()}]${entry.route ? ` (${entry.route})` : ""} ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`,
            )
            .join("\n\n") || "No console entries recorded.";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Console logs copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy logs to clipboard. Select the text and copy manually.");
    }
  }

  const iconBtn =
    "grid size-8 shrink-0 place-items-center rounded-md text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:size-11";

  return (
    <section
      aria-label="Preview runtime console"
      className="flex h-full min-h-0 flex-col bg-[#0d0d0f] text-white"
    >
      <header className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#131316] px-2.5 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 pr-1 text-[12px] font-semibold text-white/90">
            <SquareTerminal className="size-3.5 text-white/65" aria-hidden="true" />
            Console
          </span>
          <nav aria-label="Console filters" className="flex flex-wrap items-center gap-1">
            {FILTER_OPTIONS.map((option) => {
              const active = filter === option.id;
              const badgeCount =
                option.id === "errors"
                  ? errorCount
                  : option.id === "warnings"
                    ? warningCount
                    : 0;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3",
                    active
                      ? "border-white/20 bg-white/[0.12] text-white"
                      : "border-transparent bg-white/[0.03] text-white/55 hover:bg-white/[0.07] hover:text-white/85",
                  )}
                >
                  <span>{option.label}</span>
                  {badgeCount > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
                        option.id === "errors"
                          ? "bg-rose-500/25 text-rose-200"
                          : "bg-amber-500/20 text-amber-200",
                      )}
                    >
                      {badgeCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <div className="relative hidden sm:block">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter logs…"
              aria-label="Filter console logs"
              className="h-8 w-40 rounded-md border border-white/[0.09] bg-black/40 pl-8 pr-7 text-[11.5px] text-white placeholder:text-white/35 focus-visible:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:h-11"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear log filter"
                className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-white/45 hover:text-white [@media(pointer:coarse)]:size-9"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          {actionableErrors.length > 0 ? (
            <button
              type="button"
              disabled={isBuilding}
              onClick={() => onFixErrors(actionableErrors)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11.5px] font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
              title="Send detected errors to Cognix to fix automatically"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>Fix {actionableErrors.length === 1 ? "error" : `${actionableErrors.length} errors`}</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh console logs"
            title="Refresh console logs"
            className={iconBtn}
          >
            {loading ? <PixelLoader size="sm" /> : <RefreshCw className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => void copyVisibleLogs()}
            aria-label="Copy visible logs"
            title="Copy visible logs"
            className={iconBtn}
          >
            {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={entries.length === 0 && !serverLogs}
            aria-label="Clear console"
            title="Clear console"
            className={iconBtn}
          >
            <Trash2 className="size-3.5" />
          </button>
          {onToggleExpand ? (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={expanded ? "Restore split preview and console" : "Maximize console"}
              title={expanded ? "Restore split view" : "Maximize console"}
              className={iconBtn}
            >
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          ) : null}
          {onCloseDrawer ? (
            <button
              type="button"
              onClick={onCloseDrawer}
              aria-label="Close console drawer"
              title="Close console drawer"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-rose-500/25 bg-rose-950/35 px-3 py-2 text-[12px] text-rose-200"
        >
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-8 shrink-0 items-center rounded-md border border-rose-400/30 bg-rose-500/15 px-2.5 text-[11px] font-medium text-rose-100 hover:bg-rose-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 [@media(pointer:coarse)]:min-h-11"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain font-mono text-[11.5px]">
        {filter === "server" ? (
          filteredServerLogs ? (
            <pre className="whitespace-pre-wrap break-words p-3 leading-5 text-white/80">
              {filteredServerLogs}
            </pre>
          ) : (
            <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-1.5 px-6 text-center font-sans">
              <p className="text-[12.5px] font-medium text-white/70">
                {loading ? "Reading workspace server output…" : "No server output yet"}
              </p>
              <p className="max-w-sm text-[11.5px] text-white/45">
                {query
                  ? "No server log lines matched your filter. Clear the filter or refresh to check again."
                  : "Live development server stdout and stderr appear here while your app runs."}
              </p>
            </div>
          )
        ) : filteredEntries.length === 0 ? (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-1.5 px-6 text-center font-sans">
            <p className="text-[12.5px] font-medium text-white/70">
              {loading
                ? "Loading console logs…"
                : filter === "errors"
                  ? "No runtime errors detected"
                  : "No console messages yet"}
            </p>
            <p className="max-w-sm text-[11.5px] text-white/45">
              {query
                ? "No console entries matched your search. Clear the search box to view all logs."
                : filter === "errors"
                  ? "Uncaught exceptions, failed API requests, and server errors will appear here automatically."
                  : "Interact with the live preview to capture browser logs, API responses, and runtime exceptions."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {filteredEntries.map((entry) => {
              const isError = entry.level === "error";
              const isWarn = entry.level === "warn";
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "px-3 py-2 transition-colors",
                    isError
                      ? "bg-rose-500/[0.07] hover:bg-rose-500/[0.1]"
                      : isWarn
                        ? "bg-amber-500/[0.05] hover:bg-amber-500/[0.08]"
                        : "hover:bg-white/[0.025]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0" aria-hidden="true">
                      {isError ? (
                        <AlertCircle className="size-3.5 text-rose-400" />
                      ) : isWarn ? (
                        <AlertTriangle className="size-3.5 text-amber-400" />
                      ) : (
                        <span className="mt-1.5 block size-1.5 rounded-full bg-white/30" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <time
                          dateTime={entry.createdAt}
                          className="text-[10.5px] text-white/35 tabular-nums"
                        >
                          {formatLogTime(entry.createdAt)}
                        </time>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none",
                            entry.source === "server"
                              ? "bg-violet-500/20 text-violet-200"
                              : entry.source === "network"
                                ? "bg-sky-500/20 text-sky-200"
                                : "bg-white/[0.08] text-white/70",
                          )}
                        >
                          {sourceBadgeLabel(entry.source)}
                        </span>
                        {entry.statusCode ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
                              entry.statusCode >= 500
                                ? "bg-rose-500/25 text-rose-200"
                                : "bg-amber-500/20 text-amber-200",
                            )}
                          >
                            {entry.statusCode}
                          </span>
                        ) : null}
                        {entry.route ? (
                          <span className="truncate text-[10.5px] text-white/45">
                            {entry.route}
                          </span>
                        ) : null}
                        {entry.repeatCount > 1 ? (
                          <span className="rounded-full bg-white/[0.1] px-1.5 py-0.5 text-[10px] font-semibold text-white/75 tabular-nums leading-none">
                            ×{entry.repeatCount}
                          </span>
                        ) : null}
                      </div>

                      <p
                        className={cn(
                          "mt-1 whitespace-pre-wrap break-words leading-5",
                          isError
                            ? "text-rose-100"
                            : isWarn
                              ? "text-amber-100"
                              : "text-white/80",
                        )}
                      >
                        {entry.message}
                      </p>

                      {entry.stack ? (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer select-none font-sans text-[11px] text-white/45 hover:text-white/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff]">
                            Stack trace
                          </summary>
                          <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border border-white/[0.07] bg-black/45 p-2.5 text-[10.5px] leading-4 text-white/65">
                            {entry.stack}
                          </pre>
                        </details>
                      ) : null}
                    </div>

                    {isError ? (
                      <button
                        type="button"
                        disabled={isBuilding}
                        onClick={() => onFixErrors([entry])}
                        aria-label="Fix this error with Cognix"
                        className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-rose-400/30 bg-rose-500/15 px-2.5 font-sans text-[11px] font-medium text-rose-100 transition-colors hover:bg-rose-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
                      >
                        <Sparkles className="size-3" aria-hidden="true" />
                        Fix
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
