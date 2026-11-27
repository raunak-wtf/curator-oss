import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AgentApprovalDecision, AgentApprovalItem, GitSyncStatus, ProjectMode, RepositoryCommit, SecuritySource } from "../types";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    status: text("status").default("draft").notNull(),
    coverGradient: text("cover_gradient").default("aurora").notNull(),
    sandboxId: text("sandbox_id"),
    previewUrl: text("preview_url"),
    publishSlug: text("publish_slug"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Shows the small "Edit with Curator" badge on the published app. */
    showBadge: boolean("show_badge").default(true).notNull(),
    /** Lets anyone with the remix link copy this project's code into their own project. */
    publicRemix: boolean("public_remix").default(false).notNull(),
    /** "build" for app projects; "security" for read-only security reviews of a GitHub repository. */
    mode: text("mode").$type<ProjectMode>().default("build").notNull(),
    /** Security mode: the repository being reviewed. Cognix only ever reads it. */
    securitySource: jsonb("security_source").$type<SecuritySource>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt),
    uniqueIndex("projects_publish_slug_unique").on(table.publishSlug),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("messages_project_created_idx").on(table.projectId, table.createdAt)],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content"),
    size: integer("size").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("project_files_project_path_unique").on(table.projectId, table.path),
    index("project_files_project_idx").on(table.projectId),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    sandboxPath: text("sandbox_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("attachments_project_idx").on(table.projectId)],
);

export const projectDomains = pgTable(
  "project_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    status: text("status").default("pending").notNull(),
    verificationToken: text("verification_token").notNull(),
    managedByProvider: boolean("managed_by_provider").default(false).notNull(),
    lastError: text("last_error"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_domains_hostname_unique").on(table.hostname),
    index("project_domains_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const projectSecrets = pgTable(
  "project_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    managedBy: text("managed_by").default("user").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("project_secrets_project_name_unique").on(table.projectId, table.name)],
);

export const projectCloud = pgTable(
  "project_cloud",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").default("disabled").notNull(),
    neonProjectId: text("neon_project_id"),
    neonRegion: text("neon_region"),
    storageEnabled: boolean("storage_enabled").default(false).notNull(),
    appTokenHash: text("app_token_hash"),
    authEnabled: boolean("auth_enabled").default(false).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    source: text("source").default("manual").notNull(),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("skills_owner_name_unique").on(table.ownerId, table.name)],
);

/** One GitHub account per Cognix user. The OAuth token is AES-256-GCM encrypted and never leaves the server. */
export const githubConnections = pgTable("github_connections", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  githubUserId: text("github_user_id").notNull(),
  login: text("login").notNull(),
  avatarUrl: text("avatar_url"),
  scopes: text("scopes").default("").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  tokenAuthTag: text("token_auth_tag").notNull(),
  /** GitHub Apps issue expiring tokens with a single-use refresh token. OAuth Apps leave these empty. */
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  refreshCiphertext: text("refresh_ciphertext"),
  refreshIv: text("refresh_iv"),
  refreshAuthTag: text("refresh_auth_tag"),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** The GitHub repository a project commits to. */
export const projectRepositories = pgTable("project_repositories", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  repoId: text("repo_id").notNull(),
  fullName: text("full_name").notNull(),
  htmlUrl: text("html_url").notNull(),
  defaultBranch: text("default_branch").notNull(),
  private: boolean("private").default(true).notNull(),
  autoCommit: boolean("auto_commit").default(true).notNull(),
  /** The remote head Cognix last synced with. A different head means someone pushed outside Cognix. */
  syncBaseSha: text("sync_base_sha"),
  /** Paths Cognix committed last time, so files deleted in the sandbox are deleted on GitHub too. */
  syncedPaths: jsonb("synced_paths").$type<string[]>().default([]).notNull(),
  lastCommitSha: text("last_commit_sha"),
  lastCommitUrl: text("last_commit_url"),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  lastError: text("last_error"),
  /** Last sync status and commit list fetched from GitHub, shown instantly when Git Control opens. */
  cachedSync: jsonb("cached_sync").$type<GitSyncStatus>(),
  cachedCommits: jsonb("cached_commits").$type<RepositoryCommit[]>(),
  /** Null when the cached commits are out of date (after a push or pull). */
  commitsFetchedAt: timestamp("commits_fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Request review mode: actions a running agent is waiting on. The run polls this row for the user's decision. */
export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    items: jsonb("items").$type<AgentApprovalItem[]>().notNull(),
    decisions: jsonb("decisions").$type<AgentApprovalDecision[]>(),
    /** pending → resolved (user answered) or expired (no answer in time). */
    status: text("status").$type<"pending" | "resolved" | "expired">().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("agent_approvals_project_status_idx").on(table.projectId, table.status)],
);
