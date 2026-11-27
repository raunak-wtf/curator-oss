"use client";

import { RefreshCw, Sparkles, TerminalSquare } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import { useEffect, useRef, useState } from "react";
import type { PreviewConsoleEntry, TerminalCommand } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TerminalEntry = TerminalCommand & { running: boolean };

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

function statusFor(entry: TerminalEntry) {
  if (entry.running) return { label: "Running", className: "text-sky-300" };
  if (entry.failed) return { label: entry.exitCode === null ? "Failed" : `Exit ${entry.exitCode}`, className: "text-red-300" };
  if (entry.background) return { label: "Background", className: "text-white/45" };
  return { label: "Exit 0", className: "text-emerald-300" };
}

type TerminalPanelProps = {
  entries: TerminalEntry[];
  isBuilding: boolean;
  /** Live stdout/stderr from the running sandbox dev server (`npm run dev` & background sessions). */
  serverLogs?: string;
  serverErrors?: PreviewConsoleEntry[];
  loadingServerLogs?: boolean;
  onRefreshServerLogs?: () => void;
  onFixServerErrors?: (errors: PreviewConsoleEntry[]) => void;
};

export function TerminalPanel({
  entries,
  isBuilding,
  serverLogs,
  serverErrors = [],
  loadingServerLogs = false,
  onRefreshServerLogs,
  onFixServerErrors,
}: TerminalPanelProps) {
  const showServerToggle = serverLogs !== undefined || Boolean(onRefreshServerLogs);
  const [view, setView] = useState<"server" | "commands">(showServerToggle ? "server" : "commands");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastEntry = entries.at(-1);

  // Switch to Build commands automatically while an active build command is streaming, or keep user's choice.
  const running = entries.some((entry) => entry.running);

  // Follow new output unless the reader scrolled up to look at something earlier.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [entries.length, lastEntry?.output, lastEntry?.running, serverLogs, view]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0e0e0e] font-mono text-[12px]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5 font-sans text-[12px] text-white/55">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-white/80">
            <TerminalSquare className="size-3.5 text-white/60" aria-hidden="true" />
            Sandbox Console
          </span>
          {showServerToggle ? (
            <div className="flex items-center gap-1" role="tablist" aria-label="Sandbox console views">
              <button
                type="button"
                role="tab"
                aria-selected={view === "server"}
                onClick={() => {
                  setView("server");
                  onRefreshServerLogs?.();
                }}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:min-h-11",
                  view === "server"
                    ? "bg-white/[0.12] text-white"
                    : "text-white/50 hover:bg-white/[0.06] hover:text-white/85",
                )}
              >
                <span>Live Server (`npm run dev`)</span>
                {serverErrors.length > 0 ? (
                  <span className="rounded-full bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 tabular-nums leading-none">
                    {serverErrors.length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "commands"}
                onClick={() => setView("commands")}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:min-h-11",
                  view === "commands"
                    ? "bg-white/[0.12] text-white"
                    : "text-white/50 hover:bg-white/[0.06] hover:text-white/85",
                )}
              >
                <span>Build Commands</span>
                <span className="text-[10.5px] text-white/40 tabular-nums">{entries.length}</span>
              </button>
            </div>
          ) : (
            <span className="text-white/30">· commands Cognix runs in your sandbox</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {view === "server" && serverErrors.length > 0 && onFixServerErrors ? (
            <button
              type="button"
              disabled={isBuilding}
              onClick={() => onFixServerErrors(serverErrors)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11px] font-semibold text-black hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-45 [@media(pointer:coarse)]:min-h-11"
            >
              <Sparkles className="size-3" aria-hidden="true" />
              Fix {serverErrors.length === 1 ? "error" : `${serverErrors.length} errors`}
            </button>
          ) : null}
          {view === "server" && onRefreshServerLogs ? (
            <button
              type="button"
              onClick={onRefreshServerLogs}
              disabled={loadingServerLogs}
              aria-label="Refresh sandbox server logs"
              title="Refresh sandbox server logs"
              className="grid size-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] disabled:opacity-40 [@media(pointer:coarse)]:size-11"
            >
              {loadingServerLogs ? <PixelLoader size="sm" /> : <RefreshCw className="size-3.5" />}
            </button>
          ) : null}
          <span className={cn("flex items-center gap-1.5", running ? "text-sky-300" : "text-white/35")} role="status">
            {running ? <PixelLoader /> : null}
            {running ? "Running command" : isBuilding ? "Building…" : "Live"}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          pinnedRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-3"
        role="log"
        aria-label={view === "server" ? "Live sandbox server logs" : "Commands run in the sandbox"}
        tabIndex={0}
      >
        {view === "server" && showServerToggle ? (
          serverLogs?.trim() ? (
            <pre className="whitespace-pre-wrap break-words text-[11.5px] leading-5 text-white/80">
              {serverLogs}
            </pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center font-sans">
              <TerminalSquare className="size-5 text-white/30" aria-hidden="true" />
              <p className="text-[13px] font-medium text-white/70">
                {loadingServerLogs ? "Reading sandbox server logs…" : "No sandbox server output yet"}
              </p>
              <p className="max-w-xs text-[12px] leading-5 text-white/40">
                Live stdout and stderr from the running Node.js / Next.js server inside your sandbox appear here automatically.
              </p>
            </div>
          )
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center font-sans">
            <TerminalSquare className="size-5 text-white/30" aria-hidden="true" />
            <p className="text-[13px] font-medium text-white/70">No commands yet</p>
            <p className="max-w-xs text-[12px] leading-5 text-white/40">
              Commands appear here when Cognix installs packages, runs builds, or starts your app. Send a prompt to start a build.
            </p>
          </div>
        ) : (
          <ol className="space-y-4">
            {entries.map((entry) => {
              const status = statusFor(entry);
              return (
                <li key={entry.id}>
                  <div className="flex flex-wrap items-baseline gap-x-2 leading-5">
                    <span className="text-emerald-400">cognix@cloud</span>
                    <span className="text-white/30">~/app $</span>
                    <span className="min-w-0 break-all text-white">{entry.command}</span>
                  </div>
                  {entry.output ? (
                    <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11.5px] leading-[18px] text-white/60">
                      {entry.output}
                    </pre>
                  ) : null}
                  <p className="mt-1 flex items-center gap-2 font-sans text-[11px] tabular-nums text-white/30">
                    {entry.running ? (
                      <PixelLoader size="sm" className="text-sky-300" />
                    ) : null}
                    <span className={status.className}>{status.label}</span>
                    {!entry.running ? <span>· {formatDuration(status.label === "Running" ? 0 : entry.durationMs)}</span> : null}
                    {entry.source === "system" ? <span>· run by Cognix</span> : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
