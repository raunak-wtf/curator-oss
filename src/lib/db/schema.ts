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
  authProvider: text("auth_provider").default("unknown").notNull(),
  authProviderLabel: text("auth_provider_label").default("Unknown").notNull(),
  authMethod: text("auth_method").default("oauth").notNull(),
  authSubject: text("auth_subject"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
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
    /** Preview access control: "owner" (default), "public" (24h timed), or "private" (email-verified invites). */
    previewAccessMode: text("preview_access_mode").default("owner").notNull(),
    previewPublicExpiresAt: timestamp("preview_public_expires_at", { withTimezone: true }),
    previewPasscodeHash: text("preview_passcode_hash"),
    previewAccessVersion: integer("preview_access_version").default(1).notNull(),
    /** Active editor/viewer presence lease; unpublished previews auto-pause after Curator closes. */
    previewActiveUntil: timestamp("preview_active_until", { withTimezone: true }),
    /** Persistent per-project instructions ("Knowledge") injected into agent runs. */
    customInstructions: text("custom_instructions").default("").notNull(),
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


/** Cookieless edge pageview events for published apps (no raw IPs or cookies stored). */
export const projectAnalyticsEvents = pgTable(
  "project_analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    path: text("path").notNull(),
    referrerHost: text("referrer_host"),
    device: text("device").default("desktop").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    statusCode: integer("status_code").default(200).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("project_analytics_project_created_idx").on(table.projectId, table.createdAt)],
);

/** Persistent runtime console, network, and dev-server log entries per project (secrets redacted). */
export const projectConsoleLogs = pgTable(
  "project_console_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source").default("browser").notNull(),
    level: text("level").default("log").notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    route: text("route"),
    statusCode: integer("status_code"),
    fingerprint: text("fingerprint").notNull(),
    repeatCount: integer("repeat_count").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("project_console_logs_project_created_idx").on(table.projectId, table.createdAt)],
);

/** Single-plan ($10/month Pro, no free tier) Dodo Payments subscription + Lovable-style credit balance per user. */
export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    planCode: text("plan_code").default("pro_monthly").notNull(),
    status: text("status").default("inactive").notNull(),
    priceCents: integer("price_cents").default(1000).notNull(),
    currency: text("currency").default("USD").notNull(),
    dodoCustomerId: text("dodo_customer_id"),
    dodoSubscriptionId: text("dodo_subscription_id"),
    dodoProductId: text("dodo_product_id"),
    monthlyCreditsHundredths: integer("monthly_credits_hundredths").default(9000).notNull(),
    creditsBalanceHundredths: integer("credits_balance_hundredths").default(0).notNull(),
    creditsUsedThisPeriodHundredths: integer("credits_used_this_period_hundredths").default(0).notNull(),
    lifetimeCreditsUsedHundredths: integer("lifetime_credits_used_hundredths").default(0).notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    lastPaymentId: text("last_payment_id"),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_subscriptions_dodo_sub_unique").on(table.dodoSubscriptionId),
    index("user_subscriptions_status_idx").on(table.status),
  ],
);

/** Granular per-run credit and token usage ledger (Lovable-style effort-based metering). */
export const creditUsageEvents = pgTable(
  "credit_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    messageId: uuid("message_id"),
    mode: text("mode").default("build").notNull(),
    complexityTier: text("complexity_tier").default("standard").notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),
    turns: integer("turns").default(1).notNull(),
    toolCalls: integer("tool_calls").default(0).notNull(),
    filesChanged: integer("files_changed").default(0).notNull(),
    commandsRun: integer("commands_run").default(0).notNull(),
    cloudActions: integer("cloud_actions").default(0).notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    creditsHundredths: integer("credits_hundredths").default(0).notNull(),
    description: text("description").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("credit_usage_events_user_created_idx").on(table.userId, table.createdAt),
    index("credit_usage_events_created_idx").on(table.createdAt),
  ],
);

/** Processed Dodo Payments webhook event IDs for strict idempotency. */
export const billingWebhookEvents = pgTable("billing_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Email-scoped private preview invitations (`/auth?key=<shareKey>`). */
export const projectPreviewShares = pgTable(
  "project_preview_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    shareKey: text("share_key").notNull(),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_preview_shares_key_unique").on(table.shareKey),
    unique("project_preview_shares_project_email_unique").on(table.projectId, table.email),
    index("project_preview_shares_project_idx").on(table.projectId, table.createdAt),
  ],
);
