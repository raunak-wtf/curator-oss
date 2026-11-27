import type { Metadata } from "next";
import { GitHubResultActions } from "@/components/github-result-actions";
import { GitHubMark } from "@/components/github-mark";
import { safeReturnPath } from "@/lib/github/oauth";

export const metadata: Metadata = { title: "GitHub · Cognix", robots: { index: false } };

type Props = { searchParams: Promise<{ result?: string; returnTo?: string }> };

const RESULTS: Record<string, { tone: "success" | "neutral" | "error"; title: string; body: string }> = {
  connected: {
    tone: "success",
    title: "GitHub connected",
    body: "Cognix can now save your projects to GitHub. Choose a repository in Git Control.",
  },
  installed: {
    tone: "success",
    title: "Cognix is installed on GitHub",
    body: "Your GitHub account is connected and Cognix can reach the repositories you chose.",
  },
  cancelled: {
    tone: "neutral",
    title: "Connection cancelled",
    body: "Nothing changed on GitHub. You can connect any time from Git Control.",
  },
  denied: {
    tone: "error",
    title: "GitHub didn't grant access",
    body: "Cognix needs access to your repositories to commit code. Connect again and approve the requested access.",
  },
  not_configured: {
    tone: "error",
    title: "GitHub isn't set up yet",
    body: "This Cognix server is missing its GitHub settings. Ask the person running Cognix to add them.",
  },
  error: {
    tone: "error",
    title: "GitHub couldn't be connected",
    body: "The sign-in didn't finish. Go back and select Connect GitHub to try again.",
  },
};

export default async function GitHubConnectedPage({ searchParams }: Props) {
  const query = await searchParams;
  const result = RESULTS[query.result ?? ""] ?? RESULTS.error;
  const returnTo = safeReturnPath(query.returnTo);
  const isProject = returnTo.startsWith("/projects/");
  const retryHref = `/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="grid min-h-dvh place-items-center bg-[#191919] px-4 text-white">
      <section aria-labelledby="github-result-title" className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#212121] p-6 text-center shadow-2xl">
        <div className="relative mx-auto size-12">
          <span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            <GitHubMark className="size-6" />
          </span>
          <span
            aria-hidden="true"
            className={
              result.tone === "success"
                ? "absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-[#212121] bg-emerald-500 text-[11px] font-bold text-black"
                : result.tone === "error"
                  ? "absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-[#212121] bg-red-500 text-[11px] font-bold text-white"
                  : "hidden"
            }
          >
            {result.tone === "success" ? "✓" : "!"}
          </span>
        </div>
        <h1 id="github-result-title" className="mt-4 text-[17px] font-semibold tracking-tight">
          {result.title}
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-white/60">{result.body}</p>
        <GitHubResultActions
          returnTo={returnTo}
          label={isProject ? "Back to project" : "Go to home"}
          autoRedirect={result.tone === "success"}
          retryHref={result.tone === "error" && query.result !== "not_configured" ? retryHref : null}
        />
      </section>
    </main>
  );
}
