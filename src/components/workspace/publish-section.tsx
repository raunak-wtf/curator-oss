"use client";

import { CheckCircle2, Copy, ExternalLink, History, RefreshCw, Rocket, SearchCheck, ShieldAlert, Sparkles } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { isReservedPublishSlug } from "@/lib/domains";
import type { Project, PublishCheckIssue, PublishCheckReport } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type PublishSectionProps = {
  project: Project;
  slug: string;
  publishBaseLabel: string;
  publishDomainSuffix?: string;
  publishedAutoStopMinutes?: number;
  publishedUrl: string;
  canPublish: boolean;
  isPublishing: boolean;
  isBuilding: boolean;
  /** The editor has changes since the last publish; the live site still shows the older version. */
  hasUnpublishedChanges: boolean;
  /** Changes when another control (like the toolbar rocket) asks to jump to the address field. */
  focusRequest: number;
  onSlugChange: (slug: string) => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onAskAgent?: (prompt: string) => void;
};

export function PublishSection({
  project,
  slug,
  publishBaseLabel,
  publishDomainSuffix,
  publishedAutoStopMinutes = 0,
  publishedUrl,
  canPublish,
  isPublishing,
  isBuilding,
  hasUnpublishedChanges,
  focusRequest,
  onSlugChange,
  onPublish,
  onUnpublish,
  onAskAgent,
}: PublishSectionProps) {
  const slugId = useId();
  const slugInputRef = useRef<HTMLInputElement>(null);
  const [checkReport, setCheckReport] = useState<PublishCheckReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);

  const loadPublishCheck = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}/publish-check`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not run pre-publish checks.");
    return payload as PublishCheckReport;
  }, [project.id]);

  useEffect(() => {
    let active = true;
    loadPublishCheck()
      .then((report) => {
        if (!active) return;
        setCheckReport(report);
        setCheckError(null);
      })
      .catch((err) => {
        if (!active) return;
        setCheckError(err instanceof Error ? err.message : "Could not run pre-publish checks.");
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [hasUnpublishedChanges, isBuilding, loadPublishCheck]);

  async function rescanPublishChecks() {
    setChecking(true);
    setCheckError(null);
    try {
      setCheckReport(await loadPublishCheck());
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not run pre-publish checks.");
    } finally {
      setChecking(false);
    }
  }
  const publishing = isPublishing || project.status === "publishing";
  const published = Boolean(project.publishedAt);
  const slugFormatValid = slug.length >= 3 && slug.length <= 48 && SLUG_PATTERN.test(slug);
  const slugReserved = Boolean(publishDomainSuffix) && slugFormatValid && isReservedPublishSlug(slug);
  const slugValid = slugFormatValid && !slugReserved;
  const addressChanged = published && project.publishSlug !== null && slug !== project.publishSlug;
  const blockedReason = !canPublish
    ? "Build the app first. Publishing needs a working preview."
    : isBuilding
      ? "Wait for the current build to finish, then publish."
      : null;

  useEffect(() => {
    if (!focusRequest) return;
    const input = slugInputRef.current;
    if (!input) return;
    // Focus without letting the browser scroll every ancestor; scroll only the Cloud page itself.
    input.focus({ preventScroll: true });
    const scroller = input.closest<HTMLElement>(".overflow-y-auto");
    if (scroller) {
      const offset = input.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + offset - scroller.clientHeight / 2 });
    }
  }, [focusRequest]);

  const status = publishing
    ? { label: "Publishing…", detail: "Building the production version. This can take a few minutes.", dot: "bg-sky-400 animate-pulse motion-reduce:animate-none" }
    : published && hasUnpublishedChanges
      ? {
          label: "Published · changes not live yet",
          detail: "The live site still shows the last published version. Select Update to publish the latest changes from the preview.",
          dot: "bg-amber-400",
        }
      : published
        ? { label: "Published · up to date", detail: "The live site matches the current preview.", dot: "bg-emerald-400" }
        : { label: "Not published", detail: "Choose an address below and publish to get a permanent public link.", dot: "bg-white/30" };

  const secondaryButton =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11";

  return (
    <section aria-labelledby="cloud-publish-heading">
          <h2 id="cloud-publish-heading" className="text-lg font-semibold tracking-tight text-white">
            Publish
          </h2>
          <p className="mt-1 text-[13px] text-white/55">Give the latest production build a permanent public address.</p>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02]">
            <div className="flex flex-wrap items-center gap-3 p-4" role="status">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium text-white">
                  <span className={cn("size-2 rounded-full", status.dot)} aria-hidden="true" />
                  {status.label}
                </p>
                {status.detail ? <p className="mt-1 text-[12px] text-white/45">{status.detail}</p> : null}
                {published && project.publishedAt ? (
                  <p className="mt-1 text-[11px] tabular-nums text-white/35">
                    Last published{" "}
                    <time dateTime={project.publishedAt} suppressHydrationWarning>
                      {formatRelativeDate(project.publishedAt)}
                    </time>
                  </p>
                ) : null}
              </div>
              {published && publishedUrl ? (
                <div className="flex min-w-0 max-w-full items-center gap-1.5">
                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate font-mono text-[12px] text-emerald-200/80 hover:text-emerald-100"
                    title={publishedUrl}
                  >
                    {publishedUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(publishedUrl);
                      toast.success("Published link copied.");
                    }}
                    aria-label="Copy published link"
                    title="Copy published link"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open published app in a new tab"
                    title="Open published app"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              ) : null}
            </div>

            <form
              className="border-t border-white/[0.07] p-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (slugValid && !publishing && !blockedReason) onPublish();
              }}
            >
              <label htmlFor={slugId} className="text-[12px] font-medium text-white/75">
                Public address
              </label>
              <div
                className={cn(
                  "mt-1.5 flex h-9 items-center overflow-hidden rounded-lg border bg-[#101010] focus-within:border-white/35 [@media(pointer:coarse)]:h-11",
                  slug && !slugValid ? "border-red-400/60" : "border-white/[0.12]",
                )}
              >
                <span
                  className="flex h-full max-w-[60%] items-center truncate border-r border-white/[0.08] bg-white/[0.03] px-3 font-mono text-[12px] text-white/40"
                  title={publishBaseLabel}
                >
                  {publishBaseLabel}
                </span>
                <input
                  ref={slugInputRef}
                  id={slugId}
                  value={slug}
                  onChange={(event) =>
                    onSlugChange(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, "")
                        .replace(/-+/g, "-")
                        .replace(/^-+/g, ""),
                    )
                  }
                  maxLength={48}
                  placeholder="my-app"
                  disabled={publishing}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(slug) && !slugValid}
                  aria-describedby={`${slugId}-hint`}
                  className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] text-white outline-none placeholder:text-white/30 [&:focus-visible]:outline-none"
                />
                {publishDomainSuffix ? (
                  <span
                    className="flex h-full max-w-[45%] items-center truncate border-l border-white/[0.08] bg-white/[0.03] px-3 font-mono text-[12px] text-white/40"
                    title={publishDomainSuffix}
                  >
                    {publishDomainSuffix}
                  </span>
                ) : null}
              </div>
              <p id={`${slugId}-hint`} className={cn("mt-1 text-[11.5px]", slug && !slugValid ? "text-red-300" : "text-white/40")}>
                {slugReserved
                  ? "That subdomain is reserved. Choose another name."
                  : slug && !slugValid
                  ? "Use 3–48 lowercase letters, numbers, or single hyphens, not starting or ending with a hyphen."
                  : addressChanged
                    ? publishDomainSuffix
                      ? `Updating moves the app from ${project.publishSlug}${publishDomainSuffix} to ${slug}${publishDomainSuffix}.`
                      : `Updating moves the app from /${project.publishSlug} to /${slug}.`
                    : "3–48 lowercase letters, numbers, or hyphens."}
              </p>

              <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-3 text-amber-200/80">
                <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="text-[12px] leading-5 tabular-nums">
                  {publishedAutoStopMinutes > 0 ? (
                    <>
                      <strong className="font-medium text-amber-100">Scale-to-zero enabled.</strong> Publishing builds a separate
                      production release that sleeps after {publishedAutoStopMinutes}m of inactivity and wakes automatically on the next visit.
                    </>
                  ) : (
                    <>
                      <strong className="font-medium text-amber-100">Runs continuously.</strong> Publishing creates a separate production
                      build and turns off sandbox auto-stop, which uses sandbox runtime until you unpublish.
                    </>
                  )}
                </p>
              </div>

              {blockedReason ? <p className="mt-3 text-[12px] text-white/50">{blockedReason}</p> : null}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {published ? (
                  <button
                    type="button"
                    onClick={onUnpublish}
                    disabled={publishing}
                    className="mr-auto inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                  >
                    Unpublish
                  </button>
                ) : null}
                {slug !== (project.publishSlug ?? slug) ? (
                  <button type="button" onClick={() => onSlugChange(project.publishSlug ?? "")} disabled={publishing} className={secondaryButton}>
                    Reset address
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={publishing || !slugValid || Boolean(blockedReason)}
                  className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-[13px] font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                >
                  {publishing ? (
                    <PixelLoader />
                  ) : (
                    <Rocket className="size-3.5" aria-hidden="true" />
                  )}
                  {publishing ? "Building production…" : published ? (hasUnpublishedChanges ? "Update" : "Republish") : "Publish"}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-medium text-white">Pre-publish Security &amp; SEO readiness</h3>
                <p className="mt-0.5 text-[12px] text-white/45">
                  Scans source files for exposed secrets, unprotected API routes, metadata, OpenGraph, and crawler files.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void rescanPublishChecks()}
                disabled={checking}
                className={secondaryButton}
              >
                {checking ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
                Re-scan
              </button>
            </div>

            {checkError ? (
              <div role="alert" className="mt-3 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-[12px] text-red-200">
                <p>{checkError}</p>
                <button
                  type="button"
                  onClick={() => void rescanPublishChecks()}
                  className="mt-2 inline-flex h-7 items-center rounded-md bg-white px-2.5 text-[11.5px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-10"
                >
                  Try again
                </button>
              </div>
            ) : checking && !checkReport ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-white/50">
                <PixelLoader /> <span>Scanning project files…</span>
              </div>
            ) : checkReport ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/[0.07] bg-[#101010] px-3 py-2">
                    <span className="text-[11px] text-white/45">Readiness score</span>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{checkReport.score} / 100</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.07] bg-[#101010] px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-white/45">
                      <ShieldAlert className="size-3" aria-hidden="true" /> Security findings
                    </span>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{checkReport.securityIssues.length}</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.07] bg-[#101010] px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-white/45">
                      <SearchCheck className="size-3" aria-hidden="true" /> SEO &amp; metadata
                    </span>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{checkReport.seoIssues.length}</p>
                  </div>
                </div>

                {checkReport.securityIssues.length === 0 && checkReport.seoIssues.length === 0 ? (
                  <p className="flex items-center gap-2 text-[12px] text-emerald-300">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                    {checkReport.checkedFileCount > 0
                      ? `Checked ${checkReport.checkedFileCount} files — no security or SEO issues detected.`
                      : "Build your app first to run security and SEO checks."}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {[...checkReport.securityIssues, ...checkReport.seoIssues].map((issue: PublishCheckIssue) => (
                        <li
                          key={issue.id}
                          className="rounded-lg border border-white/[0.07] bg-[#101010] p-2.5 text-[12px]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                                issue.severity === "critical"
                                  ? "bg-red-500/15 text-red-300"
                                  : issue.severity === "warning"
                                    ? "bg-amber-400/15 text-amber-200"
                                    : "bg-sky-400/15 text-sky-200",
                              )}
                            >
                              {issue.category} · {issue.severity}
                            </span>
                            <span className="font-medium text-white/90">{issue.title}</span>
                            {issue.file ? (
                              <code className="ml-auto font-mono text-[11px] text-white/45">
                                {issue.file}
                                {issue.line ? `:${issue.line}` : ""}
                              </code>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11.5px] leading-5 text-white/55">{issue.fixHint}</p>
                        </li>
                      ))}
                    </ul>

                    {onAskAgent ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const items = [...checkReport.securityIssues, ...checkReport.seoIssues]
                              .map((issue) => `- [${issue.category.toUpperCase()} / ${issue.severity}] ${issue.title}: ${issue.fixHint}`)
                              .join("\n");
                            onAskAgent(`Fix these pre-publish Security and SEO findings:\n\n${items}`);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11"
                        >
                          <Sparkles className="size-3.5" aria-hidden="true" />
                          Fix issues with Cognix
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
    </section>
  );
}
