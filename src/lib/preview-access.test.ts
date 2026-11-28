import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOwnerPreviewFrameUrl,
  buildPrivateShareUrl,
  createPreviewShareKey,
  hashPreviewPasscode,
  isPublicPreviewActive,
  signPreviewGrant,
  verifyPreviewGrant,
  verifyPreviewPasscode,
} from "./preview-access";
import {
  clearProjectPreviewSession,
  createOrUpdateProjectPreviewShare,
  createProject,
  ensureUser,
  findPreviewShareByKey,
  getProject,
  getProjectPreviewAccessState,
  getProjectPreviewLeaseStatus,
  revokeAllProjectPreviewShares,
  revokeProjectPreviewShare,
  touchProjectPreviewSession,
  updateProjectPreviewAccess,
  verifyProjectPreviewPasscode,
} from "./store";

describe("preview access tokens and passcodes", () => {
  beforeEach(() => {
    vi.stubEnv("COGNIX_EDGE_SECRET", "test-preview-signing-secret-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs and verifies host-bound HMAC preview grants and rejects tampering or wrong hosts", () => {
    const token = signPreviewGrant({
      pid: "proj-1",
      host: "golden-delta-60b6e4dc.curatorsite.in",
      role: "invited",
      ver: 3,
      email: "Reviewer@Example.com",
      sid: "share-42",
      ttlSeconds: 3600,
    });

    const verified = verifyPreviewGrant(token, "golden-delta-60b6e4dc.curatorsite.in");
    expect(verified).toMatchObject({
      pid: "proj-1",
      host: "golden-delta-60b6e4dc.curatorsite.in",
      role: "invited",
      ver: 3,
      email: "reviewer@example.com",
      sid: "share-42",
    });

    // Rejects different host
    expect(verifyPreviewGrant(token, "other-host-60b6e4dc.curatorsite.in")).toBeNull();

    // Rejects tampered payload or signature
    const parts = token.split(".");
    const flippedFirst = parts[2].startsWith("A") ? "B" : "A";
    const tampered = `${parts[0]}.${parts[1]}.${flippedFirst}${parts[2].slice(1)}`;
    expect(verifyPreviewGrant(tampered, "golden-delta-60b6e4dc.curatorsite.in")).toBeNull();

    // Rejects expired token
    const expired = signPreviewGrant({
      pid: "proj-1",
      host: "golden-delta-60b6e4dc.curatorsite.in",
      role: "owner",
      ver: 1,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    expect(verifyPreviewGrant(expired, "golden-delta-60b6e4dc.curatorsite.in")).toBeNull();
  });

  it("hashes and verifies preview passcodes with scrypt", () => {
    const hash = hashPreviewPasscode("secret-demo-2026");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(verifyPreviewPasscode("secret-demo-2026", hash)).toBe(true);
    expect(verifyPreviewPasscode("wrong-passcode", hash)).toBe(false);
    expect(verifyPreviewPasscode("secret-demo-2026", null)).toBe(false);
  });

  it("evaluates 24h public preview expiry and builds /auth?key=... and owner frame URLs", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isPublicPreviewActive("public", future)).toBe(true);
    expect(isPublicPreviewActive("public", past)).toBe(false);
    expect(isPublicPreviewActive("owner", future)).toBe(false);

    const shareKey = createPreviewShareKey();
    expect(shareKey.length).toBeGreaterThanOrEqual(24);
    expect(buildPrivateShareUrl("https://golden-delta-60b6e4dc.curatorsite.in/dashboard", shareKey)).toBe(
      `https://golden-delta-60b6e4dc.curatorsite.in/auth?key=${encodeURIComponent(shareKey)}`,
    );
    expect(buildOwnerPreviewFrameUrl("https://golden-delta-60b6e4dc.curatorsite.in", "cg1.abc.def", "/settings")).toBe(
      "https://golden-delta-60b6e4dc.curatorsite.in/settings?__cognix_preview_grant=cg1.abc.def",
    );
  });
});

describe("preview access store lifecycle (memory store)", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("manages 24h public toggle, passcode, email invites, version bumps on revoke, and presence leases", async () => {
    const owner = {
      id: "owner-preview-test",
      email: "owner@curator.codes",
      emailVerified: true,
      name: "Owner",
    };
    await ensureUser(owner);
    const project = await createProject(owner, "Secured Preview App");

    // Defaults to owner-only
    const initial = await getProjectPreviewAccessState(project);
    expect(initial.mode).toBe("owner");
    expect(initial.publicActive).toBe(false);
    expect(initial.shares).toEqual([]);

    // Enable 24h public preview with passcode
    const updatedPub = await updateProjectPreviewAccess(project.id, owner.id, {
      mode: "public",
      publicDurationHours: 24,
      passcode: "4321",
    });
    expect(updatedPub).not.toBeNull();
    const pubState = await getProjectPreviewAccessState(updatedPub!);
    expect(pubState.mode).toBe("public");
    expect(pubState.publicActive).toBe(true);
    expect(pubState.hasPasscode).toBe(true);
    expect(await verifyProjectPreviewPasscode(project.id, "4321")).toBe(true);
    expect(await verifyProjectPreviewPasscode(project.id, "9999")).toBe(false);

    // Create private email share
    const share = await createOrUpdateProjectPreviewShare({
      projectId: project.id,
      ownerId: owner.id,
      email: "Teammate@Studio.io",
      expiresInHours: 24,
    });
    expect(share.email).toBe("teammate@studio.io");

    const found = await findPreviewShareByKey(project.id, share.shareKey);
    expect(found?.id).toBe(share.id);

    // Revoking a share bumps accessVersion
    const beforeProject = (await getProject(project.id, owner.id))!;
    const versionBefore = beforeProject.previewAccessVersion ?? 1;
    const revoked = await revokeProjectPreviewShare(project.id, owner.id, share.id);
    expect(revoked).toBe(true);
    const afterProject = (await getProject(project.id, owner.id))!;
    const afterRevoke = await getProjectPreviewAccessState(afterProject);
    expect(afterRevoke.accessVersion).toBe(versionBefore + 1);
    expect(afterRevoke.shares).toHaveLength(0);

    // Revoke all resets to owner-only and clears passcode
    await revokeAllProjectPreviewShares(project.id, owner.id);
    const resetProject = (await getProject(project.id, owner.id))!;
    const resetState = await getProjectPreviewAccessState(resetProject);
    expect(resetState.mode).toBe("owner");
    expect(resetState.publicActive).toBe(false);
    expect(resetState.hasPasscode).toBe(false);

    // Presence lease touch & clear
    await touchProjectPreviewSession(project.id, 60_000);
    const leaseActive = await getProjectPreviewLeaseStatus(project.id);
    expect(leaseActive).not.toBeNull();
    expect(Date.parse(leaseActive!)).toBeGreaterThan(Date.now());

    await clearProjectPreviewSession(project.id, owner.id);
    const leaseCleared = await getProjectPreviewLeaseStatus(project.id);
    expect(leaseCleared).toBeNull();
  });
});
