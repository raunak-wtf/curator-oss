"use client";

import { TerminalSquare } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import { useEffect, useRef } from "react";
import type { TerminalCommand } from "@/lib/types";
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

export function TerminalPanel({ entries, isBuilding }: { entries: TerminalEntry[]; isBuilding: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastEntry = entries.at(-1);

  // Follow new output unless the reader scrolled up to look at something earlier.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [entries.length, lastEntry?.output, lastEntry?.running]);

  const running = entries.some((entry) => entry.running);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0e0e0e] font-mono text-[12px]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2 font-sans text-[12px] text-white/50">
        <span className="flex items-center gap-2">
          <TerminalSquare className="size-3.5" aria-hidden="true" />
          Read-only terminal
          <span className="text-white/30">· commands Cognix runs in your sandbox</span>
        </span>
        <span className={cn("flex items-center gap-1.5", running ? "text-sky-300" : "text-white/35")} role="status">
          {running ? <PixelLoader /> : null}
          {running ? "Running command" : isBuilding ? "Waiting for the next command" : "Idle"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          pinnedRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-3"
        role="log"
        aria-label="Commands run in the sandbox"
        tabIndex={0}
      >
        {entries.length === 0 ? (
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
                    {!entry.running ? <span>· {formatDuration(entry.durationMs)}</span> : null}
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
