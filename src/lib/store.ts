import { encryptSecret, decryptSecret } from './secrets-crypto';
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import * as dbModule from "./db";
const { db } = dbModule;
export const isDatabaseConfigured = Boolean(dbModule.isDatabaseConfigured);
import {
  agentApprovals,
  agentRunMetrics,
  attachments,
  billingWebhookEvents,
  creditUsageEvents,
  githubConnections,
  messages,
  projectAnalyticsEvents,
  projectConsoleLogs,
  projectDomains,
  projectFiles,
  projectPreviewShares,
  projectRepositories,
  projects,
  users,
  userSubscriptions,
  projectSecrets,
  projectCloud,
  skills,
} from "./db/schema";
import {
  PRO_MAX_ROLLOVER_CREDITS_HUNDREDTHS,
  PRO_MONTHLY_CREDITS_HUNDREDTHS,
  PRO_PLAN_CODE,
  PRO_PLAN_CURRENCY,
  PRO_PLAN_PRICE_CENTS,
} from "./credits";
import { previewSlugForProjectId } from "./domains";
import { isAdminEmail } from "./identity";
import {
  createPreviewShareKey,
  hashPreviewPasscode,
  isPublicPreviewActive,
  normalizeInviteEmail,
  verifyPreviewPasscode,
} from "./preview-access";
import { SKILLS_PER_ACCOUNT, SkillRequestError } from "./skills";
import type {
  AdminOverviewStats,
  AdminUserSummary,
  AgentApprovalDecision,
  AgentApprovalItem,
  AgentApprovalRequest,
  AgentRunMetric,
  AgentRunMetricStatus,
  AgentRunPerformance,
  AnalyticsDevice,
  AnalyticsEventRecord,
  Attachment,
  AuthMethod,
  CreditComplexityTier,
  CreditUsageEvent,
  Message,
  MessageRole,
  Project,
  ProjectAnalyticsSummary,
  ProjectDomain,
  ProjectDomainStatus,
  ProjectFile,
  ProjectStatus,
  SubscriptionStatus,
  UserSubscription,
  Viewer,
  ProjectSecret,
  ProjectCloud,
  ProjectCloudStatus,
  Skill,
  SkillSource,
  GitHubConnection,
  ProjectRepository,
  ProjectMode,
  RepositoryCache,
  SecuritySource,
  PreviewAccessMode,
  PreviewAccessState,
  PreviewConsoleEntry,
  PreviewConsoleInput,
  PreviewConsoleLevel,
  PreviewConsoleSource,
  ProjectPreviewShare,
} from "./types";
import {
  PREVIEW_CONSOLE_MAX_ENTRIES,
  computeConsoleFingerprint,
  isIgnorableConsoleError,
  redactConsoleSecrets,
} from "./preview-console";
import { titleFromPrompt } from "./utils";

/** Plain token values. Expiry fields are null for OAuth App tokens, which do not expire. */
type GitHubTokens = {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
};
export type GitHubTokenRecord = GitHubTokens;

type StoredGitHubTokens = {
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenExpiresAt: Date | null;
  refreshCiphertext: string | null;
  refreshIv: string | null;
  refreshAuthTag: string | null;
  refreshExpiresAt: Date | null;
};

type MemoryUser = {
  id: string;
  email: string;
  emailVerified?: boolean;
  name: string | null;
  avatarUrl: string | null;
  authProvider: string;
  authProviderLabel: string;
  authMethod: AuthMethod;
  authSubject: string | null;
  createdAt: string;
  lastSeenAt: string;
};

type MemoryStore = {
  users?: MemoryUser[];
  subscriptions?: UserSubscription[];
  creditUsageEvents?: CreditUsageEvent[];
  agentRunMetrics?: AgentRunMetric[];
  webhookEvents?: Set<string>;
  projects: Project[];
  messages: Message[];
  files: ProjectFile[];
  attachments: Attachment[];
  domains: ProjectDomain[];
  secrets: (ProjectSecret & { ciphertext: string; iv: string; authTag: string })[];
  clouds: ProjectCloud[];
  skills: Skill[];
  githubConnections: (GitHubConnection & StoredGitHubTokens)[];
  repositories: ProjectRepository[];
  repositoryCache: Map<string, RepositoryCache>;
  analyticsEvents?: (AnalyticsEventRecord & { id: string; createdAt: string })[];
  consoleLogs?: PreviewConsoleEntry[];
  previewShares?: (ProjectPreviewShare & { ownerId: string })[];
  previewPasscodeHashes?: Map<string, string | null>;
};

declare global {
  var __cognixMemoryStore: MemoryStore | undefined;
}

const memory =
  globalThis.__cognixMemoryStore ??
  (globalThis.__cognixMemoryStore = {
    projects: [],
    messages: [],
    files: [],
    attachments: [],
    domains: [],
    secrets: [],
    clouds: [],
    skills: [],
    githubConnections: [],
    repositories: [],
    repositoryCache: new Map<string, RepositoryCache>(),
    analyticsEvents: [],
  });

// Keeps development sessions working when an older in-memory store is reused after a reload.
memory.users ??= [];
memory.subscriptions ??= [];
memory.creditUsageEvents ??= [];
memory.agentRunMetrics ??= [];
memory.webhookEvents ??= new Set<string>();
memory.domains ??= [];
memory.repositoryCache ??= new Map();
memory.secrets ??= [];
memory.clouds ??= [];
memory.skills ??= [];
memory.githubConnections ??= [];
memory.repositories ??= [];
memory.analyticsEvents ??= [];
memory.consoleLogs ??= [];
memory.previewShares ??= [];
memory.previewPasscodeHashes ??= new Map<string, string | null>();

function mapProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    status: row.status as ProjectStatus,
    coverGradient: row.coverGradient,
    sandboxId: row.sandboxId,
    previewUrl: row.previewUrl,
    publishSlug: row.publishSlug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    showBadge: row.showBadge,
    publicRemix: row.publicRemix,
    previewAccessMode:
      row.previewAccessMode === "public" || row.previewAccessMode === "private"
        ? row.previewAccessMode
        : "owner",
    previewPublicExpiresAt: row.previewPublicExpiresAt?.toISOString() ?? null,
    previewHasPasscode: Boolean(row.previewPasscodeHash),
    previewAccessVersion: row.previewAccessVersion ?? 1,
    previewActiveUntil: row.previewActiveUntil?.toISOString() ?? null,
    customInstructions: row.customInstructions ?? "",
    mode: row.mode === "security" ? "security" : "build",
    securitySource: row.securitySource ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    projectId: row.projectId,
    role: row.role as MessageRole,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapFile(row: typeof projectFiles.$inferSelect): ProjectFile {
  return {
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    content: row.content,
    size: row.size,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapDomain(row: typeof projectDomains.$inferSelect): ProjectDomain {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    hostname: row.hostname,
    status: row.status as ProjectDomainStatus,
    verificationToken: row.verificationToken,
    managedByProvider: row.managedByProvider,
    lastError: row.lastError,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAttachment(row: typeof attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    objectKey: row.objectKey,
    sandboxPath: row.sandboxPath,
    createdAt: row.createdAt.toISOString(),
  };
}

const ENSURE_USER_TTL_MS = 2 * 60_000;
const recentEnsuredUsers = new Map<string, number>();

export async function ensureUser(viewer: Viewer) {
  const now = new Date();
  const emailVerified = Boolean(viewer.emailVerified);
  const authProvider = viewer.authProvider || "unknown";
  const authProviderLabel = viewer.authProviderLabel || "Unknown";
  const authMethod: AuthMethod = viewer.authMethod || "oauth";
  const authSubject = viewer.authSubject ?? null;

  if (!db) {
    memory.users ??= [];
    const existing = memory.users.find((item) => item.id === viewer.id);
    if (existing) {
      existing.email = viewer.email;
      existing.emailVerified = emailVerified;
      existing.name = viewer.name;
      existing.avatarUrl = viewer.picture ?? null;
      if (authProvider !== "unknown") {
        existing.authProvider = authProvider;
        existing.authProviderLabel = authProviderLabel;
        existing.authMethod = authMethod;
      }
      if (authSubject) existing.authSubject = authSubject;
      existing.lastSeenAt = now.toISOString();
    } else {
      memory.users.push({
        id: viewer.id,
        email: viewer.email,
        emailVerified,
        name: viewer.name,
        avatarUrl: viewer.picture ?? null,
        authProvider,
        authProviderLabel,
        authMethod,
        authSubject,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
      });
    }
    return;
  }

  const cacheKey = `${viewer.id}:${emailVerified ? "1" : "0"}:${authSubject ?? ""}:${viewer.email.toLowerCase()}`;
  const cachedUntil = recentEnsuredUsers.get(cacheKey);
  if (cachedUntil && cachedUntil > now.getTime()) {
    return;
  }

  await db
    .insert(users)
    .values({
      id: viewer.id,
      email: viewer.email,
      emailVerified,
      name: viewer.name,
      avatarUrl: viewer.picture,
      authProvider,
      authProviderLabel,
      authMethod,
      authSubject,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: viewer.email,
        emailVerified,
        name: viewer.name,
        avatarUrl: viewer.picture,
        ...(authProvider !== "unknown"
          ? {
              authProvider,
              authProviderLabel,
              authMethod,
            }
          : {}),
        ...(authSubject ? { authSubject } : {}),
        lastSeenAt: now,
        updatedAt: now,
      },
    });

  if (recentEnsuredUsers.size >= 2_000) {
    const oldestKey = recentEnsuredUsers.keys().next().value;
    if (oldestKey) recentEnsuredUsers.delete(oldestKey);
  }
  recentEnsuredUsers.set(cacheKey, now.getTime() + ENSURE_USER_TTL_MS);

  if (!emailVerified) return;
  const normalizedEmail = viewer.email.trim().toLowerCase();
  const legacyIdentities = await db
    .select({
      id: users.id,
      emailVerified: users.emailVerified,
      authSubject: users.authSubject,
    })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${normalizedEmail}`, ne(users.id, viewer.id)));

  for (const identity of legacyIdentities) {
    // Only merge previously verified identities or the exact same Auth0 subject after email verification,
    // preventing third-party unverified account injection.
    const canSafelyMerge =
      identity.emailVerified ||
      identity.id.startsWith("account|") ||
      (authSubject !== null && identity.authSubject === authSubject);
    if (!canSafelyMerge) continue;

    await Promise.all([
      db.update(projects).set({ ownerId: viewer.id }).where(eq(projects.ownerId, identity.id)),
      db.update(attachments).set({ ownerId: viewer.id }).where(eq(attachments.ownerId, identity.id)),
      db.update(creditUsageEvents).set({ userId: viewer.id }).where(eq(creditUsageEvents.userId, identity.id)),
      db.update(projectDomains).set({ ownerId: viewer.id }).where(eq(projectDomains.ownerId, identity.id)),
      db.update(projectRepositories).set({ ownerId: viewer.id }).where(eq(projectRepositories.ownerId, identity.id)),
      db.update(projectPreviewShares).set({ ownerId: viewer.id }).where(eq(projectPreviewShares.ownerId, identity.id)),
      db.update(agentApprovals).set({ ownerId: viewer.id }).where(eq(agentApprovals.ownerId, identity.id)),
    ]);

    // Migrate skills without failing on duplicate `(owner_id, name)` constraints.
    const [canonicalSkills, legacySkills] = await Promise.all([
      db.select({ name: skills.name }).from(skills).where(eq(skills.ownerId, viewer.id)),
      db.select({ id: skills.id, name: skills.name }).from(skills).where(eq(skills.ownerId, identity.id)),
    ]);
    const existingNames = new Set(canonicalSkills.map((s) => s.name));
    for (const sk of legacySkills) {
      if (!existingNames.has(sk.name)) {
        await db.update(skills).set({ ownerId: viewer.id }).where(eq(skills.id, sk.id));
        existingNames.add(sk.name);
      }
    }

    // Preserve GitHub connection if the canonical account does not have one yet.
    const [existingGh] = await db
      .select({ ownerId: githubConnections.ownerId })
      .from(githubConnections)
      .where(eq(githubConnections.ownerId, viewer.id))
      .limit(1);
    if (!existingGh) {
      await db.update(githubConnections).set({ ownerId: viewer.id }).where(eq(githubConnections.ownerId, identity.id));
    }

    // Merge subscriptions without losing paid Dodo subscriptions or remaining credits.
    const [[canonicalSub], [legacySub]] = await Promise.all([
      db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, viewer.id)).limit(1),
      db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, identity.id)).limit(1),
    ]);
    if (legacySub && !canonicalSub) {
      await db.update(userSubscriptions).set({ userId: viewer.id }).where(eq(userSubscriptions.userId, identity.id));
    } else if (legacySub && canonicalSub) {
      const preferLegacyStatus = canonicalSub.status === "inactive" && legacySub.status !== "inactive";
      await db.delete(userSubscriptions).where(eq(userSubscriptions.userId, identity.id));
      await db
        .update(userSubscriptions)
        .set({
          status: preferLegacyStatus ? legacySub.status : canonicalSub.status,
          dodoCustomerId: canonicalSub.dodoCustomerId ?? legacySub.dodoCustomerId,
          dodoSubscriptionId: canonicalSub.dodoSubscriptionId ?? legacySub.dodoSubscriptionId,
          dodoProductId: canonicalSub.dodoProductId ?? legacySub.dodoProductId,
          creditsBalanceHundredths: canonicalSub.creditsBalanceHundredths + legacySub.creditsBalanceHundredths,
          lifetimeCreditsUsedHundredths:
            canonicalSub.lifetimeCreditsUsedHundredths + legacySub.lifetimeCreditsUsedHundredths,
          currentPeriodStart: canonicalSub.currentPeriodStart ?? legacySub.currentPeriodStart,
          currentPeriodEnd: canonicalSub.currentPeriodEnd ?? legacySub.currentPeriodEnd,
          updatedAt: now,
        })
        .where(eq(userSubscriptions.userId, viewer.id));
    }

    await db.delete(users).where(eq(users.id, identity.id));
  }
}

export async function listProjects(ownerId: string): Promise<Project[]> {
  if (!db) {
    return memory.projects
      .filter((project) => project.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return (await db.select().from(projects).where(eq(projects.ownerId, ownerId)).orderBy(desc(projects.updatedAt))).map(
    mapProject,
  );
}

export async function getProject(id: string, ownerId: string): Promise<Project | null> {
  if (!db) {
    return memory.projects.find((project) => project.id === id && project.ownerId === ownerId) ?? null;
  }
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .limit(1);
  return row ? mapProject(row) : null;
}

/**
 * Loads a project for remixing: the owner always, anyone else only when public remixing is on.
 * Never use this for editing; it ignores ownership on purpose.
 */
export async function getRemixableProject(id: string, viewerId: string | null): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const project = !db
    ? memory.projects.find((item) => item.id === id) ?? null
    : await db.select().from(projects).where(eq(projects.id, id)).limit(1).then(([row]) => (row ? mapProject(row) : null));
  if (!project) return null;
  return project.ownerId === viewerId || project.publicRemix ? project : null;
}

export async function getUserName(id: string): Promise<string | null> {
  if (!db) return null;
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return row?.name ?? null;
}

export async function getProjectByPublishSlug(slug: string): Promise<Project | null> {
  if (!db) {
    return memory.projects.find((project) => project.publishSlug === slug) ?? null;
  }
  const [row] = await db.select().from(projects).where(eq(projects.publishSlug, slug)).limit(1);
  return row ? mapProject(row) : null;
}

export async function getPublishedProject(slug: string): Promise<Project | null> {
  const project = await getProjectByPublishSlug(slug);
  return project?.publishedAt ? project : null;
}

export async function createProject(
  viewer: Viewer,
  prompt: string,
  options: { mode?: ProjectMode; securitySource?: SecuritySource | null; title?: string } = {},
): Promise<Project> {
  await ensureUser(viewer);
  const now = new Date();
  const gradients = ["aurora", "ember", "violet", "cloud"];
  const project: Project = {
    id: crypto.randomUUID(),
    ownerId: viewer.id,
    title: options.title ?? titleFromPrompt(prompt),
    description: prompt.trim().slice(0, 240),
    status: "draft",
    coverGradient: gradients[Math.floor(Math.random() * gradients.length)],
    sandboxId: null,
    previewUrl: null,
    publishSlug: null,
    publishedAt: null,
    showBadge: true,
    publicRemix: false,
    customInstructions: "",
    mode: options.mode ?? "build",
    securitySource: options.securitySource ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  if (!db) {
    memory.projects.unshift(project);
    return project;
  }

  const [row] = await db
    .insert(projects)
    .values({
      ownerId: project.ownerId,
      title: project.title,
      description: project.description,
      status: project.status,
      coverGradient: project.coverGradient,
      mode: project.mode,
      securitySource: project.securitySource,
    })
    .returning();
  return mapProject(row);
}

export async function updateProject(
  id: string,
  ownerId: string,
  patch: Partial<
    Pick<
      Project,
      "title" | "description" | "status" | "sandboxId" | "previewUrl" | "publishSlug" | "publishedAt" | "showBadge" | "publicRemix" | "customInstructions" | "securitySource"
    >
  >,
): Promise<Project | null> {
  if (!db) {
    const index = memory.projects.findIndex((project) => project.id === id && project.ownerId === ownerId);
    if (index < 0) return null;
    memory.projects[index] = {
      ...memory.projects[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return memory.projects[index];
  }

  const { publishedAt, ...databasePatch } = patch;
  const [row] = await db
    .update(projects)
    .set({
      ...databasePatch,
      ...(publishedAt !== undefined
        ? { publishedAt: publishedAt ? new Date(publishedAt) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .returning();
  return row ? mapProject(row) : null;
}

export async function listMessages(projectId: string): Promise<Message[]> {
  if (!db) {
    return memory.messages
      .filter((message) => message.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return (await db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt))).map(
    mapMessage,
  );
}

export async function createMessage(
  projectId: string,
  role: MessageRole,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<Message> {
  if (!db) {
    const message: Message = {
      id: crypto.randomUUID(),
      projectId,
      role,
      content,
      metadata,
      createdAt: new Date().toISOString(),
    };
    memory.messages.push(message);
    return message;
  }
  const [row] = await db.insert(messages).values({ projectId, role, content, metadata }).returning();
  return mapMessage(row);
}

export async function getMessage(id: string, projectId: string): Promise<Message | null> {
  if (!db) {
    return memory.messages.find((message) => message.id === id && message.projectId === projectId) ?? null;
  }
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.projectId, projectId)))
    .limit(1);
  return row ? mapMessage(row) : null;
}

export async function updateMessageMetadata(
  id: string,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<Message | null> {
  const current = await getMessage(id, projectId);
  if (!current) return null;
  const metadata = { ...current.metadata, ...patch };
  if (!db) {
    const index = memory.messages.findIndex((message) => message.id === id && message.projectId === projectId);
    if (index < 0) return null;
    memory.messages[index] = { ...memory.messages[index], metadata };
    return memory.messages[index];
  }
  const [row] = await db
    .update(messages)
    .set({ metadata })
    .where(and(eq(messages.id, id), eq(messages.projectId, projectId)))
    .returning();
  return row ? mapMessage(row) : null;
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  if (!db) {
    return memory.files.filter((file) => file.projectId === projectId).sort((a, b) => a.path.localeCompare(b.path));
  }
  return (await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(asc(projectFiles.path))).map(
    mapFile,
  );
}

export async function upsertProjectFile(projectId: string, path: string, content: string): Promise<ProjectFile> {
  const now = new Date();
  if (!db) {
    const index = memory.files.findIndex((file) => file.projectId === projectId && file.path === path);
    const file: ProjectFile = {
      id: index >= 0 ? memory.files[index].id : crypto.randomUUID(),
      projectId,
      path,
      content,
      size: Buffer.byteLength(content),
      updatedAt: now.toISOString(),
    };
    if (index >= 0) memory.files[index] = file;
    else memory.files.push(file);
    return file;
  }
  const [row] = await db
    .insert(projectFiles)
    .values({ projectId, path, content, size: Buffer.byteLength(content) })
    .onConflictDoUpdate({
      target: [projectFiles.projectId, projectFiles.path],
      set: { content, size: Buffer.byteLength(content), updatedAt: now },
    })
    .returning();
  return mapFile(row);
}

export async function deleteProjectFile(projectId: string, path: string) {
  if (!db) {
    memory.files = memory.files.filter((file) => file.projectId !== projectId || file.path !== path);
    return;
  }
  await db.delete(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));
}

export async function createAttachment(input: Omit<Attachment, "id" | "createdAt">): Promise<Attachment> {
  if (!db) {
    const attachment = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    memory.attachments.push(attachment);
    return attachment;
  }
  const [row] = await db.insert(attachments).values(input).returning();
  return mapAttachment(row);
}

export async function getAttachment(id: string, ownerId: string): Promise<Attachment | null> {
  if (!db) {
    return memory.attachments.find((item) => item.id === id && item.ownerId === ownerId) ?? null;
  }
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.ownerId, ownerId)))
    .limit(1);
  return row ? mapAttachment(row) : null;
}

export async function listProjectAttachmentKeys(projectId: string): Promise<string[]> {
  if (!db) {
    return memory.attachments.filter((item) => item.projectId === projectId).map((item) => item.objectKey);
  }
  const rows = await db.select({ objectKey: attachments.objectKey }).from(attachments).where(eq(attachments.projectId, projectId));
  return rows.map((row) => row.objectKey);
}

/** Deletes a project and, through cascades, its messages, files, attachments, domains, secrets, and cloud settings. */
export async function deleteProject(id: string, ownerId: string): Promise<boolean> {
  if (!db) {
    const before = memory.projects.length;
    memory.projects = memory.projects.filter((project) => project.id !== id || project.ownerId !== ownerId);
    if (memory.projects.length === before) return false;
    memory.messages = memory.messages.filter((item) => item.projectId !== id);
    memory.files = memory.files.filter((item) => item.projectId !== id);
    memory.attachments = memory.attachments.filter((item) => item.projectId !== id);
    memory.domains = memory.domains.filter((item) => item.projectId !== id);
    memory.secrets = memory.secrets.filter((item) => item.projectId !== id);
    memory.clouds = memory.clouds.filter((item) => item.projectId !== id);
    memory.repositories = memory.repositories.filter((item) => item.projectId !== id);
    memory.consoleLogs = (memory.consoleLogs ?? []).filter((item) => item.projectId !== id);
    memory.analyticsEvents = (memory.analyticsEvents ?? []).filter((item) => item.projectId !== id);
    memory.previewShares = (memory.previewShares ?? []).filter((item) => item.projectId !== id);
    memory.previewPasscodeHashes?.delete(id);
    memory.repositoryCache?.delete(id);
    return true;
  }
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .returning({ id: projects.id });
  return deleted.length > 0;
}

export async function updateAttachmentSandboxPath(id: string, sandboxPath: string): Promise<Attachment | null> {
  if (!db) {
    const index = memory.attachments.findIndex((item) => item.id === id);
    if (index < 0) return null;
    memory.attachments[index] = { ...memory.attachments[index], sandboxPath };
    return memory.attachments[index];
  }
  const [row] = await db.update(attachments).set({ sandboxPath }).where(eq(attachments.id, id)).returning();
  return row ? mapAttachment(row) : null;
}

export async function listProjectDomains(projectId: string): Promise<ProjectDomain[]> {
  if (!db) {
    return memory.domains
      .filter((domain) => domain.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return (
    await db
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, projectId))
      .orderBy(asc(projectDomains.createdAt))
  ).map(mapDomain);
}

export async function getProjectDomain(id: string, projectId: string): Promise<ProjectDomain | null> {
  if (!db) {
    return memory.domains.find((domain) => domain.id === id && domain.projectId === projectId) ?? null;
  }
  const [row] = await db
    .select()
    .from(projectDomains)
    .where(and(eq(projectDomains.id, id), eq(projectDomains.projectId, projectId)))
    .limit(1);
  return row ? mapDomain(row) : null;
}

export async function getProjectDomainByHostname(hostname: string): Promise<ProjectDomain | null> {
  if (!db) {
    return memory.domains.find((domain) => domain.hostname === hostname) ?? null;
  }
  const [row] = await db.select().from(projectDomains).where(eq(projectDomains.hostname, hostname)).limit(1);
  return row ? mapDomain(row) : null;
}

export async function createProjectDomain(input: {
  projectId: string;
  ownerId: string;
  hostname: string;
  verificationToken: string;
  managedByProvider?: boolean;
}): Promise<ProjectDomain> {
  const now = new Date().toISOString();
  if (!db) {
    const domain: ProjectDomain = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      ownerId: input.ownerId,
      hostname: input.hostname,
      status: "pending",
      verificationToken: input.verificationToken,
      managedByProvider: input.managedByProvider ?? false,
      lastError: null,
      verifiedAt: null,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memory.domains.push(domain);
    return domain;
  }
  const [row] = await db
    .insert(projectDomains)
    .values({
      projectId: input.projectId,
      ownerId: input.ownerId,
      hostname: input.hostname,
      verificationToken: input.verificationToken,
      managedByProvider: input.managedByProvider ?? false,
    })
    .returning();
  return mapDomain(row);
}

export async function updateProjectDomain(
  id: string,
  patch: Partial<
    Pick<ProjectDomain, "status" | "lastError" | "verifiedAt" | "lastCheckedAt" | "managedByProvider">
  >,
): Promise<ProjectDomain | null> {
  if (!db) {
    const index = memory.domains.findIndex((domain) => domain.id === id);
    if (index < 0) return null;
    memory.domains[index] = {
      ...memory.domains[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return memory.domains[index];
  }
  const { verifiedAt, lastCheckedAt, ...databasePatch } = patch;
  const [row] = await db
    .update(projectDomains)
    .set({
      ...databasePatch,
      ...(verifiedAt !== undefined ? { verifiedAt: verifiedAt ? new Date(verifiedAt) : null } : {}),
      ...(lastCheckedAt !== undefined ? { lastCheckedAt: lastCheckedAt ? new Date(lastCheckedAt) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projectDomains.id, id))
    .returning();
  return row ? mapDomain(row) : null;
}

export async function deleteProjectDomain(id: string, projectId: string): Promise<boolean> {
  if (!db) {
    const before = memory.domains.length;
    memory.domains = memory.domains.filter((domain) => domain.id !== id || domain.projectId !== projectId);
    return memory.domains.length < before;
  }
  const removed = await db
    .delete(projectDomains)
    .where(and(eq(projectDomains.id, id), eq(projectDomains.projectId, projectId)))
    .returning();
  return removed.length > 0;
}

export async function getPublishedProjectByHostname(
  hostname: string,
): Promise<{ project: Project; domain: ProjectDomain } | null> {
  const domain = await getProjectDomainByHostname(hostname);
  if (!domain || domain.status !== "active") return null;
  const project = await getProjectById(domain.projectId);
  if (!project?.publishedAt) return null;
  return { project, domain };
}

export async function getProjectForEdgePreview(lookup: {
  slug: string;
  hex8?: string;
  projectId?: string;
}): Promise<Project | null> {
  if (lookup.projectId) {
    const project = await getProjectById(lookup.projectId);
    if (!project || project.mode === "security" || !project.sandboxId) return null;
    return project;
  }
  if (!lookup.hex8) return null;
  if (!db) {
    const match = memory.projects.find(
      (project) =>
        project.id.toLowerCase().startsWith(`${lookup.hex8}-`) &&
        previewSlugForProjectId(project.id) === lookup.slug,
    );
    if (!match || match.mode === "security" || !match.sandboxId) return null;
    return match;
  }
  const lowUuid = `${lookup.hex8}-0000-0000-0000-000000000000`;
  const highUuid = `${lookup.hex8}-ffff-ffff-ffff-ffffffffffff`;
  const rows = await db
    .select()
    .from(projects)
    .where(and(gte(projects.id, lowUuid), lte(projects.id, highUuid)))
    .limit(5);
  const mapped = rows.map(mapProject).find((project) => previewSlugForProjectId(project.id) === lookup.slug);
  if (!mapped || mapped.mode === "security" || !mapped.sandboxId) return null;
  return mapped;
}

export async function hasRegisteredDomain(hostname: string): Promise<boolean> {
  return Boolean(await getProjectDomainByHostname(hostname));
}

async function getProjectById(id: string): Promise<Project | null> {
  if (!db) {
    return memory.projects.find((project) => project.id === id) ?? null;
  }
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ? mapProject(row) : null;
}


function mapSecret(row: typeof projectSecrets.$inferSelect): ProjectSecret {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    managedBy: row.managedBy as "user" | "cloud",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapCloud(row: typeof projectCloud.$inferSelect): ProjectCloud {
  return {
    projectId: row.projectId,
    status: row.status as ProjectCloudStatus,
    neonProjectId: row.neonProjectId,
    neonRegion: row.neonRegion,
    storageEnabled: row.storageEnabled,
    appTokenHash: row.appTokenHash,
    authEnabled: row.authEnabled,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSecretNames(projectId: string): Promise<ProjectSecret[]> {
  if (!db) {
    return memory.secrets
      .filter((s) => s.projectId === projectId)
      .map((s) => ({ id: s.id, projectId: s.projectId, name: s.name, managedBy: s.managedBy, updatedAt: s.updatedAt } as ProjectSecret))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const rows = await db.select().from(projectSecrets).where(eq(projectSecrets.projectId, projectId));
  return rows.map(mapSecret).sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertSecret(projectId: string, name: string, value: string, managedBy: "user" | "cloud" = "user"): Promise<ProjectSecret> {
  const encrypted = encryptSecret(value);
  const now = new Date();
  
  if (!db) {
    const existingIdx = memory.secrets.findIndex(s => s.projectId === projectId && s.name === name);
    if (existingIdx >= 0) {
      memory.secrets[existingIdx] = {
        ...memory.secrets[existingIdx],
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        managedBy,
        updatedAt: now.toISOString(),
      };
      const rest = { id: memory.secrets[existingIdx].id, projectId: memory.secrets[existingIdx].projectId, name: memory.secrets[existingIdx].name, managedBy: memory.secrets[existingIdx].managedBy, updatedAt: memory.secrets[existingIdx].updatedAt };
      return rest as ProjectSecret;
    } else {
      const newSecret = {
        id: crypto.randomUUID(),
        projectId,
        name,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        managedBy,
        updatedAt: now.toISOString(),
      };
      memory.secrets.push(newSecret);
      const rest = { id: newSecret.id, projectId: newSecret.projectId, name: newSecret.name, managedBy: newSecret.managedBy, updatedAt: newSecret.updatedAt };
      return rest as ProjectSecret;
    }
  }

  const [row] = await db.insert(projectSecrets).values({
    projectId,
    name,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    managedBy,
  }).onConflictDoUpdate({
    target: [projectSecrets.projectId, projectSecrets.name],
    set: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      managedBy,
      updatedAt: now,
    }
  }).returning();

  return mapSecret(row);
}

export async function deleteSecret(projectId: string, name: string): Promise<boolean> {
  if (!db) {
    const before = memory.secrets.length;
    memory.secrets = memory.secrets.filter(s => !(s.projectId === projectId && s.name === name));
    return memory.secrets.length < before;
  }
  const removed = await db.delete(projectSecrets).where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.name, name))).returning();
  return removed.length > 0;
}

export async function getDecryptedSecrets(projectId: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!db) {
    for (const secret of memory.secrets.filter(s => s.projectId === projectId)) {
      try {
        result[secret.name] = decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag });
      } catch (e) {
        console.error(`Failed to decrypt secret ${secret.name}`, e);
      }
    }
    return result;
  }
  
  const rows = await db.select().from(projectSecrets).where(eq(projectSecrets.projectId, projectId));
  for (const row of rows) {
    try {
      result[row.name] = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    } catch (e) {
      console.error(`Failed to decrypt secret ${row.name}`, e);
    }
  }
  return result;
}

export async function getProjectCloud(projectId: string): Promise<ProjectCloud | null> {
  if (!db) {
    return memory.clouds.find(c => c.projectId === projectId) ?? null;
  }
  const [row] = await db.select().from(projectCloud).where(eq(projectCloud.projectId, projectId)).limit(1);
  return row ? mapCloud(row) : null;
}

export async function updateProjectCloud(projectId: string, patch: Partial<Omit<ProjectCloud, "projectId" | "createdAt" | "updatedAt">>): Promise<ProjectCloud> {
  const now = new Date();
  
  if (!db) {
    const existingIdx = memory.clouds.findIndex(c => c.projectId === projectId);
    if (existingIdx >= 0) {
      memory.clouds[existingIdx] = {
        ...memory.clouds[existingIdx],
        ...patch,
        updatedAt: now.toISOString(),
      };
      return memory.clouds[existingIdx];
    } else {
      const newCloud: ProjectCloud = {
        projectId,
        status: patch.status ?? "disabled",
        neonProjectId: patch.neonProjectId ?? null,
        neonRegion: patch.neonRegion ?? null,
        storageEnabled: patch.storageEnabled ?? false,
        appTokenHash: patch.appTokenHash ?? null,
        authEnabled: patch.authEnabled ?? false,
        lastError: patch.lastError ?? null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      memory.clouds.push(newCloud);
      return newCloud;
    }
  }

  const [row] = await db.insert(projectCloud).values({
    projectId,
    status: patch.status ?? "disabled",
    neonProjectId: patch.neonProjectId,
    neonRegion: patch.neonRegion,
    storageEnabled: patch.storageEnabled ?? false,
    appTokenHash: patch.appTokenHash,
    authEnabled: patch.authEnabled ?? false,
    lastError: patch.lastError,
  }).onConflictDoUpdate({
    target: [projectCloud.projectId],
    set: {
      ...patch,
      updatedAt: now,
    }
  }).returning();

  return mapCloud(row);
}

function mapSkill(row: typeof skills.$inferSelect): Skill {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    body: row.body,
    source: row.source as SkillSource,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SkillInput = Pick<Skill, "name" | "description" | "body" | "source" | "sourceUrl">;

function duplicateSkillError(name: string) {
  return new SkillRequestError(`You already have a skill named /${name}. Choose another name or edit the existing skill.`, 409);
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "23505";
}

export async function listSkills(ownerId: string): Promise<Skill[]> {
  if (!db) {
    return memory.skills.filter((skill) => skill.ownerId === ownerId).sort((a, b) => a.name.localeCompare(b.name));
  }
  return (await db.select().from(skills).where(eq(skills.ownerId, ownerId)).orderBy(asc(skills.name))).map(mapSkill);
}

export async function getSkillsByNames(ownerId: string, names: string[]): Promise<Skill[]> {
  if (!names.length) return [];
  const owned = await listSkills(ownerId);
  // Keep the order the prompt mentioned them in.
  return names.flatMap((name) => owned.filter((skill) => skill.name === name));
}

export async function createSkill(ownerId: string, input: SkillInput): Promise<Skill> {
  if (!db) {
    const owned = memory.skills.filter((skill) => skill.ownerId === ownerId);
    if (owned.some((skill) => skill.name === input.name)) throw duplicateSkillError(input.name);
    if (owned.length >= SKILLS_PER_ACCOUNT) {
      throw new SkillRequestError(`You can save up to ${SKILLS_PER_ACCOUNT} skills. Delete one with /skills, then try again.`, 409);
    }
    const now = new Date().toISOString();
    const skill: Skill = { ...input, id: crypto.randomUUID(), ownerId, createdAt: now, updatedAt: now };
    memory.skills.push(skill);
    return skill;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(skills).where(eq(skills.ownerId, ownerId));
  if (count >= SKILLS_PER_ACCOUNT) {
    throw new SkillRequestError(`You can save up to ${SKILLS_PER_ACCOUNT} skills. Delete one with /skills, then try again.`, 409);
  }
  try {
    const [row] = await db.insert(skills).values({ ...input, ownerId }).returning();
    return mapSkill(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSkillError(input.name);
    throw error;
  }
}

export async function updateSkill(
  id: string,
  ownerId: string,
  patch: Pick<Skill, "name" | "description" | "body">,
): Promise<Skill | null> {
  if (!db) {
    const index = memory.skills.findIndex((skill) => skill.id === id && skill.ownerId === ownerId);
    if (index < 0) return null;
    if (memory.skills.some((skill) => skill.ownerId === ownerId && skill.name === patch.name && skill.id !== id)) {
      throw duplicateSkillError(patch.name);
    }
    memory.skills[index] = { ...memory.skills[index], ...patch, updatedAt: new Date().toISOString() };
    return memory.skills[index];
  }
  try {
    const [row] = await db
      .update(skills)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.ownerId, ownerId)))
      .returning();
    return row ? mapSkill(row) : null;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSkillError(patch.name);
    throw error;
  }
}

export async function deleteSkill(id: string, ownerId: string): Promise<boolean> {
  if (!db) {
    const before = memory.skills.length;
    memory.skills = memory.skills.filter((skill) => skill.id !== id || skill.ownerId !== ownerId);
    return memory.skills.length < before;
  }
  const removed = await db
    .delete(skills)
    .where(and(eq(skills.id, id), eq(skills.ownerId, ownerId)))
    .returning({ id: skills.id });
  return removed.length > 0;
}

// ── GitHub ──────────────────────────────────────────────────────────────

function mapGitHubConnection(row: typeof githubConnections.$inferSelect): GitHubConnection {
  return {
    ownerId: row.ownerId,
    githubUserId: row.githubUserId,
    login: row.login,
    avatarUrl: row.avatarUrl,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRepository(row: typeof projectRepositories.$inferSelect): ProjectRepository {
  return {
    projectId: row.projectId,
    ownerId: row.ownerId,
    repoId: row.repoId,
    fullName: row.fullName,
    htmlUrl: row.htmlUrl,
    defaultBranch: row.defaultBranch,
    private: row.private,
    autoCommit: row.autoCommit,
    syncBaseSha: row.syncBaseSha,
    syncedPaths: row.syncedPaths,
    lastCommitSha: row.lastCommitSha,
    lastCommitUrl: row.lastCommitUrl,
    lastPushedAt: row.lastPushedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGitHubConnection(ownerId: string): Promise<GitHubConnection | null> {
  if (!db) {
    const found = memory.githubConnections.find((item) => item.ownerId === ownerId);
    if (!found) return null;
    return {
      ownerId: found.ownerId,
      githubUserId: found.githubUserId,
      login: found.login,
      avatarUrl: found.avatarUrl,
      scopes: found.scopes,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    };
  }
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.ownerId, ownerId)).limit(1);
  return row ? mapGitHubConnection(row) : null;
}

/** Server-only: the decrypted token record. Never send it to a browser, a log, or a sandbox. */
export async function getGitHubTokenRecord(ownerId: string): Promise<GitHubTokenRecord | null> {
  const row = !db
    ? memory.githubConnections.find((item) => item.ownerId === ownerId)
    : (await db.select().from(githubConnections).where(eq(githubConnections.ownerId, ownerId)).limit(1))[0];
  if (!row) return null;
  const toIso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
  return {
    accessToken: decryptSecret({ ciphertext: row.tokenCiphertext, iv: row.tokenIv, authTag: row.tokenAuthTag }),
    expiresAt: toIso(row.tokenExpiresAt),
    refreshToken:
      row.refreshCiphertext && row.refreshIv && row.refreshAuthTag
        ? decryptSecret({ ciphertext: row.refreshCiphertext, iv: row.refreshIv, authTag: row.refreshAuthTag })
        : null,
    refreshExpiresAt: toIso(row.refreshExpiresAt),
  };
}

/** Server-only: returns the decrypted access token as stored, without refreshing it. */
export async function getGitHubAccessToken(ownerId: string): Promise<string | null> {
  return (await getGitHubTokenRecord(ownerId))?.accessToken ?? null;
}

function encryptedTokenFields(tokens: GitHubTokens) {
  const access = encryptSecret(tokens.accessToken);
  const refresh = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;
  return {
    tokenCiphertext: access.ciphertext,
    tokenIv: access.iv,
    tokenAuthTag: access.authTag,
    tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    refreshCiphertext: refresh?.ciphertext ?? null,
    refreshIv: refresh?.iv ?? null,
    refreshAuthTag: refresh?.authTag ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ? new Date(tokens.refreshExpiresAt) : null,
  };
}

/** Replaces the stored tokens after a refresh. GitHub refresh tokens are single-use, so this must run every time. */
export async function updateGitHubTokens(ownerId: string, tokens: GitHubTokens) {
  const fields = encryptedTokenFields(tokens);
  if (!db) {
    const index = memory.githubConnections.findIndex((item) => item.ownerId === ownerId);
    if (index >= 0) memory.githubConnections[index] = { ...memory.githubConnections[index], ...fields, updatedAt: new Date().toISOString() };
    return;
  }
  await db.update(githubConnections).set({ ...fields, updatedAt: new Date() }).where(eq(githubConnections.ownerId, ownerId));
}

export async function saveGitHubConnection(
  ownerId: string,
  input: { githubUserId: string; login: string; avatarUrl: string | null; scopes: string } & GitHubTokens,
): Promise<GitHubConnection> {
  const now = new Date();
  const fields = {
    githubUserId: input.githubUserId,
    login: input.login,
    avatarUrl: input.avatarUrl,
    scopes: input.scopes,
    ...encryptedTokenFields(input),
  };
  if (!db) {
    const index = memory.githubConnections.findIndex((item) => item.ownerId === ownerId);
    const record = {
      ownerId,
      ...fields,
      createdAt: index >= 0 ? memory.githubConnections[index].createdAt : now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (index >= 0) memory.githubConnections[index] = record;
    else memory.githubConnections.push(record);
    return (await getGitHubConnection(ownerId))!;
  }
  const [row] = await db
    .insert(githubConnections)
    .values({ ownerId, ...fields })
    .onConflictDoUpdate({ target: githubConnections.ownerId, set: { ...fields, updatedAt: now } })
    .returning();
  return mapGitHubConnection(row);
}

export async function deleteGitHubConnection(ownerId: string): Promise<boolean> {
  if (!db) {
    const before = memory.githubConnections.length;
    memory.githubConnections = memory.githubConnections.filter((item) => item.ownerId !== ownerId);
    return memory.githubConnections.length < before;
  }
  const removed = await db.delete(githubConnections).where(eq(githubConnections.ownerId, ownerId)).returning({ ownerId: githubConnections.ownerId });
  return removed.length > 0;
}

export async function getProjectRepository(projectId: string, ownerId: string): Promise<ProjectRepository | null> {
  if (!db) {
    return memory.repositories.find((item) => item.projectId === projectId && item.ownerId === ownerId) ?? null;
  }
  const [row] = await db
    .select()
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.ownerId, ownerId)))
    .limit(1);
  return row ? mapRepository(row) : null;
}

export async function linkProjectRepository(
  input: Pick<ProjectRepository, "projectId" | "ownerId" | "repoId" | "fullName" | "htmlUrl" | "defaultBranch" | "private" | "syncBaseSha">,
): Promise<ProjectRepository> {
  const now = new Date();
  if (!db) {
    memory.repositories = memory.repositories.filter((item) => item.projectId !== input.projectId);
    const record: ProjectRepository = {
      ...input,
      autoCommit: true,
      syncedPaths: [],
      lastCommitSha: null,
      lastCommitUrl: null,
      lastPushedAt: null,
      lastError: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memory.repositories.push(record);
    return record;
  }
  const reset = { syncedPaths: [] as string[], lastCommitSha: null, lastCommitUrl: null, lastPushedAt: null, lastError: null, autoCommit: true };
  const [row] = await db
    .insert(projectRepositories)
    .values({ ...input, ...reset })
    .onConflictDoUpdate({ target: projectRepositories.projectId, set: { ...input, ...reset, createdAt: now, updatedAt: now } })
    .returning();
  return mapRepository(row);
}

export async function updateProjectRepository(
  projectId: string,
  ownerId: string,
  patch: Partial<
    Pick<ProjectRepository, "autoCommit" | "syncBaseSha" | "syncedPaths" | "lastCommitSha" | "lastCommitUrl" | "lastPushedAt" | "lastError" | "defaultBranch" | "fullName" | "htmlUrl" | "private">
  >,
): Promise<ProjectRepository | null> {
  if (!db) {
    const index = memory.repositories.findIndex((item) => item.projectId === projectId && item.ownerId === ownerId);
    if (index < 0) return null;
    memory.repositories[index] = { ...memory.repositories[index], ...patch, updatedAt: new Date().toISOString() };
    return memory.repositories[index];
  }
  const { lastPushedAt, ...rest } = patch;
  const [row] = await db
    .update(projectRepositories)
    .set({
      ...rest,
      ...(lastPushedAt !== undefined ? { lastPushedAt: lastPushedAt ? new Date(lastPushedAt) : null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.ownerId, ownerId)))
    .returning();
  return row ? mapRepository(row) : null;
}

export async function unlinkProjectRepository(projectId: string, ownerId: string): Promise<boolean> {
  memory.repositoryCache.delete(projectId);
  if (!db) {
    const before = memory.repositories.length;
    memory.repositories = memory.repositories.filter((item) => item.projectId !== projectId || item.ownerId !== ownerId);
    return memory.repositories.length < before;
  }
  const removed = await db
    .delete(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.ownerId, ownerId)))
    .returning({ projectId: projectRepositories.projectId });
  return removed.length > 0;
}

/** Git details saved from the last GitHub fetch. Null when no repository is linked. */
export async function getRepositoryCache(projectId: string, ownerId: string): Promise<RepositoryCache | null> {
  if (!db) {
    const linked = memory.repositories.some((item) => item.projectId === projectId && item.ownerId === ownerId);
    return linked ? memory.repositoryCache.get(projectId) ?? { sync: null, commits: null, commitsFetchedAt: null } : null;
  }
  const [row] = await db
    .select({
      sync: projectRepositories.cachedSync,
      commits: projectRepositories.cachedCommits,
      commitsFetchedAt: projectRepositories.commitsFetchedAt,
    })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.ownerId, ownerId)))
    .limit(1);
  if (!row) return null;
  return { sync: row.sync ?? null, commits: row.commits ?? null, commitsFetchedAt: row.commitsFetchedAt?.toISOString() ?? null };
}

/** Saves the latest sync status and/or commit list. `commitsFetchedAt: null` marks the commits out of date. */
export async function saveRepositoryCache(projectId: string, ownerId: string, patch: Partial<RepositoryCache>) {
  if (!db) {
    const current = memory.repositoryCache.get(projectId) ?? { sync: null, commits: null, commitsFetchedAt: null };
    memory.repositoryCache.set(projectId, { ...current, ...patch });
    return;
  }
  const set: Partial<typeof projectRepositories.$inferInsert> = {};
  if (patch.sync !== undefined) set.cachedSync = patch.sync;
  if (patch.commits !== undefined) set.cachedCommits = patch.commits;
  if (patch.commitsFetchedAt !== undefined) set.commitsFetchedAt = patch.commitsFetchedAt ? new Date(patch.commitsFetchedAt) : null;
  if (!Object.keys(set).length) return;
  // Leaves updatedAt alone: the cache isn't a change to the link itself.
  await db
    .update(projectRepositories)
    .set(set)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.ownerId, ownerId)));
}

// ── Agent approvals (Request review mode) ───────────────────────────────

const memoryApprovals = new Map<string, { projectId: string; ownerId: string; items: AgentApprovalItem[]; decisions: AgentApprovalDecision[] | null; status: "pending" | "resolved" | "expired"; createdAt: string }>();

export async function createAgentApproval(projectId: string, ownerId: string, items: AgentApprovalItem[]): Promise<AgentApprovalRequest> {
  if (!db) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    memoryApprovals.set(id, { projectId, ownerId, items, decisions: null, status: "pending", createdAt });
    return { id, items, createdAt };
  }
  const [row] = await db.insert(agentApprovals).values({ projectId, ownerId, items }).returning();
  return { id: row.id, items: row.items, createdAt: row.createdAt.toISOString() };
}

/** The user's decisions, or null while the request is still pending. */
export async function getAgentApprovalDecisions(id: string): Promise<AgentApprovalDecision[] | null> {
  if (!db) {
    const found = memoryApprovals.get(id);
    return found?.status === "resolved" ? found.decisions : null;
  }
  const [row] = await db
    .select({ status: agentApprovals.status, decisions: agentApprovals.decisions })
    .from(agentApprovals)
    .where(eq(agentApprovals.id, id))
    .limit(1);
  return row?.status === "resolved" ? row.decisions ?? [] : null;
}

/** Records the owner's answer. Returns false if the request doesn't exist, isn't theirs, or was already answered. */
export async function resolveAgentApproval(id: string, projectId: string, ownerId: string, decisions: AgentApprovalDecision[]) {
  if (!db) {
    const found = memoryApprovals.get(id);
    if (!found || found.projectId !== projectId || found.ownerId !== ownerId || found.status !== "pending") return false;
    memoryApprovals.set(id, { ...found, decisions, status: "resolved" });
    return true;
  }
  const updated = await db
    .update(agentApprovals)
    .set({ decisions, status: "resolved", resolvedAt: new Date() })
    .where(and(eq(agentApprovals.id, id), eq(agentApprovals.projectId, projectId), eq(agentApprovals.ownerId, ownerId), eq(agentApprovals.status, "pending")))
    .returning({ id: agentApprovals.id });
  return updated.length > 0;
}

/** Marks an unanswered request as expired, so a late answer can't be applied to a finished run. */
export async function expireAgentApproval(id: string) {
  if (!db) {
    const found = memoryApprovals.get(id);
    if (found?.status === "pending") memoryApprovals.set(id, { ...found, status: "expired" });
    return;
  }
  await db.update(agentApprovals).set({ status: "expired", resolvedAt: new Date() }).where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "pending")));
}

/** The newest still-pending request for a project, so a reloaded page can show it again. */
export async function getPendingAgentApproval(projectId: string, ownerId: string): Promise<AgentApprovalRequest | null> {
  if (!db) {
    const found = [...memoryApprovals.entries()].reverse().find(([, item]) => item.projectId === projectId && item.ownerId === ownerId && item.status === "pending");
    return found ? { id: found[0], items: found[1].items, createdAt: found[1].createdAt } : null;
  }
  const [row] = await db
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.projectId, projectId), eq(agentApprovals.ownerId, ownerId), eq(agentApprovals.status, "pending")))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(1);
  return row ? { id: row.id, items: row.items, createdAt: row.createdAt.toISOString() } : null;
}


export async function recordProjectAnalyticsEvents(events: AnalyticsEventRecord[]): Promise<number> {
  if (!events.length) return 0;
  const sanitized = events.slice(0, 100).map((event) => ({
    projectId: event.projectId,
    hostname: event.hostname.slice(0, 255).toLowerCase(),
    path: (event.path.startsWith("/") ? event.path : `/${event.path}`).slice(0, 400),
    referrerHost: event.referrerHost ? event.referrerHost.slice(0, 255).toLowerCase() : null,
    device: (["desktop", "mobile", "tablet"].includes(event.device) ? event.device : "desktop") as AnalyticsDevice,
    visitorHash: event.visitorHash.slice(0, 128),
    statusCode: Math.max(100, Math.min(599, Math.trunc(event.statusCode || 200))),
    createdAt: event.createdAt ? new Date(event.createdAt) : new Date(),
  }));

  if (!db) {
    const store = globalThis.__cognixMemoryStore ?? memory;
    store.analyticsEvents ??= [];
    for (const item of sanitized) {
      store.analyticsEvents.push({
        id: crypto.randomUUID(),
        ...item,
        createdAt: item.createdAt.toISOString(),
      });
    }
    if (store.analyticsEvents.length > 20_000) {
      store.analyticsEvents.splice(0, store.analyticsEvents.length - 20_000);
    }
    return sanitized.length;
  }

  await db.insert(projectAnalyticsEvents).values(sanitized);
  return sanitized.length;
}

export async function getProjectAnalyticsSummary(projectId: string, requestedDays = 7): Promise<ProjectAnalyticsSummary> {
  const days = requestedDays === 30 ? 30 : 7;
  const now = new Date();
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));

  let rows: {
    hostname: string;
    path: string;
    referrerHost: string | null;
    device: string;
    visitorHash: string;
    createdAt: Date;
  }[];

  if (!db) {
    const store = globalThis.__cognixMemoryStore ?? memory;
    store.analyticsEvents ??= [];
    rows = store.analyticsEvents
      .filter((event) => event.projectId === projectId && new Date(event.createdAt) >= startUtc)
      .map((event) => ({
        hostname: event.hostname,
        path: event.path,
        referrerHost: event.referrerHost,
        device: event.device,
        visitorHash: event.visitorHash,
        createdAt: new Date(event.createdAt),
      }));
  } else {
    rows = await db
      .select({
        hostname: projectAnalyticsEvents.hostname,
        path: projectAnalyticsEvents.path,
        referrerHost: projectAnalyticsEvents.referrerHost,
        device: projectAnalyticsEvents.device,
        visitorHash: projectAnalyticsEvents.visitorHash,
        createdAt: projectAnalyticsEvents.createdAt,
      })
      .from(projectAnalyticsEvents)
      .where(and(eq(projectAnalyticsEvents.projectId, projectId), gte(projectAnalyticsEvents.createdAt, startUtc)))
      .limit(50_000);
  }

  const dailyBuckets = new Map<string, { pageviews: number; visitors: Set<string> }>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(startUtc.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    dailyBuckets.set(day, { pageviews: 0, visitors: new Set() });
  }

  const allVisitors = new Set<string>();
  const pathMap = new Map<string, { views: number; visitors: Set<string> }>();
  const referrerMap = new Map<string, number>();
  const hostMap = new Map<string, number>();
  const deviceMap: Record<AnalyticsDevice, number> = { desktop: 0, mobile: 0, tablet: 0 };

  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    const bucket = dailyBuckets.get(day);
    if (bucket) {
      bucket.pageviews += 1;
      bucket.visitors.add(row.visitorHash);
    }
    allVisitors.add(row.visitorHash);

    const pathEntry = pathMap.get(row.path) ?? { views: 0, visitors: new Set<string>() };
    pathEntry.views += 1;
    pathEntry.visitors.add(row.visitorHash);
    pathMap.set(row.path, pathEntry);

    const refLabel = row.referrerHost || "Direct / None";
    referrerMap.set(refLabel, (referrerMap.get(refLabel) ?? 0) + 1);

    hostMap.set(row.hostname, (hostMap.get(row.hostname) ?? 0) + 1);

    const dev: AnalyticsDevice =
      row.device === "mobile" || row.device === "tablet" ? row.device : "desktop";
    deviceMap[dev] += 1;
  }

  const totalPageviews = rows.length;
  const devices: ProjectAnalyticsSummary["devices"] = (["desktop", "mobile", "tablet"] as const).map((device) => ({
    device,
    views: deviceMap[device],
    percentage: totalPageviews > 0 ? Math.round((deviceMap[device] / totalPageviews) * 100) : 0,
  }));

  return {
    days,
    totalPageviews,
    uniqueVisitors: allVisitors.size,
    dailySeries: [...dailyBuckets.entries()].map(([date, item]) => ({
      date,
      pageviews: item.pageviews,
      visitors: item.visitors.size,
    })),
    topPaths: [...pathMap.entries()]
      .map(([path, item]) => ({ path, views: item.views, visitors: item.visitors.size }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10),
    topReferrers: [...referrerMap.entries()]
      .map(([referrer, views]) => ({ referrer, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 8),
    topHosts: [...hostMap.entries()]
      .map(([hostname, views]) => ({ hostname, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 6),
    devices,
  };
}

// ── Persistent Preview Console Logs ──────────────────────────────────────

function mapConsoleLog(row: typeof projectConsoleLogs.$inferSelect): PreviewConsoleEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    source: (["browser", "network", "server"].includes(row.source) ? row.source : "browser") as PreviewConsoleSource,
    level: (["log", "info", "warn", "error"].includes(row.level) ? row.level : "log") as PreviewConsoleLevel,
    message: row.message,
    stack: row.stack ?? null,
    route: row.route ?? null,
    statusCode: row.statusCode ?? null,
    fingerprint: row.fingerprint,
    repeatCount: row.repeatCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function appendConsoleLogsInMemory(projectId: string, sanitized: Omit<PreviewConsoleEntry, "id">[]) {
  const store = globalThis.__cognixMemoryStore ?? memory;
  store.consoleLogs ??= [];
  const projectEntries = store.consoleLogs.filter((item) => item.projectId === projectId);
  const otherEntries = store.consoleLogs.filter((item) => item.projectId !== projectId);

  for (const incoming of sanitized) {
    const last = projectEntries.at(-1);
    if (last && last.fingerprint === incoming.fingerprint) {
      last.repeatCount += incoming.repeatCount;
      last.createdAt = incoming.createdAt;
      if (incoming.stack) last.stack = incoming.stack;
      if (incoming.route) last.route = incoming.route;
      if (incoming.statusCode) last.statusCode = incoming.statusCode;
    } else {
      projectEntries.push({ id: crypto.randomUUID(), ...incoming });
    }
  }

  const trimmed = projectEntries.slice(-PREVIEW_CONSOLE_MAX_ENTRIES);
  store.consoleLogs = [...otherEntries, ...trimmed];
  return trimmed;
}

export async function listProjectConsoleLogs(
  projectId: string,
  limit = 200,
): Promise<PreviewConsoleEntry[]> {
  const safeLimit = Math.max(1, Math.min(PREVIEW_CONSOLE_MAX_ENTRIES, Math.trunc(limit)));
  const store = globalThis.__cognixMemoryStore ?? memory;
  store.consoleLogs ??= [];

  if (!db) {
    return store.consoleLogs.filter((item) => item.projectId === projectId).slice(-safeLimit);
  }

  try {
    const rows = await db
      .select()
      .from(projectConsoleLogs)
      .where(eq(projectConsoleLogs.projectId, projectId))
      .orderBy(desc(projectConsoleLogs.createdAt))
      .limit(safeLimit);
    return rows.reverse().map(mapConsoleLog);
  } catch {
    return store.consoleLogs.filter((item) => item.projectId === projectId).slice(-safeLimit);
  }
}

export async function appendProjectConsoleLogs(
  projectId: string,
  inputs: PreviewConsoleInput[],
): Promise<PreviewConsoleEntry[]> {
  if (!inputs.length) return listProjectConsoleLogs(projectId);

  const secrets = await getDecryptedSecrets(projectId).catch(() => ({} as Record<string, string>));
  const secretValues = Object.values(secrets);

  const sanitized: Omit<PreviewConsoleEntry, "id">[] = [];
  for (const raw of inputs.slice(0, 60)) {
    const source: PreviewConsoleSource = ["browser", "network", "server"].includes(raw.source) ? raw.source : "browser";
    const level: PreviewConsoleLevel = ["log", "info", "warn", "error"].includes(raw.level) ? raw.level : "log";
    const message = redactConsoleSecrets(raw.message, secretValues).trim().slice(0, 4_000);
    if (!message) continue;
    const route = raw.route ? redactConsoleSecrets(raw.route, secretValues).trim().slice(0, 400) : null;
    const statusCode =
      typeof raw.statusCode === "number" && raw.statusCode >= 100 && raw.statusCode <= 599
        ? Math.trunc(raw.statusCode)
        : null;
    if (level === "error" && isIgnorableConsoleError({ message, route, statusCode })) continue;

    const stack = raw.stack ? redactConsoleSecrets(raw.stack, secretValues).trim().slice(0, 8_000) : null;
    const fingerprint = computeConsoleFingerprint({ source, level, message, statusCode });
    const parsedTime = raw.createdAt ? Date.parse(raw.createdAt) : Number.NaN;
    const createdAt = Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : new Date().toISOString();

    const prev = sanitized.at(-1);
    if (prev && prev.fingerprint === fingerprint) {
      prev.repeatCount += 1;
      prev.createdAt = createdAt;
      if (stack) prev.stack = stack;
      if (route) prev.route = route;
      if (statusCode) prev.statusCode = statusCode;
    } else {
      sanitized.push({
        projectId,
        source,
        level,
        message,
        stack,
        route,
        statusCode,
        fingerprint,
        repeatCount: 1,
        createdAt,
      });
    }
  }

  if (!sanitized.length) return listProjectConsoleLogs(projectId);

  if (!db) {
    return appendConsoleLogsInMemory(projectId, sanitized);
  }

  try {
    const [latestRow] = await db
      .select()
      .from(projectConsoleLogs)
      .where(eq(projectConsoleLogs.projectId, projectId))
      .orderBy(desc(projectConsoleLogs.createdAt))
      .limit(1);

    let toInsert = sanitized;
    if (latestRow && latestRow.fingerprint === sanitized[0].fingerprint) {
      const first = sanitized[0];
      await db
        .update(projectConsoleLogs)
        .set({
          repeatCount: latestRow.repeatCount + first.repeatCount,
          createdAt: new Date(first.createdAt),
          ...(first.stack ? { stack: first.stack } : {}),
          ...(first.route ? { route: first.route } : {}),
          ...(first.statusCode ? { statusCode: first.statusCode } : {}),
        })
        .where(eq(projectConsoleLogs.id, latestRow.id));
      toInsert = sanitized.slice(1);
    }

    if (toInsert.length > 0) {
      await db.insert(projectConsoleLogs).values(
        toInsert.map((entry) => ({
          projectId: entry.projectId,
          source: entry.source,
          level: entry.level,
          message: entry.message,
          stack: entry.stack,
          route: entry.route,
          statusCode: entry.statusCode,
          fingerprint: entry.fingerprint,
          repeatCount: entry.repeatCount,
          createdAt: new Date(entry.createdAt),
        })),
      );
    }

    // Keep per-project logs bounded to PREVIEW_CONSOLE_MAX_ENTRIES rows
    await db.execute(sql`
      DELETE FROM project_console_logs
      WHERE project_id = ${projectId}::uuid
        AND id NOT IN (
          SELECT id FROM project_console_logs
          WHERE project_id = ${projectId}::uuid
          ORDER BY created_at DESC
          LIMIT ${PREVIEW_CONSOLE_MAX_ENTRIES}
        )
    `);

    return listProjectConsoleLogs(projectId);
  } catch {
    return appendConsoleLogsInMemory(projectId, sanitized);
  }
}

export async function clearProjectConsoleLogs(projectId: string): Promise<void> {
  const store = globalThis.__cognixMemoryStore ?? memory;
  store.consoleLogs = (store.consoleLogs ?? []).filter((item) => item.projectId !== projectId);
  if (!db) return;
  try {
    await db.delete(projectConsoleLogs).where(eq(projectConsoleLogs.projectId, projectId));
  } catch {
    // Table may not exist yet before migration; memory store is already cleared.
  }
}

// ── Billing, Subscriptions, Credit Ledger & Admin Overview ────────────────

const VALID_SUB_STATUSES = new Set<SubscriptionStatus>([
  "inactive",
  "active",
  "on_hold",
  "cancelled",
  "expired",
  "failed",
]);

function normalizeSubscriptionStatus(raw: string | null | undefined): SubscriptionStatus {
  if (raw && VALID_SUB_STATUSES.has(raw as SubscriptionStatus)) return raw as SubscriptionStatus;
  return "inactive";
}

function defaultInactiveSubscription(userId: string): UserSubscription {
  const now = new Date().toISOString();
  return {
    userId,
    planCode: PRO_PLAN_CODE,
    status: "inactive",
    priceCents: PRO_PLAN_PRICE_CENTS,
    currency: PRO_PLAN_CURRENCY,
    dodoCustomerId: null,
    dodoSubscriptionId: null,
    dodoProductId: null,
    monthlyCreditsHundredths: PRO_MONTHLY_CREDITS_HUNDREDTHS,
    creditsBalanceHundredths: 0,
    creditsUsedThisPeriodHundredths: 0,
    lifetimeCreditsUsedHundredths: 0,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastPaymentId: null,
    lastPaymentAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function mapUserSubscription(row: typeof userSubscriptions.$inferSelect): UserSubscription {
  return {
    userId: row.userId,
    planCode: row.planCode,
    status: normalizeSubscriptionStatus(row.status),
    priceCents: row.priceCents,
    currency: row.currency,
    dodoCustomerId: row.dodoCustomerId ?? null,
    dodoSubscriptionId: row.dodoSubscriptionId ?? null,
    dodoProductId: row.dodoProductId ?? null,
    monthlyCreditsHundredths: row.monthlyCreditsHundredths,
    creditsBalanceHundredths: row.creditsBalanceHundredths,
    creditsUsedThisPeriodHundredths: row.creditsUsedThisPeriodHundredths,
    lifetimeCreditsUsedHundredths: row.lifetimeCreditsUsedHundredths,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    lastPaymentId: row.lastPaymentId ?? null,
    lastPaymentAt: row.lastPaymentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapCreditUsageEvent(
  row: typeof creditUsageEvents.$inferSelect,
  extra?: { userEmail?: string; userName?: string | null; projectTitle?: string | null },
): CreditUsageEvent {
  const mode = row.mode === "plan" || row.mode === "security" ? row.mode : "build";
  const tier: CreditComplexityTier =
    row.complexityTier === "light" ||
    row.complexityTier === "heavy" ||
    row.complexityTier === "extended"
      ? row.complexityTier
      : "standard";
  return {
    id: row.id,
    userId: row.userId,
    ...(extra?.userEmail !== undefined ? { userEmail: extra.userEmail } : {}),
    ...(extra?.userName !== undefined ? { userName: extra.userName } : {}),
    projectId: row.projectId ?? null,
    ...(extra?.projectTitle !== undefined ? { projectTitle: extra.projectTitle } : {}),
    messageId: row.messageId ?? null,
    mode,
    complexityTier: tier,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    turns: row.turns,
    toolCalls: row.toolCalls,
    filesChanged: row.filesChanged,
    commandsRun: row.commandsRun,
    cloudActions: row.cloudActions,
    durationMs: row.durationMs,
    creditsHundredths: row.creditsHundredths,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeAgentRunMetricStatus(value: string): AgentRunMetricStatus {
  if (value === "checkpoint" || value === "awaiting_user" || value === "error") return value;
  return "completed";
}

function mapAgentRunMetric(row: typeof agentRunMetrics.$inferSelect): AgentRunMetric {
  return {
    id: row.id,
    projectId: row.projectId ?? null,
    userId: row.userId,
    messageId: row.messageId ?? null,
    mode: row.mode === "plan" || row.mode === "security" ? row.mode : "build",
    status: normalizeAgentRunMetricStatus(row.status),
    errorCategory: row.errorCategory ?? null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    totalDurationMs: row.totalDurationMs,
    performance: row.performance,
    createdAt: row.createdAt.toISOString(),
  };
}

export function hasActiveSubscriptionAccess(sub: UserSubscription, nowMs = Date.now()): boolean {
  if (sub.status === "active") {
    // Allow a 48h grace window past currentPeriodEnd for webhook delivery delays.
    if (sub.currentPeriodEnd) {
      const endMs = Date.parse(sub.currentPeriodEnd);
      if (Number.isFinite(endMs) && nowMs > endMs + 48 * 60 * 60_000) {
        return false;
      }
    }
    return true;
  }
  if (sub.status === "cancelled" && sub.currentPeriodEnd) {
    const endMs = Date.parse(sub.currentPeriodEnd);
    return Number.isFinite(endMs) && endMs > nowMs;
  }
  return false;
}

export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  if (!db) {
    memory.subscriptions ??= [];
    const found = memory.subscriptions.find((item) => item.userId === userId);
    return found ?? defaultInactiveSubscription(userId);
  }
  const [row] = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);
  return row ? mapUserSubscription(row) : defaultInactiveSubscription(userId);
}

export type AgentEntitlementCheck = {
  allowed: boolean;
  reason?: "subscription_required" | "credits_exhausted";
  message?: string;
  subscription: UserSubscription;
};

/**
 * Enforces the single-plan ($10/mo, no free tier) policy and available credit balance.
 * Admins can always run builds for testing/administration while usage is still logged.
 */
export async function checkUserAgentEntitlement(viewer: Viewer): Promise<AgentEntitlementCheck> {
  const subscription = await getUserSubscription(viewer.id);
  if (viewer.isAdmin) {
    return { allowed: true, subscription };
  }
  if (!hasActiveSubscriptionAccess(subscription)) {
    return {
      allowed: false,
      reason: "subscription_required",
      message: "Curator Pro ($10/month) is required to build apps. Subscribe to unlock 90 monthly credits.",
      subscription,
    };
  }
  if (subscription.creditsBalanceHundredths <= 0) {
    return {
      allowed: false,
      reason: "credits_exhausted",
      message: "You have used all available credits for this billing cycle. Credits renew automatically on your next billing date.",
      subscription,
    };
  }
  return { allowed: true, subscription };
}

function safeNonNegInt(value: number, min = 0): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.trunc(value));
}

/**
 * Atomically reserves up to `desiredHoldHundredths` from an active subscriber's credit balance
 * before starting a long-running agent stream, preventing concurrent-tab overdraft.
 */
export async function reserveUserAgentCredits(
  viewer: Viewer,
  desiredHoldHundredths: number,
): Promise<
  | { allowed: true; reservedHundredths: number; subscription: UserSubscription }
  | { allowed: false; reason: "subscription_required" | "credits_exhausted"; message: string; subscription: UserSubscription }
> {
  const entitlement = await checkUserAgentEntitlement(viewer);
  if (!entitlement.allowed) {
    return {
      allowed: false,
      reason: entitlement.reason ?? "subscription_required",
      message: entitlement.message ?? "Curator Pro ($10/month) is required to build apps.",
      subscription: entitlement.subscription,
    };
  }
  if (viewer.isAdmin) {
    return { allowed: true, reservedHundredths: 0, subscription: entitlement.subscription };
  }

  const targetHold = Math.max(5, safeNonNegInt(desiredHoldHundredths, 50));
  const now = new Date();

  if (!db) {
    memory.subscriptions ??= [];
    const idx = memory.subscriptions.findIndex((s) => s.userId === viewer.id);
    const current = idx >= 0 ? memory.subscriptions[idx] : defaultInactiveSubscription(viewer.id);
    if (current.creditsBalanceHundredths <= 0) {
      return {
        allowed: false,
        reason: "credits_exhausted",
        message: "You have used all available credits for this billing cycle. Credits renew automatically on your next billing date.",
        subscription: current,
      };
    }
    const reserved = Math.min(targetHold, current.creditsBalanceHundredths);
    const updated: UserSubscription = {
      ...current,
      creditsBalanceHundredths: current.creditsBalanceHundredths - reserved,
      updatedAt: now.toISOString(),
    };
    if (idx >= 0) memory.subscriptions[idx] = updated;
    else memory.subscriptions.push(updated);
    return { allowed: true, reservedHundredths: reserved, subscription: updated };
  }

  // Atomic conditional reservation in PostgreSQL: deducts LEAST(balance, targetHold) only when balance > 0.
  const [updatedRow] = await db
    .update(userSubscriptions)
    .set({
      creditsBalanceHundredths: sql`GREATEST(0, ${userSubscriptions.creditsBalanceHundredths} - ${targetHold})`,
      updatedAt: now,
    })
    .where(and(eq(userSubscriptions.userId, viewer.id), gte(userSubscriptions.creditsBalanceHundredths, 1)))
    .returning();

  if (!updatedRow) {
    const latest = await getUserSubscription(viewer.id);
    return {
      allowed: false,
      reason: "credits_exhausted",
      message: "You have used all available credits for this billing cycle. Credits renew automatically on your next billing date.",
      subscription: latest,
    };
  }

  const reservedHundredths = Math.min(targetHold, entitlement.subscription.creditsBalanceHundredths);
  return {
    allowed: true,
    reservedHundredths: Math.max(0, reservedHundredths),
    subscription: mapUserSubscription(updatedRow),
  };
}

export async function refundReservedCredits(userId: string, reservedHundredths: number): Promise<void> {
  const refund = safeNonNegInt(reservedHundredths, 0);
  if (refund <= 0) return;
  const now = new Date();
  if (!db) {
    memory.subscriptions ??= [];
    const idx = memory.subscriptions.findIndex((s) => s.userId === userId);
    if (idx >= 0) {
      memory.subscriptions[idx] = {
        ...memory.subscriptions[idx],
        creditsBalanceHundredths: memory.subscriptions[idx].creditsBalanceHundredths + refund,
        updatedAt: now.toISOString(),
      };
    }
    return;
  }
  await db
    .update(userSubscriptions)
    .set({
      creditsBalanceHundredths: sql`${userSubscriptions.creditsBalanceHundredths} + ${refund}`,
      updatedAt: now,
    })
    .where(eq(userSubscriptions.userId, userId));
}

export async function recordCreditUsage(input: {
  userId: string;
  projectId: string | null;
  messageId: string | null;
  mode: "build" | "plan" | "security";
  complexityTier: CreditComplexityTier;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  filesChanged: number;
  commandsRun: number;
  cloudActions: number;
  durationMs: number;
  creditsHundredths: number;
  reservedHundredths?: number;
  description: string;
}): Promise<CreditUsageEvent> {
  const safeCredits = safeNonNegInt(input.creditsHundredths, 0);
  const alreadyReserved = safeNonNegInt(input.reservedHundredths ?? 0, 0);
  // Positive netDelta means deduct additional credits beyond the pre-reserved hold;
  // negative netDelta means the actual run cost less than the hold, so refund the difference.
  const netDelta = safeCredits - alreadyReserved;
  const promptTokens = safeNonNegInt(input.promptTokens, 0);
  const completionTokens = safeNonNegInt(input.completionTokens, 0);
  const totalTokens = safeNonNegInt(input.totalTokens, 0);
  const turns = safeNonNegInt(input.turns, 1);
  const toolCalls = safeNonNegInt(input.toolCalls, 0);
  const filesChanged = safeNonNegInt(input.filesChanged, 0);
  const commandsRun = safeNonNegInt(input.commandsRun, 0);
  const cloudActions = safeNonNegInt(input.cloudActions, 0);
  const durationMs = safeNonNegInt(input.durationMs, 0);
  const now = new Date();

  if (!db) {
    memory.creditUsageEvents ??= [];
    memory.subscriptions ??= [];
    const event: CreditUsageEvent = {
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      messageId: input.messageId,
      mode: input.mode,
      complexityTier: input.complexityTier,
      promptTokens,
      completionTokens,
      totalTokens,
      turns,
      toolCalls,
      filesChanged,
      commandsRun,
      cloudActions,
      durationMs,
      creditsHundredths: safeCredits,
      description: input.description,
      createdAt: now.toISOString(),
    };
    memory.creditUsageEvents.unshift(event);
    const subIdx = memory.subscriptions.findIndex((s) => s.userId === input.userId);
    const current = subIdx >= 0 ? memory.subscriptions[subIdx] : defaultInactiveSubscription(input.userId);
    const updated: UserSubscription = {
      ...current,
      creditsBalanceHundredths: Math.max(0, current.creditsBalanceHundredths - netDelta),
      creditsUsedThisPeriodHundredths: current.creditsUsedThisPeriodHundredths + safeCredits,
      lifetimeCreditsUsedHundredths: current.lifetimeCreditsUsedHundredths + safeCredits,
      updatedAt: now.toISOString(),
    };
    if (subIdx >= 0) memory.subscriptions[subIdx] = updated;
    else memory.subscriptions.push(updated);
    return event;
  }

  const [insertedEvents] = await db.batch([
    db
      .insert(creditUsageEvents)
      .values({
        userId: input.userId,
        projectId: input.projectId,
        messageId: input.messageId,
        mode: input.mode,
        complexityTier: input.complexityTier,
        promptTokens,
        completionTokens,
        totalTokens,
        turns,
        toolCalls,
        filesChanged,
        commandsRun,
        cloudActions,
        durationMs,
        creditsHundredths: safeCredits,
        description: input.description.slice(0, 300),
      })
      .returning(),
    db
      .insert(userSubscriptions)
      .values({
        userId: input.userId,
        planCode: PRO_PLAN_CODE,
        status: "inactive",
        priceCents: PRO_PLAN_PRICE_CENTS,
        currency: PRO_PLAN_CURRENCY,
        monthlyCreditsHundredths: PRO_MONTHLY_CREDITS_HUNDREDTHS,
        creditsBalanceHundredths: 0,
        creditsUsedThisPeriodHundredths: safeCredits,
        lifetimeCreditsUsedHundredths: safeCredits,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSubscriptions.userId,
        set: {
          creditsBalanceHundredths: sql`GREATEST(0, ${userSubscriptions.creditsBalanceHundredths} - ${netDelta})`,
          creditsUsedThisPeriodHundredths: sql`${userSubscriptions.creditsUsedThisPeriodHundredths} + ${safeCredits}`,
          lifetimeCreditsUsedHundredths: sql`${userSubscriptions.lifetimeCreditsUsedHundredths} + ${safeCredits}`,
          updatedAt: now,
        },
      }),
  ]);

  return mapCreditUsageEvent(insertedEvents[0]);
}

/**
 * Persists one bounded, privacy-safe performance snapshot for an agent run.
 * The run id is supplied by the runner, making repeated writes idempotent.
 */
export async function recordAgentRunMetric(input: {
  id: string;
  projectId: string | null;
  userId: string;
  messageId: string | null;
  mode: "build" | "plan" | "security";
  status: AgentRunMetricStatus;
  errorCategory?: string | null;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  performance: AgentRunPerformance;
}): Promise<AgentRunMetric> {
  const now = new Date();
  const startedAt = new Date(input.startedAt);
  const completedAt = new Date(input.completedAt);
  const safeStartedAt = Number.isFinite(startedAt.getTime()) ? startedAt : now;
  const safeCompletedAt = Number.isFinite(completedAt.getTime()) ? completedAt : now;
  const metric: AgentRunMetric = {
    id: input.id,
    projectId: input.projectId,
    userId: input.userId,
    messageId: input.messageId,
    mode: input.mode,
    status: input.status,
    errorCategory: input.errorCategory?.slice(0, 80) ?? null,
    startedAt: safeStartedAt.toISOString(),
    completedAt: safeCompletedAt.toISOString(),
    totalDurationMs: safeNonNegInt(input.totalDurationMs, 0),
    performance: input.performance,
    createdAt: now.toISOString(),
  };

  if (!db) {
    memory.agentRunMetrics ??= [];
    const existingIndex = memory.agentRunMetrics.findIndex((item) => item.id === input.id);
    if (existingIndex >= 0) {
      metric.createdAt = memory.agentRunMetrics[existingIndex].createdAt;
      memory.agentRunMetrics[existingIndex] = metric;
    } else {
      memory.agentRunMetrics.unshift(metric);
    }
    return metric;
  }

  const [row] = await db
    .insert(agentRunMetrics)
    .values({
      id: metric.id,
      projectId: metric.projectId,
      userId: metric.userId,
      messageId: metric.messageId,
      mode: metric.mode,
      status: metric.status,
      errorCategory: metric.errorCategory,
      startedAt: safeStartedAt,
      completedAt: safeCompletedAt,
      totalDurationMs: metric.totalDurationMs,
      performance: metric.performance,
    })
    .onConflictDoUpdate({
      target: agentRunMetrics.id,
      set: {
        projectId: metric.projectId,
        messageId: metric.messageId,
        mode: metric.mode,
        status: metric.status,
        errorCategory: metric.errorCategory,
        completedAt: safeCompletedAt,
        totalDurationMs: metric.totalDurationMs,
        performance: metric.performance,
      },
    })
    .returning();

  return mapAgentRunMetric(row);
}

export async function listRecentAgentRunMetrics(limit = 100): Promise<AgentRunMetric[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  if (!db) {
    memory.agentRunMetrics ??= [];
    return memory.agentRunMetrics.slice(0, safeLimit).map((metric) => ({
      ...metric,
      performance: structuredClone(metric.performance),
    }));
  }
  const rows = await db.select().from(agentRunMetrics).orderBy(desc(agentRunMetrics.createdAt)).limit(safeLimit);
  return rows.map(mapAgentRunMetric);
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = values.map((value) => safeNonNegInt(value, 0)).sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** Admin-only aggregate/export source. Contains no prompt, source, path, command, log, or user identity data. */
export async function getAdminPerformanceData(limit = 200) {
  const runs = await listRecentAgentRunMetrics(limit);
  const completed = runs.filter((run) => run.status === "completed");
  const totalDurations = completed.map((run) => run.totalDurationMs);
  const firstPreviewDurations = completed
    .map((run) => run.performance.timeToFirstPreviewMs)
    .filter((value): value is number => typeof value === "number");
  const turns = completed.map((run) => run.performance.model.turns);
  const inputTokens = completed.map((run) =>
    run.performance.model.turnMetrics.reduce((total, turn) => total + turn.promptTokens, 0),
  );

  return {
    schemaVersion: 1 as const,
    sampleSize: runs.length,
    completedSampleSize: completed.length,
    summary: {
      totalDurationMs: { p50: percentile(totalDurations, 0.5), p95: percentile(totalDurations, 0.95) },
      firstPreviewMs: { p50: percentile(firstPreviewDurations, 0.5), p95: percentile(firstPreviewDurations, 0.95) },
      modelTurns: { p50: percentile(turns, 0.5), p95: percentile(turns, 0.95) },
      inputTokens: { p50: percentile(inputTokens, 0.5), p95: percentile(inputTokens, 0.95) },
    },
    statusCounts: Object.fromEntries(
      (["completed", "checkpoint", "awaiting_user", "error"] as const).map((status) => [
        status,
        runs.filter((run) => run.status === status).length,
      ]),
    ),
    recentRuns: runs.map((run) => ({
      id: run.id,
      mode: run.mode,
      status: run.status,
      errorCategory: run.errorCategory,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      totalDurationMs: run.totalDurationMs,
      performance: run.performance,
    })),
  };
}

export async function listUserCreditUsage(userId: string, limit = 30): Promise<CreditUsageEvent[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  if (!db) {
    memory.creditUsageEvents ??= [];
    return memory.creditUsageEvents
      .filter((event) => event.userId === userId)
      .slice(0, safeLimit)
      .map((event) => ({
        ...event,
        projectTitle: memory.projects.find((p) => p.id === event.projectId)?.title ?? null,
      }));
  }

  const rows = await db
    .select({
      event: creditUsageEvents,
      projectTitle: projects.title,
    })
    .from(creditUsageEvents)
    .leftJoin(projects, eq(creditUsageEvents.projectId, projects.id))
    .where(eq(creditUsageEvents.userId, userId))
    .orderBy(desc(creditUsageEvents.createdAt))
    .limit(safeLimit);

  return rows.map((row) => mapCreditUsageEvent(row.event, { projectTitle: row.projectTitle ?? null }));
}

/**
 * Claims a webhook event ID for idempotent processing.
 * Returns `true` if this is the first time seeing the event, `false` if already processed.
 */
export async function claimBillingWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
  if (!db) {
    memory.webhookEvents ??= new Set<string>();
    if (memory.webhookEvents.has(eventId)) return false;
    memory.webhookEvents.add(eventId);
    return true;
  }
  const inserted = await db
    .insert(billingWebhookEvents)
    .values({ eventId, eventType })
    .onConflictDoNothing({ target: billingWebhookEvents.eventId })
    .returning({ eventId: billingWebhookEvents.eventId });
  return inserted.length > 0;
}

export async function releaseBillingWebhookEvent(eventId: string): Promise<void> {
  if (!db) {
    memory.webhookEvents?.delete(eventId);
    return;
  }
  await db.delete(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, eventId));
}

export async function resolveUserIdForBilling(lookup: {
  userId?: string | null;
  dodoSubscriptionId?: string | null;
  dodoCustomerId?: string | null;
  email?: string | null;
}): Promise<string | null> {
  if (!db) {
    memory.users ??= [];
    memory.subscriptions ??= [];
    if (lookup.userId && memory.users.some((u) => u.id === lookup.userId)) return lookup.userId;
    if (lookup.dodoSubscriptionId) {
      const sub = memory.subscriptions.find((s) => s.dodoSubscriptionId === lookup.dodoSubscriptionId);
      if (sub) return sub.userId;
    }
    if (lookup.dodoCustomerId) {
      const sub = memory.subscriptions.find((s) => s.dodoCustomerId === lookup.dodoCustomerId);
      if (sub) return sub.userId;
    }
    if (lookup.email) {
      const norm = lookup.email.trim().toLowerCase();
      const matching = memory.users.filter((u) => u.email.trim().toLowerCase() === norm);
      const canonical = matching.find((u) => u.id.startsWith("account|") || u.emailVerified) ?? matching[0];
      if (canonical) return canonical.id;
    }
    return lookup.userId ?? null;
  }

  if (lookup.userId) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, lookup.userId)).limit(1);
    if (row) return row.id;
  }
  if (lookup.dodoSubscriptionId) {
    const [row] = await db
      .select({ userId: userSubscriptions.userId })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.dodoSubscriptionId, lookup.dodoSubscriptionId))
      .limit(1);
    if (row) return row.userId;
  }
  if (lookup.dodoCustomerId) {
    const [row] = await db
      .select({ userId: userSubscriptions.userId })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.dodoCustomerId, lookup.dodoCustomerId))
      .limit(1);
    if (row) return row.userId;
  }
  if (lookup.email) {
    const norm = lookup.email.trim().toLowerCase();
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${norm}`)
      .orderBy(sql`(${users.id} LIKE 'account|%') DESC`, desc(users.emailVerified), desc(users.lastSeenAt))
      .limit(1);
    if (row) return row.id;
  }
  return null;
}

