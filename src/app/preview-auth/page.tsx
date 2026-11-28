import { Lock, ShieldAlert, UserCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PreviewPasscodeForm } from "@/components/preview-passcode-form";
import { getViewer } from "@/lib/auth0";
import { hostnameFromHeader, parseAppsHostname } from "@/lib/domains";
import {
  buildOwnerPreviewFrameUrl,
  isPublicPreviewActive,
  PREVIEW_GUEST_LEASE_MS,
  PREVIEW_OWNER_LEASE_MS,
  signPreviewGrant,
} from "@/lib/preview-access";
import {
  findPreviewShareByEmail,
  findPreviewShareByKey,
  getProjectForEdgePreview,
  recordPreviewShareAccess,
  touchProjectPreviewSession,
} from "@/lib/store";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ host?: string; key?: string; next?: string; mode?: string }>;
};

function sanitizeNext(raw?: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw.slice(0, 500);
}

function isIsoExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.parse(iso) <= Date.now();
}

function shareGrantTtlSeconds(expiresAt: string | null | undefined): number {
  if (!expiresAt) return 12 * 3600;
  return Math.max(300, Math.min(24 * 3600, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
}

export default async function PreviewAuthPage({ searchParams }: Props) {
  const query = await searchParams;
  const host = hostnameFromHeader(query.host);
  const shareKey = query.key?.trim() || "";
  const nextPath = sanitizeNext(query.next);
  const appsMatch = host ? parseAppsHostname(host) : null;

  if (!host || !appsMatch || appsMatch.kind !== "preview") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
        <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
          <h1 className="text-[16px] font-semibold text-white">Preview not found</h1>
          <p className="mt-2 text-[13px] text-white/60">
            This preview link is invalid or the project is no longer available.
          </p>
          <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black">
            Go to Curator
          </Link>
        </div>
      </div>
    );
  }

  const project = await getProjectForEdgePreview({
    slug: appsMatch.slug,
    hex8: appsMatch.hex8,
    projectId: appsMatch.projectId,
  });

  if (!project) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
        <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
          <h1 className="text-[16px] font-semibold text-white">Preview unavailable</h1>
          <p className="mt-2 text-[13px] text-white/60">
            This project preview could not be found or has not been built yet.
          </p>
          <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black">
            Go to Curator
          </Link>
        </div>
      </div>
    );
  }

  const previewOrigin = `https://${host}`;
  const publicActive = isPublicPreviewActive(project.previewAccessMode ?? "owner", project.previewPublicExpiresAt);

  // Public preview with passcode lock (no Curator sign-in required)
  if (publicActive && project.previewHasPasscode && !shareKey && query.mode === "passcode") {
    return <PreviewPasscodeForm host={host} projectTitle={project.title} nextPath={nextPath} />;
  }

  // Public preview without passcode: grant immediately and bounce back
  if (publicActive && !project.previewHasPasscode && !shareKey) {
    redirect(`${previewOrigin}${nextPath}`);
  }

  const viewer = await getViewer();
  const returnParams = new URLSearchParams({ host, next: nextPath });
  if (shareKey) returnParams.set("key", shareKey);
  const selfReturnTo = `/preview-auth?${returnParams.toString()}`;

  if (!viewer) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(selfReturnTo)}`);
  }

  // 1. Project owner (or Curator admin) always gets immediate preview access
  if (viewer.id === project.ownerId || viewer.isAdmin) {
    await touchProjectPreviewSession(project.id, PREVIEW_OWNER_LEASE_MS);
    const grant = signPreviewGrant({
      pid: project.id,
      host,
      role: "owner",
      ver: project.previewAccessVersion ?? 1,
      email: viewer.email,
      ttlSeconds: 12 * 3600,
    });
    redirect(buildOwnerPreviewFrameUrl(previewOrigin, grant, nextPath));
  }

  // 2. Private invite link (`/auth?key={sharing_key}`): verify key AND exact authenticated Curator email!
  if (shareKey) {
    const share = await findPreviewShareByKey(project.id, shareKey);
    if (!share) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
            <div className="flex items-center gap-2.5 text-amber-300">
              <ShieldAlert className="size-5 shrink-0" aria-hidden="true" />
              <h1 className="text-[16px] font-semibold text-white">Invite link revoked or invalid</h1>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
              This private preview link is no longer active. Ask the project owner to generate a new invite link for{" "}
              <strong className="font-medium text-white">{viewer.email}</strong>.
            </p>
            <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black">
              Go to Curator
            </Link>
          </div>
        </div>
      );
    }

    if (isIsoExpired(share.expiresAt)) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
            <div className="flex items-center gap-2.5 text-amber-300">
              <Lock className="size-5 shrink-0" aria-hidden="true" />
              <h1 className="text-[16px] font-semibold text-white">Invite link expired</h1>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
              This preview invitation has expired. Ask the project owner to renew access or publish the app.
            </p>
            <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black">
              Go to Curator
            </Link>
          </div>
        </div>
      );
    }

    if (share.email.toLowerCase() !== viewer.email.trim().toLowerCase()) {
      const switchHref = `/auth/logout?returnTo=${encodeURIComponent(selfReturnTo)}`;
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
            <div className="flex items-center gap-2.5 text-amber-300">
              <UserCheck className="size-5 shrink-0" aria-hidden="true" />
              <h1 className="text-[16px] font-semibold text-white">Signed in with a different email</h1>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
              This private preview link was shared with a different email address. You are currently signed in to Curator as{" "}
              <strong className="font-medium text-white">{viewer.email}</strong>.
            </p>
            <p className="mt-2 text-[12px] text-white/45">
              Sign out and sign back in with the exact invited email address to open this preview.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <a
                href={switchHref}
                className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
              >
                Switch Curator account
              </a>
              <Link
                href="/"
                className="inline-flex h-9 items-center rounded-lg border border-white/15 px-3.5 text-[13px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white"
              >
                Back to Curator
              </Link>
            </div>
          </div>
        </div>
      );
    }

    // Valid invited user with matching Curator email!
    await Promise.all([
      recordPreviewShareAccess(share.id),
      touchProjectPreviewSession(project.id, PREVIEW_GUEST_LEASE_MS),
    ]);
    const ttlSeconds = shareGrantTtlSeconds(share.expiresAt);
    const grant = signPreviewGrant({
      pid: project.id,
      host,
      role: "invited",
      ver: project.previewAccessVersion ?? 1,
      email: viewer.email,
      sid: share.id,
      ttlSeconds,
    });
    redirect(buildOwnerPreviewFrameUrl(previewOrigin, grant, nextPath));
  }

  // 3. Direct preview URL visit without key: allow if this email has an active invite on a private preview
  if (project.previewAccessMode === "private") {
    const emailShare = await findPreviewShareByEmail(project.id, viewer.email);
    if (emailShare && !isIsoExpired(emailShare.expiresAt)) {
      await Promise.all([
        recordPreviewShareAccess(emailShare.id),
        touchProjectPreviewSession(project.id, PREVIEW_GUEST_LEASE_MS),
      ]);
      const grant = signPreviewGrant({
        pid: project.id,
        host,
        role: "invited",
        ver: project.previewAccessVersion ?? 1,
        email: viewer.email,
        sid: emailShare.id,
        ttlSeconds: 12 * 3600,
      });
      redirect(buildOwnerPreviewFrameUrl(previewOrigin, grant, nextPath));
    }
  }

  // 4. Owner-only (or not invited): deny access cleanly
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
      <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
        <div className="flex items-center gap-2.5 text-indigo-300">
          <Lock className="size-5 shrink-0" aria-hidden="true" />
          <h1 className="text-[16px] font-semibold text-white">This preview is private</h1>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
          Only the owner of <strong className="font-medium text-white">{project.title}</strong> (or invited collaborators) can view this preview.
          You are signed in as <strong className="font-medium text-white">{viewer.email}</strong>.
        </p>
        <p className="mt-2 text-[12px] text-white/45">
          Ask the owner to enable a 24-hour public preview, send you a private invite link, or publish the app.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <a
            href={`/auth/logout?returnTo=${encodeURIComponent(selfReturnTo)}`}
            className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90"
          >
            Switch account
          </a>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg border border-white/15 px-3.5 text-[13px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white"
          >
            Go to Curator
          </Link>
        </div>
      </div>
    </div>
  );
}
