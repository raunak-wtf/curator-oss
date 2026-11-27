"use client";

import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, ProjectStatus } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";

const statusMeta: Partial<Record<ProjectStatus, { label: string; dot: string; live?: boolean }>> = {
  building: { label: "Building", dot: "bg-emerald-400", live: true },
  publishing: { label: "Publishing", dot: "bg-emerald-400", live: true },
  published: { label: "Published", dot: "bg-emerald-400" },
  error: { label: "Needs attention", dot: "bg-red-400" },
};

const MENU_WIDTH = 168;
const MENU_HEIGHT = 116;
const TITLE_MAX = 120;

type SidebarChatRowProps = {
  project: Project;
  active?: boolean;
  onRename: (project: Project, title: string) => void;
  onDelete: (project: Project) => void;
  onRemix: (project: Project) => void;
};

export function SidebarChatRow({ project, active = false, onRename, onDelete, onRemix }: SidebarChatRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const status = statusMeta[project.status];

  function finishRename(title: string | null) {
    setRenaming(false);
    const next = title?.trim().slice(0, TITLE_MAX);
    if (next && next !== project.title) onRename(project, next);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const meta = (
    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40 tabular-nums">
      {status ? (
        <>
          <span
            className={cn("size-1.5 shrink-0 rounded-full", status.dot, status.live && "animate-pulse motion-reduce:animate-none")}
            aria-hidden="true"
          />
          <span>{status.label}</span>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <time dateTime={project.updatedAt} suppressHydrationWarning>
        {formatRelativeDate(project.updatedAt)}
      </time>
    </span>
  );

  if (renaming) {
    return (
      <li className="rounded-lg bg-white/[0.06] px-1.5 py-1">
        <RenameField initial={project.title} onDone={finishRename} />
        <span className="block px-1">{meta}</span>
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/projects/${project.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "block rounded-lg py-1.5 pl-2.5 pr-10 transition-colors hover:bg-white/[0.06]",
          (menuOpen || active) && "bg-white/[0.06]",
        )}
      >
        <span className="block truncate text-[13px] font-medium text-white/85">{project.title}</span>
        {meta}
      </Link>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={`Options for ${project.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        title="Options"
        className={cn(
          "absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-white/55 transition-opacity hover:bg-white/[0.08] hover:text-white",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          "[@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:opacity-100",
          menuOpen && "bg-white/[0.08] text-white opacity-100",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menuOpen ? (
        <RowMenu
          id={menuId}
          anchor={triggerRef}
          onClose={(restoreFocus) => {
            setMenuOpen(false);
            if (restoreFocus) triggerRef.current?.focus();
          }}
          onRename={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
          onRemix={() => {
            setMenuOpen(false);
            triggerRef.current?.focus();
            onRemix(project);
          }}
          onDelete={() => {
            setMenuOpen(false);
            // Focus the trigger first so the dialog returns focus here when it closes.
            triggerRef.current?.focus();
            onDelete(project);
          }}
        />
      ) : null}
    </li>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function settle(value: string | null) {
    if (settled.current) return;
    settled.current = true;
    onDone(value);
  }

  return (
    <input
      ref={inputRef}
      defaultValue={initial}
      maxLength={TITLE_MAX}
      aria-label="Chat name"
      onBlur={(event) => settle(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settle(null);
        }
      }}
      className="h-7 w-full rounded-md border border-white/20 bg-[#151515] px-1.5 text-[13px] font-medium text-white outline-none focus:border-white/40 [@media(pointer:coarse)]:h-10"
    />
  );
}

type RowMenuProps = {
  id: string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus: boolean) => void;
  onRename: () => void;
  onRemix: () => void;
  onDelete: () => void;
};

function RowMenu({ id, anchor, onClose, onRename, onRemix, onDelete }: RowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Position against the trigger. The menu is portaled so the scrolling chat list cannot clip it.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const rect = anchor.current?.getBoundingClientRect();
    if (!menu || !rect) return;
    const opensUp = rect.bottom + MENU_HEIGHT + 8 > window.innerHeight;
    menu.style.top = `${opensUp ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose(false);
    }
    function onViewportChange() {
      onClose(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [anchor, onClose]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") {
      onClose(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  const item =
    "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium outline-none transition-colors focus-visible:outline-none [@media(pointer:coarse)]:h-11";

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label="Chat options"
      onKeyDown={onKeyDown}
      style={{ width: MENU_WIDTH, top: -9999, left: -9999 }}
      className="fixed z-50 rounded-xl border border-white/10 bg-[#252525] p-1 text-white shadow-2xl"
    >
      <button type="button" role="menuitem" tabIndex={-1} onClick={onRename} className={cn(item, "text-white/85 hover:bg-white/[0.07] focus:bg-white/[0.07]")}>
        <Pencil className="size-3.5" aria-hidden="true" />
        Rename
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={onRemix} className={cn(item, "text-white/85 hover:bg-white/[0.07] focus:bg-white/[0.07]")}>
        <Copy className="size-3.5" aria-hidden="true" />
        Remix
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={onDelete} className={cn(item, "text-red-400 hover:bg-red-500/10 focus:bg-red-500/10")}>
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete
      </button>
    </div>,
    document.body,
  );
}

type DeleteChatDialogProps = {
  project: Project | null;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteChatDialog({ project, deleting, error, onConfirm, onCancel }: DeleteChatDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (project && !dialog.open) dialog.showModal();
    if (!project && dialog.open) dialog.close();
  }, [project]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
      className="m-auto w-[min(400px,calc(100vw-32px))] rounded-xl border border-white/10 bg-[#212121] p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      {project ? (
        <div className="p-5">
          <h2 id={titleId} className="text-[15px] font-semibold">
            Delete chat?
          </h2>
          <p id={descriptionId} className="mt-2 text-[13px] leading-5 text-white/60">
            <span className="font-medium break-words text-white/85">{project.title}</span> will be permanently deleted,
            including its code, preview, uploads{project.publishedAt ? ", and published site" : ""}. This cannot be undone.
          </p>
          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-300">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="h-8 rounded-lg px-3 text-[13px] font-medium text-white/75 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="h-8 rounded-lg bg-red-500 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-red-500/85 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
            >
              {deleting ? "Deleting…" : error ? "Try again" : "Delete"}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