export async function applyDodoSubscriptionEvent(input: {
  userId: string;
  eventType: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  productId?: string | null;
  paymentId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
}): Promise<UserSubscription> {
  const existing = await getUserSubscription(input.userId);
  const now = new Date();

  // `payment.succeeded` often arrives concurrently with `subscription.active` / `subscription.renewed`.
  // Only update payment metadata so a concurrent payment webhook never overwrites status or credit balance!
  if (input.eventType === "payment.succeeded") {
    const nextPaymentId = input.paymentId ?? existing.lastPaymentId;
    const nextPaymentAt = input.paymentId ? now : existing.lastPaymentAt ? new Date(existing.lastPaymentAt) : null;
    if (!db) {
      memory.subscriptions ??= [];
      const updated: UserSubscription = {
        ...existing,
        dodoCustomerId: input.customerId ?? existing.dodoCustomerId,
        lastPaymentId: nextPaymentId,
        lastPaymentAt: nextPaymentAt?.toISOString() ?? null,
        updatedAt: now.toISOString(),
      };
      const idx = memory.subscriptions.findIndex((s) => s.userId === input.userId);
      if (idx >= 0) memory.subscriptions[idx] = updated;
      else memory.subscriptions.push(updated);
      return updated;
    }
    const [row] = await db
      .insert(userSubscriptions)
      .values({
        userId: input.userId,
        planCode: PRO_PLAN_CODE,
        status: "inactive",
        priceCents: PRO_PLAN_PRICE_CENTS,
        currency: PRO_PLAN_CURRENCY,
        dodoCustomerId: input.customerId ?? null,
        monthlyCreditsHundredths: PRO_MONTHLY_CREDITS_HUNDREDTHS,
        creditsBalanceHundredths: 0,
        lastPaymentId: nextPaymentId,
        lastPaymentAt: nextPaymentAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSubscriptions.userId,
        set: {
          ...(input.customerId ? { dodoCustomerId: input.customerId } : {}),
          ...(nextPaymentId ? { lastPaymentId: nextPaymentId, lastPaymentAt: nextPaymentAt } : {}),
          updatedAt: now,
        },
      })
      .returning();
    return mapUserSubscription(row);
  }

  const nextPeriodStart = input.currentPeriodStart
    ? new Date(input.currentPeriodStart)
    : existing.currentPeriodStart
      ? new Date(existing.currentPeriodStart)
      : now;
  const fallbackEnd = new Date(nextPeriodStart.getTime() + 31 * 24 * 60 * 60_000);
  const nextPeriodEnd = input.currentPeriodEnd
    ? new Date(input.currentPeriodEnd)
    : existing.currentPeriodEnd
      ? new Date(existing.currentPeriodEnd)
      : fallbackEnd;

  const allowance = existing.monthlyCreditsHundredths || PRO_MONTHLY_CREDITS_HUNDREDTHS;
  const rolloverCap = Math.max(PRO_MAX_ROLLOVER_CREDITS_HUNDREDTHS, allowance * 2);

  let status: SubscriptionStatus = existing.status;
  let creditsBalanceHundredths = existing.creditsBalanceHundredths;
  let creditsUsedThisPeriodHundredths = existing.creditsUsedThisPeriodHundredths;
  let cancelAtPeriodEnd = input.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd;
  let lastPaymentId = input.paymentId ?? existing.lastPaymentId;
  let lastPaymentAt = existing.lastPaymentAt ? new Date(existing.lastPaymentAt) : null;
  let creditSqlOp: "activate" | "renew" | "keep" = "keep";

  switch (input.eventType) {
    case "subscription.active": {
      const isNewActivation =
        existing.status !== "active" ||
        Boolean(input.subscriptionId && input.subscriptionId !== existing.dodoSubscriptionId);
      status = "active";
      cancelAtPeriodEnd = false;
      if (isNewActivation) {
        creditsBalanceHundredths = Math.min(rolloverCap, existing.creditsBalanceHundredths + allowance);
        creditsUsedThisPeriodHundredths = 0;
        creditSqlOp = "activate";
      }
      if (input.paymentId) {
        lastPaymentId = input.paymentId;
        lastPaymentAt = now;
      }
      break;
    }
    case "subscription.renewed": {
      status = "active";
      cancelAtPeriodEnd = false;
      creditsBalanceHundredths = Math.min(rolloverCap, existing.creditsBalanceHundredths + allowance);
      creditsUsedThisPeriodHundredths = 0;
      creditSqlOp = "renew";
      if (input.paymentId) {
        lastPaymentId = input.paymentId;
        lastPaymentAt = now;
      }
      break;
    }
    case "subscription.updated":
    case "subscription.plan_changed": {
      // Never promote an inactive/unpaid subscription to active without an explicit `subscription.active` event.
      break;
    }
    case "subscription.on_hold":
    case "subscription.past_due": {
      status = "on_hold";
      break;
    }
    case "subscription.cancelled": {
      status = "cancelled";
      cancelAtPeriodEnd = true;
      break;
    }
    case "subscription.expired": {
      status = "expired";
      cancelAtPeriodEnd = true;
      break;
    }
    case "subscription.failed": {
      status = "failed";
      break;
    }
    case "payment.failed": {
      if (existing.status === "active") {
        status = "on_hold";
      }
      break;
    }
    default:
      break;
  }

  const nextSub: UserSubscription = {
    userId: input.userId,
    planCode: PRO_PLAN_CODE,
    status,
    priceCents: PRO_PLAN_PRICE_CENTS,
    currency: PRO_PLAN_CURRENCY,
    dodoCustomerId: input.customerId ?? existing.dodoCustomerId,
    dodoSubscriptionId: input.subscriptionId ?? existing.dodoSubscriptionId,
    dodoProductId: input.productId ?? existing.dodoProductId,
    monthlyCreditsHundredths: allowance,
    creditsBalanceHundredths,
    creditsUsedThisPeriodHundredths,
    lifetimeCreditsUsedHundredths: existing.lifetimeCreditsUsedHundredths,
    currentPeriodStart: nextPeriodStart.toISOString(),
    currentPeriodEnd: nextPeriodEnd.toISOString(),
    cancelAtPeriodEnd,
    lastPaymentId,
    lastPaymentAt: lastPaymentAt?.toISOString() ?? null,
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
  };

  if (!db) {
    memory.subscriptions ??= [];
    const idx = memory.subscriptions.findIndex((s) => s.userId === input.userId);
    if (idx >= 0) memory.subscriptions[idx] = nextSub;
    else memory.subscriptions.push(nextSub);
    return nextSub;
  }

  const sqlBalanceExpr =
    creditSqlOp === "activate" || creditSqlOp === "renew"
      ? sql`LEAST(GREATEST(${PRO_MAX_ROLLOVER_CREDITS_HUNDREDTHS}, ${userSubscriptions.monthlyCreditsHundredths} * 2), ${userSubscriptions.creditsBalanceHundredths} + ${userSubscriptions.monthlyCreditsHundredths})`
      : userSubscriptions.creditsBalanceHundredths;

  const [row] = await db
    .insert(userSubscriptions)
    .values({
      userId: input.userId,
      planCode: nextSub.planCode,
      status: nextSub.status,
      priceCents: nextSub.priceCents,
      currency: nextSub.currency,
      dodoCustomerId: nextSub.dodoCustomerId,
      dodoSubscriptionId: nextSub.dodoSubscriptionId,
      dodoProductId: nextSub.dodoProductId,
      monthlyCreditsHundredths: nextSub.monthlyCreditsHundredths,
      creditsBalanceHundredths: nextSub.creditsBalanceHundredths,
      creditsUsedThisPeriodHundredths: nextSub.creditsUsedThisPeriodHundredths,
      lifetimeCreditsUsedHundredths: nextSub.lifetimeCreditsUsedHundredths,
      currentPeriodStart: nextPeriodStart,
      currentPeriodEnd: nextPeriodEnd,
      cancelAtPeriodEnd: nextSub.cancelAtPeriodEnd,
      lastPaymentId: nextSub.lastPaymentId,
      lastPaymentAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSubscriptions.userId,
      set: {
        status: nextSub.status,
        dodoCustomerId: nextSub.dodoCustomerId,
        dodoSubscriptionId: nextSub.dodoSubscriptionId,
        dodoProductId: nextSub.dodoProductId,
        creditsBalanceHundredths: sqlBalanceExpr,
        ...(creditSqlOp !== "keep" ? { creditsUsedThisPeriodHundredths: 0 } : {}),
        currentPeriodStart: nextPeriodStart,
        currentPeriodEnd: nextPeriodEnd,
        cancelAtPeriodEnd: nextSub.cancelAtPeriodEnd,
        lastPaymentId: nextSub.lastPaymentId,
        lastPaymentAt,
        updatedAt: now,
      },
    })
    .returning();

  return mapUserSubscription(row);
}

