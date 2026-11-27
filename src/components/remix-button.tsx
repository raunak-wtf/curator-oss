"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { RemixDialog } from "@/components/remix-dialog";

export function RemixButton({
  projectId,
  projectTitle,
  signedIn,
  canIncludeHistory,
}: {
  projectId: string;
  projectTitle: string;
  signedIn: boolean;
  canIncludeHistory: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!signedIn) {
            window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
            return;
          }
          setOpen(true);
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11"
      >
        <Copy className="size-3.5" aria-hidden="true" /> {signedIn ? "Remix" : "Sign in to remix"}
      </button>
      <RemixDialog open={open} projectId={projectId} projectTitle={projectTitle} canIncludeHistory={canIncludeHistory} onClose={() => setOpen(false)} />
    </>
  );
}
