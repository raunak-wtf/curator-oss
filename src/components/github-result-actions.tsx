"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REDIRECT_SECONDS = 4;

/** Continue button, with an automatic redirect after a successful connection that the user can stop. */
export function GitHubResultActions({
  returnTo,
  label,
  autoRedirect,
  retryHref,
}: {
  returnTo: string;
  label: string;
  autoRedirect: boolean;
  retryHref: string | null;
}) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(REDIRECT_SECONDS);
  const [cancelled, setCancelled] = useState(false);
  const counting = autoRedirect && !cancelled;

  useEffect(() => {
    if (!counting) return;
    if (seconds <= 0) {
      router.replace(returnTo);
      return;
    }
    const timer = window.setTimeout(() => setSeconds((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [counting, returnTo, router, seconds]);

  const primary =
    "inline-flex h-9 w-full items-center justify-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11";
  const secondary =
    "inline-flex h-9 w-full items-center justify-center rounded-lg border border-white/10 px-4 text-[13px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11";

  return (
    <div className="mt-6 space-y-2">
      {retryHref ? (
        <a href={retryHref} className={primary}>
          Try again
        </a>
      ) : null}
      <a href={returnTo} className={retryHref ? secondary : primary}>
        {label}
      </a>
      {counting ? (
        <p className="pt-1 text-[12px] text-white/45" role="status" aria-live="polite">
          Taking you back in <span className="tabular-nums">{seconds}</span>s.{" "}
          <button type="button" onClick={() => setCancelled(true)} className="font-medium text-white/70 hover:text-white">
            Stay here
          </button>
        </p>
      ) : null}
    </div>
  );
}