export async function adminAdjustUserBilling(input: {
  userId: string;
  grantCreditsHundredths?: number;
  setCreditsBalanceHundredths?: number;
  monthlyCreditsHundredths?: number;
  setStatus?: SubscriptionStatus;
  extendDays?: number;
}): Promise<UserSubscription> {
  const existing = await getUserSubscription(input.userId);
  const now = new Date();
  const hasExactSet = typeof input.setCreditsBalanceHundredths === "number" && Number.isFinite(input.setCreditsBalanceHundredths);
  const deltaHundredths = Number.isFinite(input.grantCreditsHundredths)
    ? Math.trunc(input.grantCreditsHundredths!)
    : 0;
  const nextBalance = hasExactSet
    ? safeNonNegInt(input.setCreditsBalanceHundredths!, 0)
    : Math.max(0, existing.creditsBalanceHundredths + deltaHundredths);
  const nextMonthly =
    typeof input.monthlyCreditsHundredths === "number" &&
    Number.isFinite(input.monthlyCreditsHundredths) &&
    input.monthlyCreditsHundredths > 0
      ? Math.trunc(input.monthlyCreditsHundredths)
      : existing.monthlyCreditsHundredths;
  const nextStatus = input.setStatus ?? existing.status;
  const nextCancelAtPeriodEnd = nextStatus === "active" ? false : nextStatus === "cancelled" ? true : existing.cancelAtPeriodEnd;

  const existingEndMs = existing.currentPeriodEnd ? Date.parse(existing.currentPeriodEnd) : Number.NaN;
  const hasFuturePeriodEnd = Number.isFinite(existingEndMs) && existingEndMs > now.getTime();
  const periodDays = Math.max(1, Math.min(365, Math.trunc(input.extendDays ?? 31)));

  let periodStart = existing.currentPeriodStart ? new Date(existing.currentPeriodStart) : now;
  let periodEnd = existing.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;

  if (nextStatus === "active" && (!hasFuturePeriodEnd || typeof input.extendDays === "number")) {
    periodStart = now;
    periodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60_000);
  }

  if (!db) {
    memory.subscriptions ??= [];
    const updated: UserSubscription = {
      ...existing,
      status: nextStatus,
      monthlyCreditsHundredths: nextMonthly,
      creditsBalanceHundredths: nextBalance,
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
      updatedAt: now.toISOString(),
    };
    const idx = memory.subscriptions.findIndex((s) => s.userId === input.userId);
    if (idx >= 0) memory.subscriptions[idx] = updated;
    else memory.subscriptions.push(updated);
    return updated;
  }

  const [row] = await db
    .insert(userSubscriptions)
    .values({
      userId: input.userId,
      planCode: PRO_PLAN_CODE,
      status: nextStatus,
      priceCents: PRO_PLAN_PRICE_CENTS,
      currency: PRO_PLAN_CURRENCY,
      monthlyCreditsHundredths: nextMonthly,
      creditsBalanceHundredths: nextBalance,
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSubscriptions.userId,
      set: {
        status: nextStatus,
        monthlyCreditsHundredths: nextMonthly,
        creditsBalanceHundredths: hasExactSet
          ? nextBalance
          : sql`GREATEST(0, ${userSubscriptions.creditsBalanceHundredths} + ${deltaHundredths})`,
        cancelAtPeriodEnd: nextCancelAtPeriodEnd,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: now,
      },
    })
    .returning();

  return mapUserSubscription(row);
}

