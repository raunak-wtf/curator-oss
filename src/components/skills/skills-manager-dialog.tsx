"use client";

import { GitBranch, PencilLine, Trash2, Wand2, X } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import { useEffect, useId, useRef, useState } from "react";
import type { Skill, SkillSource } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

const sourceLabels: Record<SkillSource, string> = { ai: "AI", github: "GitHub", manual: "Manual" };

type SkillsManagerDialogProps = {
  open: boolean;
  skills: Skill[];
  status: "idle" | "loading" | "ready" | "error";
  onClose: () => void;
  onRetryLoad: () => void;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => Promise<void>;
  /** Puts a slash command into the composer so the user can finish it. */
  onStartCommand: (command: "create-skill" | "install-skill") => void;
  onWriteManually: () => void;
};

export function SkillsManagerDialog({
  open,
  skills,
  status,
  onClose,
  onRetryLoad,
  onEdit,
  onDelete,
  onStartCommand,
  onWriteManually,
}: SkillsManagerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function confirmDelete(skill: Skill) {
    setDeletingId(skill.id);
    setDeleteError(null);
    try {
      await onDelete(skill);
      setConfirmingId(null);
    } catch (error) {
      setDeleteError({ id: skill.id, message: error instanceof Error ? error.message : "Could not delete the skill." });
    } finally {
      setDeletingId(null);
    }
  }

  function close() {
    setConfirmingId(null);
    setDeleteError(null);
    onClose();
  }

  const actionButton =
    "flex h-8 items-center gap-2 rounded-lg border border-white/10 px-2.5 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11";
  const iconButton =
    "flex size-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-xl border border-white/10 bg-[#212121] p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-34px)] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] py-2 pl-5 pr-2">
            <h2 id={titleId} className="text-[15px] font-semibold">
              Skills
            </h2>
            <button type="button" onClick={close} aria-label="Close" className={iconButton}>
              <X className="size-4" />
            </button>
          </header>

          <div className="shrink-0 border-b border-white/[0.06] px-5 py-3">
            <p className="text-[12px] leading-5 text-white/50">
              Use a skill by typing <kbd className="font-mono text-white/75">/name</kbd> in any prompt. Add one:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onStartCommand("create-skill")} className={actionButton}>
                <Wand2 className="size-3.5" aria-hidden="true" /> Ask AI
              </button>
              <button type="button" onClick={() => onStartCommand("install-skill")} className={actionButton}>
                <GitBranch className="size-3.5" aria-hidden="true" /> From GitHub
              </button>
              <button type="button" onClick={onWriteManually} className={actionButton}>
                <PencilLine className="size-3.5" aria-hidden="true" /> Write one
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {status === "loading" ? (
              <p className="flex items-center gap-2 px-3 py-6 text-[13px] text-white/50" role="status">
                <PixelLoader /> Loading your skills…
              </p>
            ) : status === "error" ? (
              <div className="px-3 py-6 text-[13px] text-white/55">
                <p>Could not load your skills.</p>
                <button type="button" onClick={onRetryLoad} className="mt-1 font-medium text-white/85 hover:text-white">
                  Try again
                </button>
              </div>
            ) : skills.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-[13px] font-medium text-white/80">No skills yet</p>
                <p className="mt-1 text-[12px] leading-5 text-white/45">
                  Try <kbd className="font-mono text-white/70">/create-skill</kbd> in the prompt, or use one of the buttons above.
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {skills.map((skill) => (
                  <li key={skill.id} className="rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                    {confirmingId === skill.id ? (
                      <div>
                        <p className="text-[13px] text-white/80">
                          Delete <span className="font-mono text-white">/{skill.name}</span>? Prompts that use it will stop applying it.
                        </p>
                        {deleteError?.id === skill.id ? (
                          <p role="alert" className="mt-1.5 text-[12px] text-red-300">
                            {deleteError.message}
                          </p>
                        ) : null}
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            disabled={deletingId === skill.id}
                            className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-white/75 hover:bg-white/[0.07] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void confirmDelete(skill)}
                            disabled={deletingId === skill.id}
                            className="h-8 rounded-lg bg-red-500 px-3 text-[12.5px] font-semibold text-white hover:bg-red-500/85 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
                          >
                            {deletingId === skill.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-[13px] text-white">/{skill.name}</span>
                            <span className="shrink-0 rounded-full bg-white/[0.07] px-1.5 py-px text-[10.5px] font-medium text-white/55">
                              {sourceLabels[skill.source]}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-white/50">{skill.description}</p>
                          <p className="mt-0.5 text-[11px] text-white/35 tabular-nums">
                            Updated{" "}
                            <time dateTime={skill.updatedAt} suppressHydrationWarning>
                              {formatRelativeDate(skill.updatedAt)}
                            </time>
                          </p>
                        </div>
                        <button type="button" onClick={() => onEdit(skill)} aria-label={`Edit /${skill.name}`} title="Edit" className={iconButton}>
                          <PencilLine className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmingId(skill.id);
                          }}
                          aria-label={`Delete /${skill.name}`}
                          title="Delete"
                          className={`${iconButton} hover:text-red-300`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
