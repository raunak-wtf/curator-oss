"use client";

import { KeyRound, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function PreviewPasscodeForm({
  host,
  projectTitle,
  nextPath,
  ownerSignInHref,
}: {
  host: string;
  projectTitle: string;
  nextPath: string;
  ownerSignInHref?: string;
}) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/preview-auth/passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, passcode: passcode.trim(), next: nextPath }),
      });
      const payload = await res.json();
      if (!res.ok || typeof payload.redirectUrl !== "string") {
        throw new Error(payload.error ?? "Could not unlock preview.");
      }
      window.location.href = payload.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock preview.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
      <div className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-white">{projectTitle}</h1>
            <p className="text-[12px] text-white/50">Passcode-protected preview</p>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-3.5">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-white/80">Enter preview passcode</span>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/40" aria-hidden="true" />
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoFocus
                required
                placeholder="Passcode"
                className="h-10 w-full rounded-lg border border-white/15 bg-[#151515] pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff]"
              />
            </div>
          </label>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !passcode.trim()}
            className="h-10 w-full rounded-lg bg-white text-[13px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {submitting ? "Unlocking…" : "Unlock preview"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3 text-[12px] text-white/55">
          {ownerSignInHref ? (
            <a href={ownerSignInHref} className="hover:text-white">
              Sign in as owner
            </a>
          ) : (
            <span />
          )}
          <Link href="/" className="hover:text-white">
            Go to Curator
          </Link>
        </div>
      </div>
    </div>
  );
}