const METHOD_LABELS: Record<AuthMethod, string> = {
  password: "Email & Password",
  oauth: "OAuth (Social)",
  passwordless: "Passwordless",
  sso: "Enterprise SSO",
};

export async function getAdminDashboardData(): Promise<{
  stats: AdminOverviewStats;
  users: AdminUserSummary[];
  recentUsage: CreditUsageEvent[];
}> {
  const nowMs = Date.now();
  const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60_000;
  const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60_000;

  let rawUsers: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
    avatarUrl: string | null;
    authProvider: string;
    authProviderLabel: string;
    authMethod: AuthMethod;
    createdAt: string;
    lastSeenAt: string;
  }[] = [];
  const subByUser = new Map<string, UserSubscription>();
  const projectCountByUser = new Map<string, number>();
  const usageStatsByUser = new Map<string, { runs: number; tokens: number; credits: number }>();
  let totalProjects = 0;
  let totalAgentRuns = 0;
  let totalTokens = 0;
  let totalCreditsUsedHundredths = 0;
  let recentUsage: CreditUsageEvent[] = [];

  if (!db) {
    memory.users ??= [];
    memory.subscriptions ??= [];
    memory.creditUsageEvents ??= [];

    rawUsers = memory.users.map((u) => ({
      id: u.id,
      email: u.email,
      emailVerified: u.emailVerified !== false,
      name: u.name,
      avatarUrl: u.avatarUrl,
      authProvider: u.authProvider,
      authProviderLabel: u.authProviderLabel,
      authMethod: u.authMethod,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
    }));
    for (const s of memory.subscriptions) subByUser.set(s.userId, s);
    for (const p of memory.projects) {
      totalProjects += 1;
      projectCountByUser.set(p.ownerId, (projectCountByUser.get(p.ownerId) ?? 0) + 1);
    }
    for (const ev of memory.creditUsageEvents) {
      totalAgentRuns += 1;
      totalTokens += ev.totalTokens;
      totalCreditsUsedHundredths += ev.creditsHundredths;
      const cur = usageStatsByUser.get(ev.userId) ?? { runs: 0, tokens: 0, credits: 0 };
      cur.runs += 1;
      cur.tokens += ev.totalTokens;
      cur.credits += ev.creditsHundredths;
      usageStatsByUser.set(ev.userId, cur);
    }
    const userMap = new Map(rawUsers.map((u) => [u.id, u]));
    recentUsage = memory.creditUsageEvents.slice(0, 40).map((ev) => ({
      ...ev,
      userEmail: userMap.get(ev.userId)?.email,
      userName: userMap.get(ev.userId)?.name ?? null,
      projectTitle: memory.projects.find((p) => p.id === ev.projectId)?.title ?? null,
    }));
  } else {
    const [userRows, subRows, projectAggRows, usageAggRows, recentUsageRows] = await Promise.all([
      db.select().from(users).orderBy(desc(users.createdAt)),
      db.select().from(userSubscriptions),
      db
        .select({
          ownerId: projects.ownerId,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .groupBy(projects.ownerId),
      db
        .select({
          userId: creditUsageEvents.userId,
          runs: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${creditUsageEvents.totalTokens}), 0)::bigint`,
          credits: sql<number>`coalesce(sum(${creditUsageEvents.creditsHundredths}), 0)::bigint`,
        })
        .from(creditUsageEvents)
        .groupBy(creditUsageEvents.userId),
      db
        .select({
          event: creditUsageEvents,
          userEmail: users.email,
          userName: users.name,
          projectTitle: projects.title,
        })
        .from(creditUsageEvents)
        .leftJoin(users, eq(creditUsageEvents.userId, users.id))
        .leftJoin(projects, eq(creditUsageEvents.projectId, projects.id))
        .orderBy(desc(creditUsageEvents.createdAt))
        .limit(40),
    ]);

    rawUsers = userRows.map((u) => ({
      id: u.id,
      email: u.email,
      emailVerified: u.emailVerified !== false,
      name: u.name ?? null,
      avatarUrl: u.avatarUrl ?? null,
      authProvider: u.authProvider || "unknown",
      authProviderLabel: u.authProviderLabel || "Unknown",
      authMethod: (["password", "oauth", "passwordless", "sso"].includes(u.authMethod)
        ? u.authMethod
        : "oauth") as AuthMethod,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: (u.lastSeenAt ?? u.updatedAt).toISOString(),
    }));

    for (const s of subRows) {
      subByUser.set(s.userId, mapUserSubscription(s));
    }
    for (const row of projectAggRows) {
      const count = Number(row.count ?? 0);
      totalProjects += count;
      projectCountByUser.set(row.ownerId, count);
    }
    for (const row of usageAggRows) {
      const runs = Number(row.runs ?? 0);
      const tokens = Number(row.tokens ?? 0);
      const credits = Number(row.credits ?? 0);
      totalAgentRuns += runs;
      totalTokens += tokens;
      totalCreditsUsedHundredths += credits;
      usageStatsByUser.set(row.userId, { runs, tokens, credits });
    }
    recentUsage = recentUsageRows.map((row) =>
      mapCreditUsageEvent(row.event, {
        userEmail: row.userEmail ?? undefined,
        userName: row.userName ?? null,
        projectTitle: row.projectTitle ?? null,
      }),
    );
  }

  let newUsersLast7Days = 0;
  let newUsersLast30Days = 0;
  let activeSubscribers = 0;
  const providerCounts = new Map<string, { label: string; method: AuthMethod; count: number }>();
  const methodCounts = new Map<AuthMethod, number>();

  const summaries: AdminUserSummary[] = rawUsers.map((u) => {
    const createdMs = Date.parse(u.createdAt);
    if (Number.isFinite(createdMs)) {
      if (createdMs >= sevenDaysAgoMs) newUsersLast7Days += 1;
      if (createdMs >= thirtyDaysAgoMs) newUsersLast30Days += 1;
    }

    const sub = subByUser.get(u.id) ?? defaultInactiveSubscription(u.id);
    if (hasActiveSubscriptionAccess(sub, nowMs)) {
      activeSubscribers += 1;
    }

    const pEntry = providerCounts.get(u.authProvider) ?? {
      label: u.authProviderLabel,
      method: u.authMethod,
      count: 0,
    };
    pEntry.count += 1;
    providerCounts.set(u.authProvider, pEntry);
    methodCounts.set(u.authMethod, (methodCounts.get(u.authMethod) ?? 0) + 1);

    const usage = usageStatsByUser.get(u.id) ?? { runs: 0, tokens: 0, credits: 0 };

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      authProvider: u.authProvider,
      authProviderLabel: u.authProviderLabel,
      authMethod: u.authMethod,
      isAdmin: u.emailVerified && isAdminEmail(u.email),
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      subscriptionStatus: sub.status,
      dodoCustomerId: sub.dodoCustomerId,
      dodoSubscriptionId: sub.dodoSubscriptionId,
      creditsBalanceHundredths: sub.creditsBalanceHundredths,
      creditsUsedThisPeriodHundredths: sub.creditsUsedThisPeriodHundredths,
      lifetimeCreditsUsedHundredths: Math.max(sub.lifetimeCreditsUsedHundredths, usage.credits),
      monthlyCreditsHundredths: sub.monthlyCreditsHundredths,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      projectCount: projectCountByUser.get(u.id) ?? 0,
      agentRunCount: usage.runs,
      totalTokens: usage.tokens,
    };
  });

  const totalUsers = summaries.length;
  const providerBreakdown = [...providerCounts.entries()]
    .map(([provider, item]) => ({
      provider,
      label: item.label,
      method: item.method,
      count: item.count,
      percentage: totalUsers > 0 ? Math.round((item.count / totalUsers) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const methodBreakdown = (["password", "oauth", "passwordless", "sso"] as const)
    .map((method) => {
      const count = methodCounts.get(method) ?? 0;
      return {
        method,
        label: METHOD_LABELS[method],
        count,
        percentage: totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0,
      };
    })
    .filter((item) => item.count > 0);

  return {
    stats: {
      totalUsers,
      newUsersLast7Days,
      newUsersLast30Days,
      activeSubscribers,
      estimatedMrrCents: activeSubscribers * PRO_PLAN_PRICE_CENTS,
      totalProjects,
      totalAgentRuns,
      totalCreditsUsedHundredths,
      totalTokens,
      providerBreakdown,
      methodBreakdown,
    },
    users: summaries,
    recentUsage,
  };
}

// ── Preview Access Control, Private Email Shares & Presence Lease ────────

function mapPreviewShare(row: typeof projectPreviewShares.$inferSelect): ProjectPreviewShare {
  return {
    id: row.id,
    projectId: row.projectId,
    email: row.email,
    shareKey: row.shareKey,
    note: row.note ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    accessCount: row.accessCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjectPreviewShares(projectId: string): Promise<ProjectPreviewShare[]> {
  if (!db) {
    memory.previewShares ??= [];
    return memory.previewShares
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ ownerId: _ignored, ...rest }) => {
        void _ignored;
        return rest;
      });
  }
  const rows = await db
    .select()
    .from(projectPreviewShares)
    .where(eq(projectPreviewShares.projectId, projectId))
    .orderBy(desc(projectPreviewShares.createdAt));
  return rows.map(mapPreviewShare);
}

export async function getProjectPreviewAccessState(project: Project): Promise<PreviewAccessState> {
  const shares = await listProjectPreviewShares(project.id);
  const mode: PreviewAccessMode =
    project.previewAccessMode === "public" || project.previewAccessMode === "private"
      ? project.previewAccessMode
      : "owner";
  const publicActive = isPublicPreviewActive(mode, project.previewPublicExpiresAt);
  return {
    mode: mode === "public" && !publicActive ? (shares.length > 0 ? "private" : "owner") : mode,
    publicExpiresAt: publicActive ? (project.previewPublicExpiresAt ?? null) : null,
    publicActive,
    hasPasscode: Boolean(project.previewHasPasscode),
    accessVersion: project.previewAccessVersion ?? 1,
    activeUntil: project.previewActiveUntil ?? null,
    previewUrl: project.previewUrl,
    isPublished: Boolean(project.publishedAt),
    shares,
  };
}

export async function updateProjectPreviewAccess(
  projectId: string,
  ownerId: string,
  patch: {
    mode?: PreviewAccessMode;
    publicDurationHours?: number;
    passcode?: string | null;
    bumpVersion?: boolean;
  },
): Promise<Project | null> {
  const current = await getProject(projectId, ownerId);
  if (!current) return null;

  const nextMode = patch.mode ?? current.previewAccessMode ?? "owner";
  let nextPublicExpiresAt: Date | null = current.previewPublicExpiresAt
    ? new Date(current.previewPublicExpiresAt)
    : null;

  if (nextMode === "public") {
    const hours = Math.max(1, Math.min(168, Math.trunc(patch.publicDurationHours ?? 24)));
    nextPublicExpiresAt = new Date(Date.now() + hours * 60 * 60_000);
  } else if (patch.mode !== undefined) {
    nextPublicExpiresAt = null;
  }

  const nextVersion =
    (current.previewAccessVersion ?? 1) + (patch.bumpVersion || patch.mode === "owner" || patch.passcode !== undefined ? 1 : 0);
  const passcodeHashUpdate =
    patch.passcode === undefined
      ? undefined
      : patch.passcode === null || !patch.passcode.trim()
        ? null
        : await hashPreviewPasscode(patch.passcode.trim());

  if (!db) {
    const idx = memory.projects.findIndex((p) => p.id === projectId && p.ownerId === ownerId);
    if (idx < 0) return null;
    memory.previewPasscodeHashes ??= new Map();
    if (passcodeHashUpdate !== undefined) {
      memory.previewPasscodeHashes.set(projectId, passcodeHashUpdate);
    }
    const updated: Project = {
      ...memory.projects[idx],
      previewAccessMode: nextMode,
      previewPublicExpiresAt: nextPublicExpiresAt?.toISOString() ?? null,
      previewHasPasscode:
        passcodeHashUpdate !== undefined ? Boolean(passcodeHashUpdate) : Boolean(memory.projects[idx].previewHasPasscode),
      previewAccessVersion: nextVersion,
      updatedAt: new Date().toISOString(),
    };
    memory.projects[idx] = updated;
    return updated;
  }

  const [row] = await db
    .update(projects)
    .set({
      previewAccessMode: nextMode,
      previewPublicExpiresAt: nextPublicExpiresAt,
      ...(passcodeHashUpdate !== undefined ? { previewPasscodeHash: passcodeHashUpdate } : {}),
      previewAccessVersion: nextVersion,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .returning();
  return row ? mapProject(row) : null;
}

export async function verifyProjectPreviewPasscode(projectId: string, candidate: string): Promise<boolean> {
  if (!candidate.trim()) return false;
  if (!db) {
    memory.previewPasscodeHashes ??= new Map();
    return verifyPreviewPasscode(candidate.trim(), memory.previewPasscodeHashes.get(projectId) ?? null);
  }
  const [row] = await db
    .select({ hash: projects.previewPasscodeHash })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return verifyPreviewPasscode(candidate.trim(), row?.hash ?? null);
}

export async function createOrUpdateProjectPreviewShare(input: {
  projectId: string;
  ownerId: string;
  email: string;
  note?: string | null;
  expiresInHours?: number | null;
}): Promise<ProjectPreviewShare> {
  const email = normalizeInviteEmail(input.email);
  const shareKey = createPreviewShareKey();
  const expiresAt =
    typeof input.expiresInHours === "number" && input.expiresInHours > 0
      ? new Date(Date.now() + Math.min(24 * 30, input.expiresInHours) * 60 * 60_000)
      : null;
  const note = input.note?.trim() ? input.note.trim().slice(0, 120) : null;

  if (!db) {
    memory.previewShares ??= [];
    const pIdx = memory.projects.findIndex((p) => p.id === input.projectId && p.ownerId === input.ownerId);
    if (pIdx >= 0 && (memory.projects[pIdx].previewAccessMode ?? "owner") === "owner") {
      memory.projects[pIdx] = {
        ...memory.projects[pIdx],
        previewAccessMode: "private",
        updatedAt: new Date().toISOString(),
      };
    }
    const existingIdx = memory.previewShares.findIndex(
      (item) => item.projectId === input.projectId && item.email === email,
    );
    const nowIso = new Date().toISOString();
    if (existingIdx >= 0) {
      const updated = {
        ...memory.previewShares[existingIdx],
        shareKey,
        note,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
      memory.previewShares[existingIdx] = updated;
      const { ownerId: _ignored, ...view } = updated;
      void _ignored;
      return view;
    }
    const created: ProjectPreviewShare & { ownerId: string } = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      ownerId: input.ownerId,
      email,
      shareKey,
      note,
      expiresAt: expiresAt?.toISOString() ?? null,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: nowIso,
    };
    memory.previewShares.unshift(created);
    const { ownerId: _ignored, ...view } = created;
    void _ignored;
    return view;
  }

  const [row] = await db
    .insert(projectPreviewShares)
    .values({
      projectId: input.projectId,
      ownerId: input.ownerId,
      email,
      shareKey,
      note,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [projectPreviewShares.projectId, projectPreviewShares.email],
      set: {
        shareKey,
        note,
        expiresAt,
      },
    })
    .returning();

  // If the project was owner-only, promote to "private" so invited users can access it immediately.
  const [proj] = await db
    .select({ mode: projects.previewAccessMode })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.ownerId, input.ownerId)))
    .limit(1);
  if (proj && proj.mode === "owner") {
    await db
      .update(projects)
      .set({ previewAccessMode: "private", updatedAt: new Date() })
      .where(and(eq(projects.id, input.projectId), eq(projects.ownerId, input.ownerId)));
  }

  return mapPreviewShare(row);
}

export async function revokeProjectPreviewShare(
  projectId: string,
  ownerId: string,
  shareId: string,
): Promise<boolean> {
  if (!db) {
    memory.previewShares ??= [];
    const before = memory.previewShares.length;
    memory.previewShares = memory.previewShares.filter(
      (item) => !(item.id === shareId && item.projectId === projectId && item.ownerId === ownerId),
    );
    if (memory.previewShares.length === before) return false;
    const pIdx = memory.projects.findIndex((p) => p.id === projectId && p.ownerId === ownerId);
    if (pIdx >= 0) {
      const remaining = memory.previewShares.some((item) => item.projectId === projectId);
      memory.projects[pIdx] = {
        ...memory.projects[pIdx],
        ...(memory.projects[pIdx].previewAccessMode === "private" && !remaining
          ? { previewAccessMode: "owner" as const }
          : {}),
        previewAccessVersion: (memory.projects[pIdx].previewAccessVersion ?? 1) + 1,
      };
    }
    return true;
  }

  const deleted = await db
    .delete(projectPreviewShares)
    .where(
      and(
        eq(projectPreviewShares.id, shareId),
        eq(projectPreviewShares.projectId, projectId),
        eq(projectPreviewShares.ownerId, ownerId),
      ),
    )
    .returning({ id: projectPreviewShares.id });

  if (deleted.length === 0) return false;

  const remainingRows = await db
    .select({ id: projectPreviewShares.id })
    .from(projectPreviewShares)
    .where(eq(projectPreviewShares.projectId, projectId))
    .limit(1);

  // Bump previewAccessVersion so any active guest cookie for the revoked share stops working immediately.
  await db
    .update(projects)
    .set({
      ...(remainingRows.length === 0
        ? {
            previewAccessMode: sql`CASE WHEN ${projects.previewAccessMode} = 'private' THEN 'owner' ELSE ${projects.previewAccessMode} END`,
          }
        : {}),
      previewAccessVersion: sql`${projects.previewAccessVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));

  return true;
}

export async function revokeAllProjectPreviewShares(projectId: string, ownerId: string): Promise<void> {
  if (!db) {
    memory.previewShares = (memory.previewShares ?? []).filter(
      (item) => !(item.projectId === projectId && item.ownerId === ownerId),
    );
    await updateProjectPreviewAccess(projectId, ownerId, {
      mode: "owner",
      passcode: null,
      bumpVersion: true,
    });
    return;
  }
  await db
    .delete(projectPreviewShares)
    .where(and(eq(projectPreviewShares.projectId, projectId), eq(projectPreviewShares.ownerId, ownerId)));
  await updateProjectPreviewAccess(projectId, ownerId, {
    mode: "owner",
    passcode: null,
    bumpVersion: true,
  });
}

export async function findPreviewShareByKey(
  projectId: string,
  shareKey: string,
): Promise<ProjectPreviewShare | null> {
  if (!shareKey.trim()) return null;
  if (!db) {
    const found = (memory.previewShares ?? []).find(
      (item) => item.projectId === projectId && item.shareKey === shareKey.trim(),
    );
    if (!found) return null;
    const { ownerId: _ignored, ...view } = found;
    void _ignored;
    return view;
  }
  const [row] = await db
    .select()
    .from(projectPreviewShares)
    .where(
      and(
        eq(projectPreviewShares.projectId, projectId),
        eq(projectPreviewShares.shareKey, shareKey.trim()),
      ),
    )
    .limit(1);
  return row ? mapPreviewShare(row) : null;
}

export async function findPreviewShareByEmail(
  projectId: string,
  email: string,
): Promise<ProjectPreviewShare | null> {
  const norm = normalizeInviteEmail(email);
  if (!norm) return null;
  if (!db) {
    const found = (memory.previewShares ?? []).find(
      (item) => item.projectId === projectId && item.email === norm,
    );
    if (!found) return null;
    const { ownerId: _ignored, ...view } = found;
    void _ignored;
    return view;
  }
  const [row] = await db
    .select()
    .from(projectPreviewShares)
    .where(and(eq(projectPreviewShares.projectId, projectId), eq(projectPreviewShares.email, norm)))
    .limit(1);
  return row ? mapPreviewShare(row) : null;
}

export async function recordPreviewShareAccess(shareId: string): Promise<void> {
  const now = new Date();
  if (!db) {
    const item = (memory.previewShares ?? []).find((s) => s.id === shareId);
    if (item) {
      item.accessCount += 1;
      item.lastAccessedAt = now.toISOString();
    }
    return;
  }
  await db
    .update(projectPreviewShares)
    .set({
      accessCount: sql`${projectPreviewShares.accessCount} + 1`,
      lastAccessedAt: now,
    })
    .where(eq(projectPreviewShares.id, shareId));
}

export async function touchProjectPreviewSession(projectId: string, leaseMs: number): Promise<string> {
  const candidateMs = Date.now() + Math.max(15_000, leaseMs);
  const until = new Date(candidateMs);
  if (!db) {
    const item = memory.projects.find((p) => p.id === projectId);
    if (item) {
      const currentMs = item.previewActiveUntil ? Date.parse(item.previewActiveUntil) : 0;
      const bestMs = Number.isFinite(currentMs) ? Math.max(currentMs, candidateMs) : candidateMs;
      item.previewActiveUntil = new Date(bestMs).toISOString();
      return item.previewActiveUntil;
    }
    return until.toISOString();
  }
  const [row] = await db
    .update(projects)
    .set({
      previewActiveUntil: sql`GREATEST(COALESCE(${projects.previewActiveUntil}, to_timestamp(0)), ${until})`,
    })
    .where(eq(projects.id, projectId))
    .returning({ previewActiveUntil: projects.previewActiveUntil });
  return row?.previewActiveUntil?.toISOString() ?? until.toISOString();
}

export async function clearProjectPreviewSession(
  projectId: string,
  ownerId: string,
  maxOwnerLeaseHorizonMs?: number,
): Promise<void> {
  const cutoff =
    typeof maxOwnerLeaseHorizonMs === "number" && maxOwnerLeaseHorizonMs > 0
      ? new Date(Date.now() + maxOwnerLeaseHorizonMs)
      : null;

  if (!db) {
    const item = memory.projects.find((p) => p.id === projectId && p.ownerId === ownerId);
    if (!item) return;
    if (cutoff && item.previewActiveUntil) {
      const currentMs = Date.parse(item.previewActiveUntil);
      if (Number.isFinite(currentMs) && currentMs > cutoff.getTime()) {
        // Keep longer active guest lease intact while owner closes the editor tab.
        return;
      }
    }
    item.previewActiveUntil = null;
    return;
  }

  await db
    .update(projects)
    .set({ previewActiveUntil: null })
    .where(
      cutoff
        ? and(
            eq(projects.id, projectId),
            eq(projects.ownerId, ownerId),
            lte(projects.previewActiveUntil, cutoff),
          )
        : and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)),
    );
}

export async function getProjectPreviewLeaseStatus(projectId: string): Promise<string | null> {
  if (!db) {
    return memory.projects.find((p) => p.id === projectId)?.previewActiveUntil ?? null;
  }
  const [row] = await db
    .select({ previewActiveUntil: projects.previewActiveUntil })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.previewActiveUntil?.toISOString() ?? null;
}
