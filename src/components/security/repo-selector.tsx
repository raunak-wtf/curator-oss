"use client";

import { Check, ChevronDown, ExternalLink, Lock, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { GitHubMark } from "@/components/github-mark";
import { PixelLoader } from "@/components/pixel-loader";
import { cn } from "@/lib/utils";

type Repository = { fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null };
type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; repositories: Repository[] }
  | { kind: "error"; message: string; code?: string };

// One list per page load; reopening the menu doesn't ask GitHub again.
let cachedRepositories: Repository[] | null = null;

const RETURN_TO = "/security-scanner";

/** Picks which of the user's GitHub repositories Security mode reviews. Read-only: Cognix never pushes to it. */
export function RepoSelector({
  signedIn,
  value,
  onChange,
}: {
  signedIn: boolean;
  value: string | null;
  onChange: (fullName: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>(cachedRepositories ? { kind: "ready", repositories: cachedRepositories } : { kind: "idle" });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [reload, setReload] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || (state.kind === "ready" && reload === 0) || state.kind === "loading") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the loading state while the request runs
    setState({ kind: "loading" });
    fetch("/api/github/repos?access=read", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload.error ?? "Couldn't load your repositories."), { code: payload.code as string | undefined });
        return payload.repositories as Repository[];
      })
      .then((repositories) => {
        if (cancelled) return;
        cachedRepositories = repositories;
        setState({ kind: "ready", repositories });
      })
      .catch((error: Error & { code?: string }) => !cancelled && setState({ kind: "error", message: error.message, code: error.code }));
    return () => {
      cancelled = true;
    };
    // `state` is only read to skip work; depending on it would refetch on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const repositories = state.kind === "ready" ? state.repositories.filter((repo) => repo.fullName.toLowerCase().includes(normalized)) : [];
  const activeIndex = Math.min(active, Math.max(0, repositories.length - 1));

  function close(restoreFocus = true) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) buttonRef.current?.focus();
  }

  function choose(fullName: string) {
    onChange(fullName);
    // The parent moves focus to the prompt, so the user can type their question right away.
    close(false);
  }

  const trigger =
    "inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:h-11";

  if (!signedIn) {
    return (
      <a href={`/auth/login?returnTo=${encodeURIComponent(RETURN_TO)}`} className={trigger}>
        <GitHubMark className="size-3.5 shrink-0" aria-hidden="true" />
        Sign in to choose a repository
      </a>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="flex min-w-0 items-center">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
          className={cn(trigger, value && "text-white")}
          title="Repository to review. Cognix only reads it."
        >
          <GitHubMark className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{value ?? "Choose a repository"}</span>
          <ChevronDown className={cn("size-3 shrink-0 text-white/45 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove ${value}`}
            title="Remove repository"
            className="grid size-8 shrink-0 place-items-center rounded-md text-white/40 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className="absolute bottom-[calc(100%+6px)] left-0 z-40 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-xl border border-white/[0.1] bg-[#1d1d1d] shadow-[0_18px_50px_rgba(0,0,0,.55)]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-white/[0.07] px-3">
            <Search className="size-3.5 shrink-0 text-white/35" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (!repositories.length) return;
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive((activeIndex + step + repositories.length) % repositories.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const repo = repositories[activeIndex];
                  if (repo) choose(repo.fullName);
                }
              }}
              placeholder="Search repositories…"
              aria-label="Search repositories"
              aria-controls={listId}
              aria-activedescendant={repositories[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {state.kind === "loading" || state.kind === "idle" ? (
              <p className="flex items-center gap-2 px-2.5 py-3 text-[12.5px] text-white/50" role="status">
                <PixelLoader size="sm" /> Loading your repositories…
              </p>
            ) : state.kind === "error" ? (
              <div className="px-2.5 py-3 text-[12.5px] leading-5 text-white/60" role="alert">
                {state.code === "not_connected" || state.code === "token_revoked" ? (
                  <>
                    <p>{state.code === "not_connected" ? "Connect GitHub to choose a repository to review." : state.message}</p>
                    <a
                      href={`/api/github/connect?returnTo=${encodeURIComponent(RETURN_TO)}`}
                      className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11"
                    >
                      <GitHubMark className="size-3.5" aria-hidden="true" /> {state.code === "not_connected" ? "Connect GitHub" : "Reconnect GitHub"}
                    </a>
                  </>
                ) : (
                  <>
                    <p>{state.message}</p>
                    <button
                      type="button"
                      onClick={() => setReload((current) => current + 1)}
                      className="mt-2 inline-flex h-8 items-center rounded-lg border border-white/10 px-3 font-medium text-white/80 hover:bg-white/[0.06] [@media(pointer:coarse)]:h-11"
                    >
                      Try again
                    </button>
                  </>
                )}
              </div>
            ) : repositories.length === 0 ? (
              <p className="px-2.5 py-3 text-[12.5px] text-white/50">
                {state.repositories.length ? `No repositories match “${query.trim()}”.` : "No repositories found on your GitHub account."}
              </p>
            ) : (
              <ul id={listId} role="listbox" aria-label="Your repositories">
                {repositories.map((repo, index) => (
                  <li
                    key={repo.fullName}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={value === repo.fullName}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => choose(repo.fullName)}
                    className={cn(
                      "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-white/75 [@media(pointer:coarse)]:min-h-11",
                      index === activeIndex && "bg-white/[0.07] text-white",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{repo.fullName}</span>
                    {repo.private ? <Lock className="size-3 shrink-0 text-white/40" aria-label="Private" /> : null}
                    {value === repo.fullName ? <Check className="size-3.5 shrink-0 text-[#38bdf8]" aria-hidden="true" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2 text-[11.5px] text-white/40">
            <span>Read-only. Cognix never pushes to it.</span>
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-white/60 hover:text-white"
            >
              Missing one? <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
