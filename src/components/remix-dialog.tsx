"use client";

import { Copy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";

/** Lovable-style remix: name the copy, optionally include chat history (owners only), and open it. */
export function RemixDialog({
  open,
  projectId,
  projectTitle,
  canIncludeHistory,
  onClose,
}: {
  open: boolean;
  projectId: string;
  projectTitle: string;
  canIncludeHistory: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(`Remix of ${projectTitle}`);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function remix(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, includeHistory }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Couldn't remix this project. Try again.");
      toast.success("Remix created. Cognix is copying the code.");
      router.push(`/projects/${payload.project.id}`);
    } catch (remixError) {
      setError(remixError instanceof Error ? remixError.message : "Couldn't remix this project. Try again.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-white/10 bg-[#212121] p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      {open ? (
        <form onSubmit={(event) => void remix(event)} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-semibold">
              <Copy className="size-4" aria-hidden="true" /> Remix project
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="-mr-2 -mt-1 grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-white/55">
            Creates your own copy of the code. Changes to it never affect the original. Secrets, domains, publishing, and GitHub sync start fresh.
          </p>

          <label htmlFor={nameId} className="mt-4 block text-[12px] font-medium text-white/75">
            Project name
          </label>
          <input
            id={nameId}
            autoFocus
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1.5 h-9 w-full rounded-lg border border-white/[0.12] bg-[#101010] px-3 text-[13px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
          />

          {canIncludeHistory ? (
            <label className="mt-3 flex items-start gap-2.5 text-[13px] text-white/75">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(event) => setIncludeHistory(event.target.checked)}
                className="mt-0.5 size-4 accent-white"
              />
              <span>
                Include chat history
                <span className="block text-[11.5px] text-white/40">Copies the conversation so Cognix keeps its context.</span>
              </span>
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] leading-5 text-red-300">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-8 rounded-lg px-3 text-[13px] font-medium text-white/75 hover:bg-white/[0.07] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-[13px] font-semibold text-black hover:bg-white/85 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
            >
              {busy ? <PixelLoader className="text-black" /> : null}
              {busy ? "Remixing…" : "Remix"}
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
