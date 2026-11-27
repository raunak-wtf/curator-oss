import { encryptSecret, decryptSecret } from './secrets-crypto';
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { agentApprovals, attachments, githubConnections, messages, projectAnalyticsEvents, projectConsoleLogs, projectDomains, projectFiles, projectRepositories, projects, users, projectSecrets, projectCloud, skills } from "./db/schema";
import { previewSlugForProjectId } from "./domains";
import { SKILLS_PER_ACCOUNT, SkillRequestError } from "./skills";
import type {
  AgentApprovalDecision,
  AgentApprovalItem,
  AgentApprovalRequest,
  AnalyticsDevice,
  AnalyticsEventRecord,
  Attachment,
  Message,
  MessageRole,
  Project,
  ProjectAnalyticsSummary,
  ProjectDomain,
  ProjectDomainStatus,
  ProjectFile,
  ProjectStatus,
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
  PreviewConsoleEntry,
  PreviewConsoleInput,
  PreviewConsoleLevel,
  PreviewConsoleSource,
} from "./types";
import {
  PREVIEW_CONSOLE_MAX_ENTRIES,
  computeConsoleFingerprint,
  isIgnorableConsoleError,
  redactConsoleSecrets,
} from "./preview-console";
import { titleFromPrompt } from "./utils";

/** Plain token values. Expiry fields are null for OAuth App tokens, which do not expire. */
export type GitHubTokens = {
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

type MemoryStore = {
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
memory.domains ??= [];
memory.repositoryCache ??= new Map();
memory.secrets ??= [];
memory.clouds ??= [];
memory.skills ??= [];
memory.githubConnections ??= [];
memory.repositories ??= [];
memory.analyticsEvents ??= [];
memory.consoleLogs ??= [];

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

export async function ensureUser(viewer: Viewer) {
  if (!db) return;
  await db
    .insert(users)
    .values({
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      avatarUrl: viewer.picture,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: viewer.email,
        name: viewer.name,
        avatarUrl: viewer.picture,
        updatedAt: new Date(),
      },
    });

  if (!viewer.emailVerified) return;
  const normalizedEmail = viewer.email.trim().toLowerCase();
  const legacyIdentities = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${normalizedEmail}`, ne(users.id, viewer.id)));
  for (const identity of legacyIdentities) {
    await db.update(projects).set({ ownerId: viewer.id }).where(eq(projects.ownerId, identity.id));
    await db.update(attachments).set({ ownerId: viewer.id }).where(eq(attachments.ownerId, identity.id));
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
