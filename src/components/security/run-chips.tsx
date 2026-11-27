"use client";

import { ChevronDown, FileText, Globe2, PenLine, Search, Sparkles, TerminalSquare, GitPullRequest, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { PixelLoader } from "@/components/pixel-loader";
import type { FileChangeSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * An agent run as compact rows: each tool call with a chip naming what it acted on, then file-diff chips.
 * Clicking a row opens it in the workspace pane (the file in Files, the command in Shell). The chevron
 * expands a row to show the tool's result. Hovering or focusing a file chip previews its diff.
 */

export type RunChipActivity = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  target?: string;
  durationMs?: number;
};

type Kind = "think" | "write" | "run" | "read" | "web" | "ask";

const KIND: Record<string, { kind: Kind; verb: string }> = {
  status: { kind: "think", verb: "Working" },
  read_attachment: { kind: "read", verb: "Read attachment" },
  read_file: { kind: "read", verb: "Read" },
  list_files: { kind: "read", verb: "List" },
  find_files: { kind: "read", verb: "Find" },
  search_files: { kind: "read", verb: "Search" },
  write_file: { kind: "write", verb: "Write" },
  edit_file: { kind: "write", verb: "Edit" },
  move_file: { kind: "write", verb: "Move" },
  delete_file: { kind: "write", verb: "Delete" },
  run_command: { kind: "run", verb: "Run" },
  get_process_logs: { kind: "run", verb: "Read logs" },
  list_processes: { kind: "run", verb: "List processes" },
  stop_process: { kind: "run", verb: "Stop process" },
  web_search: { kind: "web", verb: "Web search" },
  fetch_url: { kind: "web", verb: "Fetch" },
  neon_database: { kind: "run", verb: "Cloud Database" },
  cloud_storage: { kind: "run", verb: "Cloud Storage" },
  resend_email: { kind: "run", verb: "Cloud Emails" },
  read_cloud_guide: { kind: "read", verb: "Read Cloud guide" },
  request_cognix_cloud: { kind: "ask", verb: "Cognix Cloud" },
  ask_user: { kind: "ask", verb: "Asked you" },
  propose_pull_request: { kind: "ask", verb: "Proposed a PR" },
};

function kindFor(name: string) {
  return KIND[name] ?? { kind: "read" as Kind, verb: name.replaceAll("_", " ") };
}

function KindIcon({ name, running }: { name: string; running: boolean }) {
  if (running) return <PixelLoader size="sm" />;
  const { kind } = kindFor(name);
  const className = "size-3.5";
  if (kind === "think") return <Sparkles className={className} />;
  if (kind === "write") return <PenLine className={className} />;
  if (kind === "run") return <TerminalSquare className={className} />;
  if (kind === "web") return <Globe2 className={className} />;
  if (name === "propose_pull_request") return <GitPullRequest className={className} />;
  if (kind === "ask") return <MessageCircleQuestion className={className} />;
  if (name === "search_files" || name === "find_files") return <Search className={className} />;
  return <FileText className={className} />;
}

/** Added and removed line counts, by comparing the lines each version contains. */
export function lineChanges(before: string | null, after: string | null) {
  const counts = new Map<string, number>();
  for (const line of (before ?? "").split("\n")) if (before !== null) counts.set(line, (counts.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of (after ?? "").split("\n")) {
    if (after === null) break;
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added.push(line);
  }
  const removed: string[] = [];
  for (const line of (before ?? "").split("\n")) {
    if (before === null) break;
    const left = counts.get(line) ?? 0;
    if (left > 0) {
      removed.push(line);
      counts.set(line, left - 1);
    }
  }
  return { added, removed };
}

const fileName = (value: string) => value.split("/").at(-1) ?? value;

type Preview = { path: string; x: number; top?: number; bottom?: number };

export function RunChips({
  activities,
  fileChanges = [],
  live = false,
  canOpen,
  onOpenActivity,
  onOpenFile,
}: {
  activities: RunChipActivity[];
  fileChanges?: FileChangeSnapshot[];
  live?: boolean;
  /** Whether a row can be opened in the workspace pane. */
  canOpen: (activity: RunChipActivity) => boolean;
  onOpenActivity: (activity: RunChipActivity) => void;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(live);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Only real tool calls are shown. The "status" events ("Starting a secure workspace", "Working on the
  // repository", …) are progress labels, not tool calls, so they never become rows.
  const tools = activities.filter((item) => item.name !== "status");
  const diffs = fileChanges.map((change) => ({ change, ...lineChanges(change.before, change.after) }));
  if (!tools.length && !diffs.length) return null;

  const header = live
    ? `Working · ${tools.length} ${tools.length === 1 ? "tool call" : "tool calls"}`
    : `${tools.length} ${tools.length === 1 ? "tool call" : "tool calls"}${diffs.length ? `, ${diffs.length} ${diffs.length === 1 ? "file" : "files"} changed` : ""}`;
  const shownDiffs = showAllFiles ? diffs : diffs.slice(0, 6);
  const previewDiff = preview ? diffs.find((item) => item.change.path === preview.path) : null;

  function openPreview(path: string, element: Element) {
    const rect = element.getBoundingClientRect();
    const target = diffs.find((item) => item.change.path === path);
    const height = 40 + Math.min(14, (target?.added.length ?? 0) + (target?.removed.length ?? 0) || 1) * 19;
    const fitsBelow = rect.bottom + 6 + height <= window.innerHeight - 12;
    setPreview({
      path,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 312)),
      ...(fitsBelow ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
    });
  }

  return (
    <div className="run-chips mt-3 w-full max-w-[560px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/80 [@media(pointer:coarse)]:min-h-11"
      >
        <ChevronDown className={cn("size-3 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden="true" />
        <span className="tabular-nums">{header}</span>
        {live ? <PixelLoader size="sm" /> : null}
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        inert={!open}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1.5 pb-1">
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {tools.map((item) => {
              const meta = kindFor(item.name);
              const rowOpen = expanded.has(item.id);
              const openable = canOpen(item);
              const chip = item.target ?? item.label.replace(/^Needs attention: /, "");
              return (
                <li key={item.id} className="run-chip-row">
                  <div className="group/row flex h-7 min-w-0 items-center gap-1 rounded-md transition-colors hover:bg-white/[0.04] [@media(pointer:coarse)]:h-11">
                    <button
                      type="button"
                      aria-expanded={rowOpen}
                      aria-label={rowOpen ? `Hide details for ${meta.verb}` : `Show details for ${meta.verb}`}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                      className={cn(
                        "relative grid size-6 shrink-0 place-items-center rounded text-white/45 hover:text-white [@media(pointer:coarse)]:size-11",
                        item.status === "error" && "text-rose-300/80",
                      )}
                    >
                      <span className={cn("transition-opacity duration-100 group-hover/row:opacity-0", rowOpen && "opacity-0")}>
                        <KindIcon name={item.name} running={item.status === "running"} />
                      </span>
                      <ChevronDown
                        className={cn(
                          "absolute size-3 opacity-0 transition-[opacity,transform] duration-150 group-hover/row:opacity-100 motion-reduce:transition-none",
                          rowOpen ? "opacity-100" : "-rotate-90",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      disabled={!openable}
                      onClick={() => onOpenActivity(item)}
                      title={openable ? `Open in the workspace: ${item.label}` : item.label}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left disabled:cursor-default"
                    >
                      <span className={cn("shrink-0 text-[12.5px] font-medium", item.status === "error" ? "text-rose-200" : "text-white/85")}>{meta.verb}</span>
                      <span
                        className={cn(
                          "inline-flex h-5.5 min-w-0 items-center truncate rounded-md bg-white/[0.05] px-1.5 text-[11.5px] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]",
                          (item.target || item.name === "run_command") && "font-mono",
                          openable && "group-hover/row:bg-white/[0.08] group-hover/row:text-white/80",
                        )}
                      >
                        <span className="truncate">{chip}</span>
                      </span>
                    </button>
                  </div>
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
                    style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0 }}
                    inert={!rowOpen}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="mb-1 ml-3 mt-0.5 border-l border-white/[0.08] py-0.5 pl-3.5 text-[11.5px] leading-[1.6] text-white/55">
                        {item.label}
                        {typeof item.durationMs === "number" && item.durationMs > 0 ? (
                          <span className="ml-2 tabular-nums text-white/30">{item.durationMs < 1000 ? `${item.durationMs} ms` : `${(item.durationMs / 1000).toFixed(1)} s`}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {diffs.length ? (
            <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-white/[0.07] pt-2.5">
              {shownDiffs.map(({ change, added, removed }) => (
                <button
                  key={change.path}
                  type="button"
                  onClick={() => onOpenFile(change.path)}
                  onMouseEnter={(event) => openPreview(change.path, event.currentTarget)}
                  onMouseLeave={() => setPreview((current) => (current?.path === change.path ? null : current))}
                  onFocus={(event) => openPreview(change.path, event.currentTarget)}
                  onBlur={() => setPreview((current) => (current?.path === change.path ? null : current))}
                  aria-label={`${change.path}: ${added.length} lines added, ${removed.length} removed. Open the file`}
                  className="inline-flex h-7 max-w-full items-center gap-2 rounded-md bg-white/[0.06] px-2 font-mono text-[11.5px] text-white/85 shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)] transition-colors hover:bg-white/[0.1] [@media(pointer:coarse)]:h-11"
                  title={change.path}
                >
                  <span className="min-w-0 truncate">{fileName(change.path)}</span>
                  {change.after === null ? <span className="shrink-0 text-rose-300">deleted</span> : null}
                  {added.length ? <span className="shrink-0 tabular-nums text-emerald-300">+{added.length}</span> : null}
                  {removed.length ? <span className="shrink-0 tabular-nums text-rose-300">−{removed.length}</span> : null}
                </button>
              ))}
              {diffs.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setShowAllFiles((current) => !current)}
                  className="inline-flex h-7 items-center rounded-md px-1.5 font-mono text-[11.5px] text-white/45 underline decoration-transparent underline-offset-2 hover:text-white/70 hover:decoration-current [@media(pointer:coarse)]:h-11"
                >
                  {showAllFiles ? "Show fewer" : `+${diffs.length - 6} more`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {preview && previewDiff && typeof document !== "undefined"
        ? createPortal(
            <div
              className="run-chip-preview fixed z-50 w-[300px] overflow-hidden rounded-[10px] border border-white/10 bg-[#202020] shadow-[0_18px_50px_rgba(0,0,0,.55)]"
              style={{ left: preview.x, top: preview.top, bottom: preview.bottom }}
              role="tooltip"
            >
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-2.5 py-1.5 font-mono text-[11px]">
                <span className="min-w-0 truncate text-white/60">{preview.path}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-emerald-300">+{previewDiff.added.length}</span>
                  {previewDiff.removed.length ? <span className="text-rose-300"> −{previewDiff.removed.length}</span> : null}
                </span>
              </div>
              <div className="py-1 font-mono text-[11px] leading-[1.75]">
                {[
                  ...previewDiff.removed.slice(0, 6).map((text) => ({ text, tone: "del" as const })),
                  ...previewDiff.added.slice(0, 14 - Math.min(6, previewDiff.removed.length)).map((text) => ({ text, tone: "add" as const })),
                ].map((line, index) => (
                  <div
                    key={index}
                    className={cn("flex gap-2 whitespace-pre px-2.5", line.tone === "add" ? "bg-emerald-400/[0.08] text-emerald-200" : "bg-rose-400/[0.08] text-rose-200")}
                  >
                    <span className="w-3 shrink-0 select-none">{line.tone === "add" ? "+" : "−"}</span>
                    <span className="min-w-0 truncate">{line.text || " "}</span>
                  </div>
                ))}
                {!previewDiff.added.length && !previewDiff.removed.length ? <p className="px-2.5 text-white/40">No line changes.</p> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
