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
  sanitizeRelativePath,
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
  const nextPath = sanitizeRelativePath(query.next);
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
  const viewer = await getViewer();

  // 1. Project owner (or verified Curator admin) always gets immediate preview access without passcode prompts.
  if (viewer && (viewer.id === project.ownerId || viewer.isAdmin)) {
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

  // 2. Public preview with passcode lock (no Curator sign-in required for guests)
  if (publicActive && project.previewHasPasscode && !shareKey) {
    const returnParams = new URLSearchParams({ host, next: nextPath });
    const ownerSignInHref = `/auth/login?returnTo=${encodeURIComponent(`/preview-auth?${returnParams.toString()}`)}`;
    return (
      <PreviewPasscodeForm
        host={host}
        projectTitle={project.title}
        nextPath={nextPath}
        ownerSignInHref={!viewer ? ownerSignInHref : undefined}
      />
    );
  }

  // 3. Public preview without passcode: touch guest session and bounce back cleanly
  if (publicActive && !project.previewHasPasscode && !shareKey) {
    await touchProjectPreviewSession(project.id, PREVIEW_GUEST_LEASE_MS);
    redirect(`${previewOrigin}${nextPath}`);
  }

  const returnParams = new URLSearchParams({ host, next: nextPath });
  if (shareKey) returnParams.set("key", shareKey);
  const selfReturnTo = `/preview-auth?${returnParams.toString()}`;

  if (!viewer) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(selfReturnTo)}`);
  }

  // Require verified email before matching any private email invitation to block unverified-email impersonation.
  if (!viewer.emailVerified) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
        <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
          <div className="flex items-center gap-2.5 text-amber-300">
            <ShieldAlert className="size-5 shrink-0" aria-hidden="true" />
            <h1 className="text-[16px] font-semibold text-white">Verify your email to view this preview</h1>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
            Your Curator account (<strong className="font-medium text-white">{viewer.email}</strong>) has not verified its email address yet.
            Verify your email or sign in with a verified social account to open private previews.
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
              Back to Curator
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 4. Private invite link (`/auth?key={sharing_key}`): verify key AND exact verified Curator email
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

  // 5. Direct preview URL visit without key: allow if this verified email has an active invite and mode is not locked to owner-only
  if (project.previewAccessMode !== "owner") {
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
        ttlSeconds: shareGrantTtlSeconds(emailShare.expiresAt),
      });
      redirect(buildOwnerPreviewFrameUrl(previewOrigin, grant, nextPath));
    }
  }

  // 6. Owner-only (or not invited): deny access cleanly
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
