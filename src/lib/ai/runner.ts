import { randomBytes } from "node:crypto";
import path from "node:path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ensureProjectStorageBucket, isBucketlineConfigured, listProjectBuckets } from "../cloud/bucketline";
import { ensureProjectNeonDatabase, inspectProjectTables, isNeonApiConfigured } from "../cloud/neon";
import {
  buildDevServerCommand,
  ensureSandbox,
  getPreviewHealth,
  getPreviewUrl,
  getProjectFsRoot,
  getProjectRoot,
  readSandboxRuntimeLogs,
  restartDevelopmentPreview,
  syncProjectEnv,
} from "../daytona";
import { extractServerErrorsFromLog, redactConsoleSecrets, selectActionableConsoleErrors } from "../preview-console";
import { isSecretsEncryptionConfigured } from "../secrets-crypto";
import {
  appendProjectConsoleLogs,
  clearProjectConsoleLogs,
  createAgentApproval,
  createMessage,
  expireAgentApproval,
  getAgentApprovalDecisions,
  getDecryptedSecrets,
  getProjectCloud,
  getProjectRepository,
  listProjectConsoleLogs,
  listSecretNames,
  recordAgentRunMetric,
  recordCreditUsage,
  refundReservedCredits,
  updateAttachmentSandboxPath,
  updateMessageMetadata,
  updateProject,
  updateProjectCloud,
  upsertSecret,
} from "../store";
import { calculateAgentCredits, estimateTokensFromChars } from "../credits";
import { createSignedObjectReadUrl, downloadObject } from "../storage";
import type {
  AgentApprovalDecision,
  AgentEvent,
  AgentQuestionRequest,
  AgentRunActivity,
  ApprovalMode,
  Attachment,
  BuildChatMode,
  FileChangeSnapshot,
  GitHubCommitInfo,
  Message,
  Project,
  Skill,
  VisualElementSelection,
} from "../types";
import { safeFileName } from "../utils";
import { ensureVisualEditBridge } from "../visual-edit-bridge";
import { isProductionBuildCommand, resolveAgentMaxTurns, shouldRefreshAgentContext } from "./agent-policy";
import type { CloudFeature } from "../cloud-features";
import { CLOUD_GUIDES } from "./cloud-guides";
import { inferPromptCloudFeatures } from "./cloud-intent";
import { streamModelTurnWithRetry } from "./model-stream";
import { buildPlanSystemPrompt, buildSystemPrompt, type PromptCloudState } from "./system-prompt";
import { buildMultimodalUserContent, hasNativeFileParts } from "./multimodal";
import {
  createTerminalLog,
  isDependencyInstallCommand,
  isPreviewStartCommand,
  parseRunCommandOutput,
} from "./terminal-log";
import {
  getPerformanceArchitectureMetadata,
  isBoundedAgentEnabled,
  isContextCompactionEnabled,
  isOneBuildPolicyEnabled,
  isScaffoldBootstrapEnabled,
} from "../feature-flags";
import { materializeProjectScaffold } from "../scaffold/bootstrap";
import { buildDeterministicCommitMessage } from "./autofix";
import { compactAgentMessages, shouldCompactContext, truncateCommandOutputDeterministically } from "./context-compaction";
import { parseBuildDiagnostics } from "./diagnostic-parser";
import { createFrontendDesignBlueprint, renderFrontendDesignBlueprint } from "./frontend-design-blueprint";
import { createAgentLoopGuard, resolveAdaptiveTurnBudget } from "./loop-guard";
import { createRunPerformanceTracker } from "./run-performance";
import { interactiveTools, isInteractiveTool, runInteractiveTool } from "./interactive-tools";
import { cloudProviderTools, executeCloudProviderTool, isCloudProviderTool } from "./cloud-tools";
import { GITHUB_TOOL_NAME, githubTool, runGitHubCommit } from "./github-tool";
import { changesFromSnapshots, writeCommitMessage } from "./commit-message";
import { pullBeforeBuild } from "../github/sync";
import { importSecuritySource } from "../github/security-source";
import { SECURITY_EXCLUDED_TOOLS, buildSecurityPrompt } from "./security-prompt";
import { APPROVAL_TOOLS, PULL_REQUEST_TOOL_NAME, describeApproval, pullRequestTool, runPullRequestProposal } from "./security-tools";
import { agentTools, executeAgentTool } from "./tools";

export const isAgentConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

/** How long a Request review approval waits before the action is treated as denied. */
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

type Emit = (event: AgentEvent) => void | Promise<void>;

function parseToolInput(value: string) {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

/** The file, command, or query a tool call acted on, so the chat can open it in the right tab. */
function activityTarget(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((key) => value[key]).find((item): item is string => typeof item === "string" && item.length > 0);
  if (name === "run_command") return pick("command")?.slice(0, 300);
  if (name === "move_file") return pick("destination", "source");
  if (name === "search_files" || name === "web_search") return pick("query")?.slice(0, 200);
  if (name === "fetch_url") return pick("url")?.slice(0, 300);
  if (name === "neon_database" || name === "resend_email" || name === "cloud_storage") return pick("action", "bucket", "key", "name", "sql")?.slice(0, 200);
  if (name === "read_design_guide") return pick("topic")?.slice(0, 100);
  if (name === "read_cloud_guide") return pick("feature")?.slice(0, 100);
  return pick("path", "directory")?.slice(0, 300);
}

function isNativeFileCompatibilityError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
  const message = error instanceof Error ? error.message : "";
  return [400, 415, 422].includes(status ?? 0)
    || /unsupported.*file|file.*unsupported|invalid.*content.*type|content.*type.*file/i.test(message);
}

function runErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "ModelStreamTimeoutError") return "model_timeout";
  if (/rate limit|too many requests|\b429\b/i.test(message)) return "model_rate_limit";
  if (/sandbox|workspace/i.test(message)) return "sandbox";
  if (/dependency installation failed|npm install/i.test(message)) return "dependency_install";
  if (/production build failed|npm run build/i.test(message)) return "production_build";
  if (/development server|preview/i.test(message)) return "preview";
  if (/database|drizzle|migration/i.test(message)) return "database";
  return "unknown";
}

function withFastTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function loadLiveCloudSummaries(project: Project, decryptedSecrets: Record<string, string>) {
  const dbUrl = decryptedSecrets.DATABASE_URL;
  const activeBucket = decryptedSecrets.S3_BUCKET;

  const [tables, buckets] = await Promise.all([
    dbUrl ? withFastTimeout(inspectProjectTables(dbUrl), 5_500, []) : Promise.resolve([]),
    isBucketlineConfigured() ? withFastTimeout(listProjectBuckets(project.id), 4_500, []) : Promise.resolve([]),
  ]);

  let liveDatabaseSummary: string | undefined;
  if (dbUrl) {
    if (tables.length === 0) {
      liveDatabaseSummary =
        "- **Cloud Database (PostgreSQL)**: Connected (`DATABASE_URL` & `DIRECT_URL` ready in `.env.local`), currently **0 tables** in `public` — define `schema.ts` and run `npx drizzle-kit generate && npx drizzle-kit push --force`.";
    } else {
      const tableLines = tables.slice(0, 20).map((table) => {
        const cols = table.columns
          .slice(0, 12)
          .map((c) => `${c.name}:${c.dataType}`)
          .join(", ");
        const more = table.columns.length > 12 ? `, +${table.columns.length - 12} more` : "";
        return `  - \`${table.schema}.${table.name}\` (~${table.estimatedRows} rows): ${cols}${more}`;
      });
      liveDatabaseSummary = `- **Cloud Database (PostgreSQL)**: Connected — ${tables.length} live ${tables.length === 1 ? "table" : "tables"}:\n${tableLines.join("\n")}`;
    }
  }

  let liveStorageSummary: string | undefined;
  if (buckets.length > 0) {
    const list = buckets
      .slice(0, 8)
      .map((b) => `\`${b.name}\` (${b.accessMode}${b.name === activeBucket ? ", active in `.env.local`" : ""}, ${b.objectCount} objects)`)
      .join(", ");
    liveStorageSummary = `- **Cloud Storage**: ${list}.`;
  } else if (activeBucket) {
    liveStorageSummary = `- **Cloud Storage**: Active bucket \`${activeBucket}\` (${decryptedSecrets.S3_ACCESS_MODE || "private"} mode).`;
  }

  return { liveDatabaseSummary, liveStorageSummary };
}

function extractPgTableNamesFromSchemaSource(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bpgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

export async function runAgent(input: {
  project: Project;
  prompt: string;
  history: Message[];
  attachments: Attachment[];
  visualSelections: VisualElementSelection[];
  skills?: Skill[];
  /** Security mode only: whether file changes and commands wait for the user's approval. */
  approvalMode?: ApprovalMode;
  /** Build mode only: "plan" inspects read-only and returns an implementation plan without modifying files. */
  chatMode?: BuildChatMode;
  /** Pre-reserved credit hold in hundredths to settle at completion or refund on pre-LLM error. */
  reservedCreditsHundredths?: number;
  emit: Emit;
}) {
  const { emit, prompt } = input;
  const runStartedAt = Date.now();
  const runMetricId = crypto.randomUUID();
  const runPerformance = createRunPerformanceTracker(runStartedAt);
  runPerformance.setArchitecture(getPerformanceArchitectureMetadata());
  runPerformance.enterStage("sandbox", runStartedAt);
  const approvalMode: ApprovalMode = input.approvalMode ?? "auto";
  const planMode = input.project.mode !== "security" && input.chatMode === "plan";
  const requestedRunMode: "build" | "plan" | "security" = input.project.mode === "security" ? "security" : planMode ? "plan" : "build";
  const reservedHold = Math.max(0, Math.trunc(input.reservedCreditsHundredths ?? 0));
  async function persistEarlyRunMetric(messageId: string | null, errorCategory: string) {
    const completedAt = new Date();
    await recordAgentRunMetric({
      id: runMetricId,
      projectId: input.project.id,
      userId: input.project.ownerId,
      messageId,
      mode: requestedRunMode,
      status: "error",
      errorCategory,
      startedAt: new Date(runStartedAt).toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs: completedAt.getTime() - runStartedAt,
      performance: runPerformance.snapshot({
        activities: [],
        commands: { count: 0, failed: 0, durationMs: 0, background: 0, productionBuilds: 0, installs: 0, previewStarts: 0 },
        nowMs: completedAt.getTime(),
      }),
    }).catch(() => undefined);
  }

  if (!isAgentConfigured) {
    if (reservedHold > 0) {
      await refundReservedCredits(input.project.ownerId, reservedHold).catch(() => undefined);
    }
    await emit({ type: "status", label: "Waiting for a model connection" });
    const content =
      "Cognix is ready to build this project, but the AI model connection is not configured on this server yet.";
    for (const chunk of content.match(/.{1,28}/g) ?? [content]) {
      await emit({ type: "token", value: chunk });
    }
    const message = await createMessage(input.project.id, "assistant", content, { configurationRequired: true });
    await emit({ type: "done", messageId: message.id });
    await persistEarlyRunMetric(message.id, "model_not_configured");
    return message;
  }

  await emit({ type: "status", label: "Starting a secure workspace" });
  let ensured: Awaited<ReturnType<typeof ensureSandbox>> | null = null;
  let lastSandboxError: unknown;
  for (let sandboxAttempt = 1; sandboxAttempt <= 3; sandboxAttempt += 1) {
    try {
      ensured = await ensureSandbox(input.project);
      break;
    } catch (error) {
      lastSandboxError = error;
      if (sandboxAttempt >= 3) {
        if (reservedHold > 0) {
          await refundReservedCredits(input.project.ownerId, reservedHold).catch(() => undefined);
        }
        await persistEarlyRunMetric(null, "sandbox");
        throw error;
      }
      await emit({ type: "status", label: `Reconnecting workspace (attempt ${sandboxAttempt + 1}/3)…` });
      await new Promise((resolve) => setTimeout(resolve, 1_000 * sandboxAttempt));
    }
  }
  if (!ensured) throw (lastSandboxError instanceof Error ? lastSandboxError : new Error("Could not start workspace."));
  runPerformance.enterStage("setup");
  const { sandbox, project: sandboxProject } = ensured;
  let project = sandboxProject;
  const security = project.mode === "security";
  const projectRoot = await getProjectRoot(sandbox);
  const projectFsRoot = getProjectFsRoot();
  await sandbox.process.executeCommand("mkdir -p app", path.posix.dirname(projectRoot), undefined, 30);
  if (security && project.securitySource) {
    // Security mode: bring in the latest commit of the repository. Unpushed changes in the sandbox are kept.
    await emit({ type: "status", label: `Checking ${project.securitySource.fullName} for new commits` });
    const imported = await importSecuritySource(project, sandbox, projectRoot);
    if (imported?.changed) {
      project = { ...project, securitySource: imported.source };
      await emit({ type: "status", label: `Imported ${imported.fileCount} files at ${imported.sha.slice(0, 7)}` });
      await emit({ type: "files_changed", paths: [] });
    } else if (imported?.kept) {
      await emit({ type: "status", label: "Keeping your unpushed changes" });
    }
  }
  if (!security) await ensureVisualEditBridge(sandbox, projectRoot, projectFsRoot).catch(() => null);
  await emit({ type: "status", label: security ? "Working on the repository" : "Inspecting the project" });
  if (input.skills?.length) {
    await emit({ type: "status", label: `Applying ${input.skills.map((skill) => `/${skill.name}`).join(", ")}` });
  }
  const runActivity: AgentRunActivity[] = [];
  let decryptedSecrets = await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>));
  const terminal = createTerminalLog(emit, Object.values(decryptedSecrets));
  const runMode = requestedRunMode;
  async function persistRunMetric(
    status: "completed" | "checkpoint" | "awaiting_user" | "error",
    messageId: string | null,
    errorCategory: string | null = null,
  ) {
    const completedAt = new Date();
    await recordAgentRunMetric({
      id: runMetricId,
      projectId: project.id,
      userId: project.ownerId,
      messageId,
      mode: runMode,
      status,
      errorCategory,
      startedAt: new Date(runStartedAt).toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs: completedAt.getTime() - runStartedAt,
      performance: runPerformance.snapshot({ activities: runActivity, commands: terminal.stats, nowMs: completedAt.getTime() }),
    }).catch(() => undefined);
  }
  const [cloud, secretNames, linkedRepository, recentConsoleEntries] = await Promise.all([
    getProjectCloud(project.id).catch(() => null),
    listSecretNames(project.id).then((items) => items.map((item) => item.name)).catch(() => [] as string[]),
    getProjectRepository(project.id, project.ownerId).catch(() => null),
    !security ? listProjectConsoleLogs(project.id, 40).catch(() => []) : Promise.resolve([]),
  ]);
  // Security reviews never sync or push, even if a repository is linked in Git Control.
  const repository = security ? null : linkedRepository;
  // Distinguish "never configured yet" (`cloud === null`) from "user explicitly turned Cloud off" (`cloud.status === "disabled"`).
  const cloudExplicitlyDisabled = cloud !== null && cloud.status === "disabled";
  const canAutoEnableCloud =
    !security &&
    !planMode &&
    !cloudExplicitlyDisabled &&
    isSecretsEncryptionConfigured &&
    (isNeonApiConfigured() || isBucketlineConfigured());

  const cloudState: PromptCloudState = {
    enabled: cloud?.status === "ready",
    secretNames,
    canAutoEnableCloud,
  };
  // v0-style Turn-0 readiness: if automatic Cloud provisioning is active and the prompt clearly needs
  // Database, Auth, Storage, or Email, enable and provision Cognix Cloud *before* Turn 0 so the agent
  // builds the entire full-stack app in one uninterrupted pass without wasting a turn on `request_cognix_cloud`.
  if (canAutoEnableCloud && !cloudState.enabled) {
    const inferredFeatures = inferPromptCloudFeatures(prompt);
    if (inferredFeatures.length > 0) {
      await runPerformance.withStage("cloud", async () => {
        await emit({ type: "status", label: "Provisioning Cognix Cloud" });
        await updateProjectCloud(project.id, {
          status: "ready",
          storageEnabled: true,
          authEnabled: true,
          lastError: null,
        }).catch(() => undefined);
        cloudState.enabled = true;
        await emit({ type: "cloud_status", enabled: true });
      });
    }
  }
  if (!security && cloudState.enabled && isSecretsEncryptionConfigured) {
    await runPerformance.withStage("cloud", async () => {
      let autoProvisioned = false;
      if (!cloudState.secretNames.includes("BETTER_AUTH_SECRET")) {
        await upsertSecret(project.id, "BETTER_AUTH_SECRET", randomBytes(32).toString("base64url"), "cloud").catch(() => undefined);
        autoProvisioned = true;
      }
      if ((!cloudState.secretNames.includes("DATABASE_URL") || !cloud?.neonProjectId) && isNeonApiConfigured()) {
        await emit({ type: "status", label: "Provisioning Cloud Database" });
        try {
          await ensureProjectNeonDatabase(project);
          autoProvisioned = true;
        } catch {
          // Keep running; the agent can inspect status or retry via cloud tools if needed.
        }
      }
      if (!cloudState.secretNames.includes("S3_BUCKET") && isBucketlineConfigured()) {
        await emit({ type: "status", label: "Provisioning Cloud Storage" });
        try {
          await ensureProjectStorageBucket(project);
          autoProvisioned = true;
        } catch {
          // Keep running; storage tool can report details if needed.
        }
      }
      if (autoProvisioned) {
        const [freshSecrets, freshNames] = await Promise.all([
          getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
          listSecretNames(project.id).then((items) => items.map((item) => item.name)).catch(() => cloudState.secretNames),
        ]);
        decryptedSecrets = freshSecrets;
        terminal.addSecrets(Object.values(freshSecrets));
        cloudState.secretNames = freshNames;
      }
    });
  }
  if (!security && cloudState.secretNames.length > 0) {
    await runPerformance.withStage("cloud", async () => {
      await syncProjectEnv(project).catch(() => undefined);
    });
  }
  if (!security && cloudState.enabled) {
    await runPerformance.withStage("cloud", async () => {
      const liveSummaries = await loadLiveCloudSummaries(project, decryptedSecrets);
      cloudState.liveDatabaseSummary = liveSummaries.liveDatabaseSummary;
      cloudState.liveStorageSummary = liveSummaries.liveStorageSummary;
    });
  }
  let scaffoldAppliedNote = "";
  if (!security && !planMode && isScaffoldBootstrapEnabled()) {
    const bootstrapped = await runPerformance.withStage("scaffold", () =>
      materializeProjectScaffold({
        project,
        sandbox,
        projectRoot,
        projectFsRoot,
        prompt,
        cloudEnabled: cloudState.enabled,
        onStatus: (label) => emit({ type: "status", label }),
      }).catch(() => ({ applied: false as const, reason: "failed" as const })),
    );
    if (bootstrapped.applied) {
      if (bootstrapped.previewUrl) {
        runPerformance.markFirstPreview();
        await updateProject(project.id, project.ownerId, {
          previewUrl: bootstrapped.previewUrl,
        }).catch(() => undefined);
        await emit({ type: "preview", url: bootstrapped.previewUrl, sandboxId: sandbox.id });
      }
      const isBaseOnlyScaffold = bootstrapped.manifest.profiles.length === 1 && bootstrapped.manifest.profiles[0] === "base";
      scaffoldAppliedNote = [
        `Cognix pre-scaffolded this new project (template v${bootstrapped.manifest.templateVersion}, profiles: ${bootstrapped.manifest.profiles.join(", ")}) with dependencies installed and a live preview running on port 3000. Do NOT rewrite package.json, tsconfig.json, next.config.ts, or postcss.config.mjs unless you need an additional package; build the requested product UI, schema, and routes directly on top of the scaffolded files. Extend the semantic tokens in globals.css and reuse the accessible primitives in src/components/ui before inventing one-off controls; adapt their styling to the chosen visual direction instead of treating them as a fixed theme.`,
        ...(isBaseOnlyScaffold
          ? [
              "This project uses the frontend-only `base` scaffold. Do NOT call `request_cognix_cloud`, provision a database, or install ORM/auth packages unless the user explicitly requested server-side persistence, user accounts, or file uploads; implement contact or inquiry forms with client-side validation and clear confirmation states.",
            ]
          : []),
        ...(isBoundedAgentEnabled()
          ? [
              "Work efficiently within your turn budget: batch independent file writes and edits in parallel each turn, skip redundant re-reads, and run one clean production build (`rm -rf .next && npm run build`) once implementation is complete before finishing.",
            ]
          : []),
      ].join(" ");
    }
  }
  let githubInfo: GitHubCommitInfo | undefined;

  // Two-way sync: commits pushed to the linked branch on GitHub come into the project before the agent starts.
  let githubSyncNote = "";
  if (repository && project.sandboxId) {
    await emit({ type: "status", label: `Checking ${repository.fullName} for changes` });
    const sync = await pullBeforeBuild(project, project.ownerId).catch(() => null);
    if (sync?.pulled) {
      await emit({ type: "status", label: `Synced ${sync.filesChanged} ${sync.filesChanged === 1 ? "file" : "files"} from GitHub` });
      await emit({ type: "files_changed", paths: [] });
    } else if (sync?.status.state === "diverged") {
      githubSyncNote = `GitHub and Cognix have both changed ${repository.defaultBranch}. Keep building in the project's current files; when you finish, Cognix pushes its version to the cognix-sync branch and the user resolves it in Git Control.`;
    }
  }

  const stagedAttachments = await Promise.all(
    input.attachments.map(async (attachment) => {
      const activityStartedAt = Date.now();
      const sandboxName = `${attachment.id}-${safeFileName(attachment.name)}`;
      const relativeUploadPath = `uploads/${sandboxName}`;
      const appAssetPath = `public/user-uploads/${sandboxName}`;
      const appAssetUrl = `/user-uploads/${sandboxName}`;
      await emit({ type: "attachment_start", id: attachment.id, path: relativeUploadPath });
      const [buffer, modelUrl] = await Promise.all([
        downloadObject(attachment.objectKey),
        createSignedObjectReadUrl(attachment.objectKey).catch(() => null),
      ]);
      const sandboxPath = attachment.sandboxPath ?? `${projectRoot}/uploads/${sandboxName}`;
      await sandbox.process.executeCommand("mkdir -p uploads public/user-uploads", projectRoot, undefined, 30);
      if (!attachment.sandboxPath) {
        await sandbox.fs.uploadFile(buffer, `${projectFsRoot}/uploads/${sandboxName}`);
        await updateAttachmentSandboxPath(attachment.id, sandboxPath);
      }
      await sandbox.fs.uploadFile(buffer, `${projectFsRoot}/${appAssetPath}`);
      await emit({ type: "attachment_ready", id: attachment.id, path: relativeUploadPath, appUrl: appAssetUrl });
      runActivity.push({
        id: `attachment-${attachment.id}`,
        name: "read_attachment",
        label: `Prepared ${attachment.name}`,
        status: "done",
        durationMs: Date.now() - activityStartedAt,
      });
      return { attachment: { ...attachment, sandboxPath }, buffer, modelUrl, appAssetPath, appAssetUrl };
    }),
  );

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    defaultHeaders: { "User-Agent": "Cognix/1.0" },
    maxRetries: 0,
    timeout: 210_000,
  });

  const history: ChatCompletionMessageParam[] = input.history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-20)
    .map((message) =>
      message.role === "user"
        ? ({ role: "user", content: message.content } satisfies ChatCompletionMessageParam)
        : ({ role: "assistant", content: message.content } satisfies ChatCompletionMessageParam),
    );

  // Surface active preview console errors automatically if the user didn't already click "Fix error"
  const thirtyMinutesAgoIso = new Date(Date.now() - 30 * 60_000).toISOString();
  const activeConsoleErrors = !security
    ? selectActionableConsoleErrors(recentConsoleEntries, { afterIso: thirtyMinutesAgoIso }).slice(-4)
    : [];
  const promptAlreadyContainsErrors = /Fix (?:this|these) runtime errors? detected in the (?:live app preview|running sandbox)/i.test(prompt);
  const consoleContextNote =
    activeConsoleErrors.length > 0 && !promptAlreadyContainsErrors
      ? `\n\n<recent_preview_console_errors>\nRecent errors captured from the live preview console (use \`read_preview_console\` if relevant to this request):\n${activeConsoleErrors
          .map(
            (e) =>
              `- [${e.source}${e.route ? ` ${e.route}` : ""}${e.statusCode ? ` HTTP ${e.statusCode}` : ""}] ${e.message.slice(0, 350)}`,
          )
          .join("\n")}\n</recent_preview_console_errors>`
      : "";

  const isNewProjectRequest = !project.previewUrl && input.history.length === 0;
  const hasVisualReference = input.visualSelections.length > 0
    || stagedAttachments.some((item) => item.attachment.contentType.startsWith("image/"));
  const frontendBlueprint = !security
    ? createFrontendDesignBlueprint({
        prompt,
        isNewProject: isNewProjectRequest,
        hasVisualReference,
      })
    : null;
  const frontendBlueprintContext = renderFrontendDesignBlueprint(frontendBlueprint);
  const effectivePrompt = `${prompt}${consoleContextNote}`;

  const computeSystemPromptContent = () =>
    security
      ? buildSecurityPrompt(project, projectRoot, {
          attachments: stagedAttachments.map((item) => item.attachment),
          skills: input.skills,
          approvalMode,
          secretNames: cloudState.secretNames,
        })
      : planMode
        ? buildPlanSystemPrompt(project, projectRoot, stagedAttachments.map((item) => item.attachment), input.skills, cloudState)
        : `${buildSystemPrompt(project, projectRoot, stagedAttachments.map((item) => item.attachment), input.skills, cloudState, repository)}${frontendBlueprintContext ? `\n\n${frontendBlueprintContext}` : ""}${githubSyncNote ? `\n\n${githubSyncNote}` : ""}${scaffoldAppliedNote ? `\n\n${scaffoldAppliedNote}` : ""}`;

  let messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: computeSystemPromptContent(),
    },
    ...history,
    {
      role: "user",
      content: buildMultimodalUserContent(effectivePrompt, stagedAttachments, { visualSelections: input.visualSelections }),
    },
  ];
  const currentUserMessageIndex = messages.length - 1;
  let nativeFilePartsEnabled = hasNativeFileParts(stagedAttachments);

  const usedTools: string[] = [];
  let activitySequence = 0;
  const changedPaths = new Set<string>();
  const fileChanges = new Map<string, FileChangeSnapshot>();
  let finalContent = "";
  let pendingRequest: AgentQuestionRequest | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let modelTurnsExecuted = 0;
  let streamUsageOptionsSupported = true;

  const CLOUD_ACTION_TOOLS = new Set(["neon_database", "cloud_storage", "resend_email", "request_cognix_cloud"]);

  function approximateMessageChars(list: ChatCompletionMessageParam[]): number {
    let chars = 0;
    for (const msg of list) {
      if (typeof msg.content === "string") chars += msg.content.length;
      else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
            chars += part.text.length;
          } else {
            chars += 400;
          }
        }
      }
    }
    return chars;
  }

  let creditsSettled = false;

  async function chargeRunCredits(messageId: string | null, durationMs: number) {
    if (creditsSettled) {
      return { creditsChargedHundredths: 0, complexityTier: "standard" as const, totalTokens: totalPromptTokens + totalCompletionTokens };
    }
    creditsSettled = true;
    const mode: "build" | "plan" | "security" = security ? "security" : planMode ? "plan" : "build";
    const cloudActions = usedTools.filter((name) => CLOUD_ACTION_TOOLS.has(name)).length;
    const calc = calculateAgentCredits({
      mode,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      turns: Math.max(1, modelTurnsExecuted),
      toolCalls: usedTools.length,
      filesChanged: changedPaths.size,
      commandsRun: terminal.stats.count,
      cloudActions,
      durationMs,
    });
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    await recordCreditUsage({
      userId: project.ownerId,
      projectId: project.id,
      messageId,
      mode,
      complexityTier: calc.complexityTier,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
      turns: Math.max(1, modelTurnsExecuted),
      toolCalls: usedTools.length,
      filesChanged: changedPaths.size,
      commandsRun: terminal.stats.count,
      cloudActions,
      durationMs,
      creditsHundredths: calc.creditsHundredths,
      reservedHundredths: reservedHold,
      description: calc.description,
    }).catch(() => undefined);
    const usageMeta = {
      creditsChargedHundredths: calc.creditsHundredths,
      complexityTier: calc.complexityTier,
      totalTokens,
    };
    if (messageId) {
      await updateMessageMetadata(messageId, project.id, usageMeta).catch(() => undefined);
    }
    return usageMeta;
  }

  /** Saves the turn and stops before the preview steps, because the agent is waiting for the user. */
  async function finishWithQuestions(request: AgentQuestionRequest) {
    runPerformance.enterStage("persistence");
    const content = finalContent.trim()
      || (request.kind === "enable_cloud" ? "This needs Cognix Cloud. Turn it on to continue." : "Before I continue, I need a quick answer.");
    await emit({ type: "token", value: content });
    const changedPathList = [...changedPaths];
    const fileChangeList = [...fileChanges.values()];
    const completedAt = new Date();
    const runDurationMs = completedAt.getTime() - runStartedAt;
    const message = await createMessage(project.id, "assistant", content, {
      tools: usedTools,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      questions: request,
      runStartedAt: new Date(runStartedAt).toISOString(),
      runCompletedAt: completedAt.toISOString(),
      runDurationMs,
      changedPaths: changedPathList,
      fileChanges: fileChangeList,
      ...(changedPathList.length
        ? { summary: `Updated ${changedPathList.length} ${changedPathList.length === 1 ? "file" : "files"}` }
        : {}),
    });
    const usageMeta = await chargeRunCredits(message.id, runDurationMs);
    await updateProject(project.id, project.ownerId, {
      status: project.publishedAt ? "published" : project.previewUrl ? "ready" : "draft",
    });
    await emit({
      type: "done",
      messageId: message.id,
      changedPaths: changedPathList,
      fileChanges: fileChangeList,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      questions: request,
      runDurationMs,
      ...usageMeta,
    });
    await persistRunMetric("awaiting_user", message.id);
    return message;
  }

  let previewReady = false;
  let productionBuildPassed = false;
  let devServerFreshSinceLastBuild = false;
  let runtimeVerifiedClean = false;
  let completionNudges = 0;
  let designVerificationNudgeSent = false;
  let designGuideRead = false;
  let frontendPreviewInspected = false;
  const boundedAgentEnabled = isBoundedAgentEnabled();
  const contextCompactionEnabled = isContextCompactionEnabled();
  const oneBuildPolicyEnabled = isOneBuildPolicyEnabled();
  const inferredCloudCount = inferPromptCloudFeatures(prompt).length;
  const isNewProjectBuild = isNewProjectRequest;
  const adaptiveBudget = resolveAdaptiveTurnBudget({
    mode: runMode,
    prompt,
    isNewProject: isNewProjectBuild,
    cloudFeaturesCount: inferredCloudCount,
    hasVisualSelections: input.visualSelections.length > 0,
    isErrorRepair: promptAlreadyContainsErrors,
  });
  let maxAgentTurns = boundedAgentEnabled ? adaptiveBudget.hardBudget : resolveAgentMaxTurns();
  let wrapUpNudgeSent = false;
  // Security mode: the build tools minus the preview, plus ask_user and the pull request proposal. No commit tool.
  const securityTools = [
    ...agentTools.filter((tool) => tool.type === "function" && !SECURITY_EXCLUDED_TOOLS.has(tool.function.name)),
    ...interactiveTools.filter((tool) => tool.function.name === "ask_user"),
    pullRequestTool,
  ];
  const securityToolNames = new Set(securityTools.map((tool) => tool.function.name));
  const PLAN_READONLY_TOOLS = new Set([
    "list_files",
    "find_files",
    "read_file",
    "read_files",
    "search_files",
    "get_process_logs",
    "list_processes",
    "inspect_preview",
    "read_preview_console",
    "web_search",
    "fetch_url",
  ]);
  const getPlanTools = () => [
    ...agentTools.filter((tool) => tool.type === "function" && PLAN_READONLY_TOOLS.has(tool.function.name)),
    ...interactiveTools.filter(
      (tool) =>
        tool.function.name === "ask_user"
        || tool.function.name === "read_design_guide"
        || (cloudState.enabled && tool.function.name === "read_cloud_guide"),
    ),
  ];
  let approveRestOfRun = false;

  /** Waits for the user to allow or deny tool calls. Polls the database so it works across server instances. */
  async function waitForApproval(items: ReturnType<typeof describeApproval>[]): Promise<AgentApprovalDecision[]> {
    return runPerformance.withStage("approval", async () => {
      const approval = await createAgentApproval(project.id, project.ownerId, items);
      await emit({ type: "approval_request", approval });
      await emit({ type: "status", label: items.length === 1 ? "Waiting for your approval" : `Waiting for your approval of ${items.length} actions` });
      const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const decisions = await getAgentApprovalDecisions(approval.id);
        if (decisions) {
          await emit({ type: "approval_resolved", id: approval.id, decisions });
          return decisions;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await expireAgentApproval(approval.id);
      const expired = items.map((item) => ({ callId: item.callId, decision: "deny" as const, note: "No answer in time. Stop and ask the user to continue when they're back." }));
      await emit({ type: "approval_resolved", id: approval.id, decisions: expired });
      return expired;
    });
  }

  /**
   * Verifies that if Drizzle schema tables exist in source code, they are pushed to live PostgreSQL.
   * Returns an error message if schema push failed and needs agent repair.
   */
  async function verifyCloudDatabaseMigrations(): Promise<string | null> {
    if (!cloudState.enabled || !decryptedSecrets.DATABASE_URL) return null;

    const schemaCandidates = ["src/lib/schema.ts", "lib/schema.ts", "src/db/schema.ts", "db/schema.ts"];
    let schemaSource: string | null = null;
    for (const candidate of schemaCandidates) {
      try {
        schemaSource = (await sandbox.fs.downloadFile(`${projectFsRoot}/${candidate}`)).toString("utf8");
        break;
      } catch {
        // Try next candidate
      }
    }
    if (!schemaSource) return null;

    const expectedTables = extractPgTableNamesFromSchemaSource(schemaSource);
    if (!expectedTables.length) return null;

    const liveTables = await inspectProjectTables(decryptedSecrets.DATABASE_URL).catch(() => []);
    const liveTableNames = new Set(liveTables.map((t) => t.name));
    const missingTables = expectedTables.filter((name) => !liveTableNames.has(name));
    if (missingTables.length === 0) return null;

    const configCheck = await sandbox.process.executeCommand(
      "test -f drizzle.config.ts -o -f drizzle.config.mjs -o -f drizzle.config.js",
      projectRoot,
      undefined,
      10,
    );
    if (configCheck.exitCode !== 0) {
      return `Your schema defines PostgreSQL tables (${missingTables.join(", ")}) that do not exist in the live Cloud Database yet, and \`drizzle.config.ts\` is missing. Create \`drizzle.config.ts\` (loading \`.env.local\`) and run \`npx drizzle-kit generate && npx drizzle-kit push --force\`.`;
    }

    await syncProjectEnv(project).catch(() => undefined);
    await emit({ type: "status", label: "Applying Cloud Database schema" });
    const pushCmd = "npx drizzle-kit push --force";
    const pushEntry = await terminal.start(pushCmd, "system");
    const pushRes = await sandbox.process.executeCommand(pushCmd, projectRoot, { CI: "1" }, 120);
    await terminal.end(pushEntry, { exitCode: pushRes.exitCode, output: pushRes.result, failed: pushRes.exitCode !== 0 });

    if (pushRes.exitCode !== 0) {
      return `\`npx drizzle-kit push --force\` failed while syncing tables (${missingTables.join(", ")}):\n${pushRes.result.slice(-3000)}\nFix the schema or \`drizzle.config.ts\` (ensure \`if (existsSync(".env.local")) process.loadEnvFile(".env.local");\` is present and \`schema.ts\` has no \`import "server-only"\`), or execute idempotent \`CREATE TABLE IF NOT EXISTS\` SQL via \`neon_database({ action: "run_sql" })\` and verify with \`neon_database({ action: "inspect_schema" })\`.`;
    }
    return null;
  }

  /**
   * Ensures a fresh dev server is running against the post-build `.next` & `.env.local`, then probes
   * `/` plus critical auth/app routes (`/api/auth/get-session`, `/sign-in`, `/sign-up` when present)
   * and checks dev-server logs so broken API/SSR routes self-heal inside the same single prompt.
   */
  async function verifyFullStackRuntime(): Promise<string | null> {
    if (changedPaths.size > 0 && !devServerFreshSinceLastBuild) {
      await runPerformance.withStage("preview", async () => {
        await emit({ type: "status", label: "Restarting preview server cleanly" });
        await restartDevelopmentPreview(sandbox, project, projectRoot).catch(() => undefined);
        runPerformance.recordPreviewRestart();
      });
      devServerFreshSinceLastBuild = true;
      previewReady = true;
    }

    return runPerformance.withStage("probe", async () => {
      const discoverCmd = [
        "routes='/'",
        "if [ -f src/app/api/auth/\\[...all\\]/route.ts ] || [ -f app/api/auth/\\[...all\\]/route.ts ]; then routes=\"$routes /api/auth/get-session\"; fi",
        "if [ -f src/app/sign-in/page.tsx ] || [ -f app/sign-in/page.tsx ] || [ -f 'src/app/(auth)/sign-in/page.tsx' ] || [ -f 'app/(auth)/sign-in/page.tsx' ]; then routes=\"$routes /sign-in\"; fi",
        "if [ -f src/app/sign-up/page.tsx ] || [ -f app/sign-up/page.tsx ] || [ -f 'src/app/(auth)/sign-up/page.tsx' ] || [ -f 'app/(auth)/sign-up/page.tsx' ]; then routes=\"$routes /sign-up\"; fi",
        "printf '%s' \"$routes\"",
      ].join("; ");

      const discovered = await sandbox.process
        .executeCommand(discoverCmd, projectRoot, undefined, 10)
        .catch(() => ({ exitCode: 0, result: "/" }));
      const probeRoutes = (discovered.result || "/")
        .trim()
        .split(/\s+/)
        .filter((r) => r.startsWith("/"));

      const failedRoutes: string[] = [];
      for (const route of probeRoutes) {
        const probeRes = await sandbox.process
          .executeCommand(
            `code=$(curl -sS -o /tmp/.cognix-probe-body -w '%{http_code}' --max-time 10 'http://127.0.0.1:3000${route}' || printf '000'); printf 'STATUS=%s\\n' "$code"; head -c 600 /tmp/.cognix-probe-body 2>/dev/null || true`,
            projectRoot,
            undefined,
            15,
          )
          .catch(() => ({ exitCode: 1, result: "STATUS=000\nProbe timed out" }));

        const statusMatch = probeRes.result.match(/^STATUS=(\d{3})/m);
        const status = Number(statusMatch?.[1] ?? "000");
        const bodySnippet = probeRes.result.replace(/^STATUS=\d{3}\r?\n?/, "").trim().slice(0, 400);
        if (status === 0 || status >= 500) {
          failedRoutes.push(
            `- \`GET ${route}\` returned HTTP ${status === 0 ? "000 (server unreachable / crashed)" : status}${bodySnippet ? `\n  Response: ${bodySnippet}` : ""}`,
          );
        }
      }

      const runtimeSnapshot = await readSandboxRuntimeLogs(project, { maxLines: 70 });
      const recentServerTail = runtimeSnapshot.serverLogs.split("\n").slice(-55).join("\n");
      const detectedRuntimeErrors = extractServerErrorsFromLog(recentServerTail);

      if (failedRoutes.length > 0 || detectedRuntimeErrors.length > 0) {
        const details: string[] = [];
        if (failedRoutes.length > 0) {
          details.push(`Failing live routes:\n${failedRoutes.join("\n")}`);
        }
        if (detectedRuntimeErrors.length > 0) {
          details.push(
            `Server runtime errors:\n${detectedRuntimeErrors
              .slice(-3)
              .map((err) => `- ${err.message}${err.stack ? `\n${err.stack.slice(0, 900)}` : ""}`)
              .join("\n\n")}`,
          );
        } else if (recentServerTail.trim()) {
          details.push(`Recent server output:\n\`\`\`\n${recentServerTail.slice(-1500)}\n\`\`\``);
        }

        return `The production build passed, and live smoke verification detected runtime issues:\n\n${details.join("\n\n")}\n\nDiagnose and fix the root cause (check database connection/schema, Better Auth adapter/secrets, or SSR code), run \`npm run build\`, restart/verify the dev server on \`0.0.0.0:3000\`, confirm with \`read_preview_console\`, and call \`get_preview_url\`.`;
      }

      return null;
    });
  }

  const loopGuard = createAgentLoopGuard();
  const unresolvedErrors: string[] = [];
  let turnsSinceLastCompaction = 0;
  let lastToolResultChars = 0;
  runPerformance.enterStage("agent");
  try {
  let completedNaturally = false;
  for (let turn = 0; turn < maxAgentTurns; turn += 1) {
    const estimatedChars = approximateMessageChars(messages);
    if (
      contextCompactionEnabled
      && shouldCompactContext({
        turn,
        turnsSinceLastCompaction,
        estimatedChars,
        lastToolResultChars,
      })
    ) {
      runPerformance.recordContextRefresh();
      messages[0] = { role: "system", content: computeSystemPromptContent() };
      const verifiedChecks: string[] = [];
      if (productionBuildPassed) verifiedChecks.push("Production build (`npm run build`) passed");
      if (previewReady) verifiedChecks.push("Live preview URL verified healthy on port 3000");
      if (runtimeVerifiedClean) verifiedChecks.push("Runtime route probes and server logs verified clean");
      messages = compactAgentMessages(
        messages,
        {
          originalPrompt: prompt,
          mode: runMode,
          changedFiles: [...changedPaths].slice(-80).map((filePath) => ({ path: filePath })),
          unresolvedErrors: unresolvedErrors.slice(-6),
          verifiedChecks,
        },
        4,
      );
      turnsSinceLastCompaction = 0;
      lastToolResultChars = 0;
      await emit({ type: "status", label: security ? "Compacting review context" : "Compacting build context" });
    } else if (!contextCompactionEnabled && shouldRefreshAgentContext(turn)) {
      runPerformance.recordContextRefresh();
      const changedFiles = [...changedPaths];
      messages[0] = { role: "system", content: computeSystemPromptContent() };
      messages = [
        messages[0],
        {
          role: "user",
          content: [
            security
              ? "Continue the current security task from the repository files already present in the sandbox."
              : "Continue the current build from the files already present in the sandbox.",
            `Original request: ${prompt}`,
            changedFiles.length
              ? `Files changed so far: ${changedFiles.slice(-80).join(", ")}`
              : "No file changes have been recorded yet.",
            security
              ? "Continue the security review from what you have already inspected without re-reading covered files. Complete any remaining review stages, skeptical verification, and coverage checks, then finish with the evidence-gated report."
              : "Re-inspect only the files needed for the remaining work. Do not recreate or overwrite working features unnecessarily.",
            ...(security ? [] : ["Finish the requested app, run its full production build and fix every build failure, then start or repair the server on 0.0.0.0:3000, inspect the preview and console, and call get_preview_url."]),
          ].join("\n\n"),
        },
      ];
      completionNudges = 0;
      turnsSinceLastCompaction = 0;
      await emit({ type: "status", label: security ? "Continuing with a focused review context" : "Continuing with a focused build context" });
    }
    turnsSinceLastCompaction += 1;

    if (boundedAgentEnabled && cloudState.enabled && inferredCloudCount === 0) {
      const fullstackBudget = resolveAdaptiveTurnBudget({
        mode: runMode,
        prompt,
        isNewProject: isNewProjectBuild,
        cloudFeaturesCount: 1,
        hasVisualSelections: input.visualSelections.length > 0,
        isErrorRepair: promptAlreadyContainsErrors,
      }).hardBudget;
      if (fullstackBudget > maxAgentTurns) {
        maxAgentTurns = fullstackBudget;
      }
    }

    if (
      boundedAgentEnabled
      && !security
      && !planMode
      && !productionBuildPassed
      && !wrapUpNudgeSent
      && maxAgentTurns >= 8
      && turn === maxAgentTurns - 4
    ) {
      wrapUpNudgeSent = true;
      messages.push({
        role: "user",
        content:
          "[Turn budget] You have 4 turns left in this pass. Finish any remaining files now, run one clean production build (`rm -rf .next && npm run build`), verify the live preview is healthy, and provide your concise completion summary.",
      });
    }

    const planTools = getPlanTools();
    const planToolNames = new Set(planTools.map((tool) => tool.function.name));
    const buildTools = [
      ...agentTools,
      ...interactiveTools,
      ...(cloudState.enabled ? cloudProviderTools : []),
      ...(repository ? [githubTool] : []),
    ];
    const createStream = (signal: AbortSignal) =>
      client.chat.completions.create(
        {
          model: process.env.OPENAI_MODEL!,
          messages,
          tools: security ? securityTools : planMode ? planTools : buildTools,
          tool_choice: "auto",
          stream: true,
          ...(streamUsageOptionsSupported ? { stream_options: { include_usage: true } } : {}),
          temperature: 0.2,
        },
        { signal },
      );

    const modelTurnStartedAt = Date.now();
    const modelMessageChars = approximateMessageChars(messages);
    const turnResult = await runPerformance.withStage("model", async () => {
      try {
        return await streamModelTurnWithRetry({
          createStream,
          onStatus: (label) => emit({ type: "status", label }),
          onAttempt: () => runPerformance.recordModelAttempt(),
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "";
        if (streamUsageOptionsSupported && /stream_options|include_usage|unknown field|extra_forbidden|unrecognized/i.test(errMsg)) {
          streamUsageOptionsSupported = false;
          return await streamModelTurnWithRetry({
            createStream,
            onStatus: (label) => emit({ type: "status", label }),
            onAttempt: () => runPerformance.recordModelAttempt(),
          });
        } else if (nativeFilePartsEnabled && turn === 0 && isNativeFileCompatibilityError(error)) {
          nativeFilePartsEnabled = false;
          messages[currentUserMessageIndex] = {
            role: "user",
            content: buildMultimodalUserContent(effectivePrompt, stagedAttachments, {
              includeNativeFiles: false,
              visualSelections: input.visualSelections,
            }),
          };
          await emit({ type: "status", label: "Opening attachments in compatibility mode" });
          return await streamModelTurnWithRetry({
            createStream,
            onStatus: (label) => emit({ type: "status", label }),
            onAttempt: () => runPerformance.recordModelAttempt(),
          });
        } else {
          throw error;
        }
      }
    });

    const { content, calls, usage } = turnResult;
    modelTurnsExecuted += 1;
    const toolArgChars = calls.reduce((acc, c) => acc + c.function.name.length + c.function.arguments.length, 0);
    const turnPromptTokens = usage?.promptTokens ?? estimateTokensFromChars(modelMessageChars);
    const turnCompletionTokens = usage?.completionTokens ?? estimateTokensFromChars(content.length + toolArgChars);
    totalPromptTokens += turnPromptTokens;
    totalCompletionTokens += turnCompletionTokens;
    runPerformance.recordModelTurn({
      durationMs: Date.now() - modelTurnStartedAt,
      messageChars: modelMessageChars,
      promptTokens: turnPromptTokens,
      cachedPromptTokens: usage?.cachedPromptTokens ?? 0,
      completionTokens: turnCompletionTokens,
      toolCalls: calls.length,
    });

    messages.push({
      role: "assistant",
      content: content || null,
      ...(calls.length
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: call.function,
            })),
          }
        : {}),
    });

    if (!calls.length) {
      if (!security && !planMode && turn < maxAgentTurns - 1) {
        if ((!previewReady || !productionBuildPassed) && completionNudges < 2) {
          completionNudges += 1;
          messages.push({
            role: "user",
            content:
              "The task is not complete yet. Continue using tools: verify the files are in the project root, install dependencies, ensure any database schema is pushed (`npx drizzle-kit push --force`), run the full production build (`npm run build`) and fix it until it exits successfully, then start the development server on 0.0.0.0:3000, confirm zero runtime errors with `read_preview_console`, and call `get_preview_url`.",
          });
          continue;
        }

        // Verify Drizzle schema migrations were pushed to PostgreSQL
        if (cloudState.enabled && completionNudges < 3) {
          const migrationError = await verifyCloudDatabaseMigrations();
          if (migrationError) {
            completionNudges += 1;
            previewReady = false;
            messages.push({
              role: "user",
              content: migrationError,
            });
            continue;
          }
        }

        // Self-heal live preview routes & runtime exceptions caught in dev server logs
        if (previewReady && !runtimeVerifiedClean && completionNudges < 3) {
          const runtimeIssue = await verifyFullStackRuntime();
          if (runtimeIssue) {
            completionNudges += 1;
            previewReady = false;
            productionBuildPassed = false;
            devServerFreshSinceLastBuild = false;
            messages.push({
              role: "user",
              content: runtimeIssue,
            });
            continue;
          }
          runtimeVerifiedClean = true;
        }

        if (
          frontendBlueprint?.depth === "deep"
          && (!designGuideRead || !frontendPreviewInspected)
          && !designVerificationNudgeSent
        ) {
          designVerificationNudgeSent = true;
          const missing = [
            ...(!designGuideRead ? ["read the most relevant internal design guide"] : []),
            ...(!frontendPreviewInspected ? ["inspect the rendered key routes with `inspect_preview`"] : []),
          ];
          messages.push({
            role: "user",
            content: `[Design completion gate] This substantive frontend task still needs rendered design verification. ${missing.join(" and ")}. Critique hierarchy, spacing, typography, responsive composition, real states, overflow, and generic AI patterns; fix the highest-impact issues before finishing. Do not redesign outside the user's request.`,
          });
          continue;
        }
      }
      finalContent = content.trim();
      completedNaturally = true;
      break;
    }

    // Request review: ask once for every file change or command in this turn, before running any of them.
    const decisions = new Map<string, AgentApprovalDecision>();
    if (security && approvalMode === "review" && !approveRestOfRun) {
      const pending = calls.filter((call) => !call.truncatedJson && APPROVAL_TOOLS.has(call.function.name));
      if (pending.length) {
        const answer = await waitForApproval(pending.map((call) => describeApproval(call.id, call.function.name, parseToolInput(call.function.arguments))));
        for (const item of answer) decisions.set(item.callId, item);
        if (decisions.get("*")?.decision === "allow") approveRestOfRun = true;
      }
    }

    // Only pause mutating tools when `ask_user` is called, or when `request_cognix_cloud` requires manual user consent.
    const turnPausesForUser = !security && calls.some(
      (call) =>
        !call.truncatedJson &&
        ((call.function.name === "request_cognix_cloud" && !cloudState.enabled && !canAutoEnableCloud) ||
          call.function.name === "ask_user"),
    );
    const mutatingTools = new Set([
      "write_file",
      "edit_file",
      "batch_edit_files",
      "move_file",
      "delete_file",
      "run_command",
      "neon_database",
      "resend_email",
      "cloud_storage",
      GITHUB_TOOL_NAME,
    ]);

    for (const call of calls) {
      const toolInput = parseToolInput(call.function.arguments);
      const activityStartedAt = Date.now();
      const activityId = `${call.id}#${++activitySequence}`;
      usedTools.push(call.function.name);
      await emit({ type: "tool_start", id: activityId, name: call.function.name, input: toolInput });

      if (call.truncatedJson) {
        const summary = "Split needed: output hit token limit mid-call";
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: summary,
          status: "error",
          durationMs: 0,
          target: activityTarget(call.function.name, toolInput),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error:
              "Your previous response reached the output token limit before finishing this tool call's JSON arguments. Re-issue this call now, and keep batches to at most 3–4 files per turn.",
          }),
        });
        continue;
      }

      if ((turnPausesForUser || pendingRequest !== null) && mutatingTools.has(call.function.name)) {
        const summary = "Paused: waiting for user consent first";
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: summary,
          status: "done",
          durationMs: 0,
          target: activityTarget(call.function.name, toolInput),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            skipped: true,
            reason: "Waiting for the user's answer/consent before modifying project files or running commands.",
          }),
        });
        continue;
      }

      if (security && !securityToolNames.has(call.function.name)) {
        const summary = `Needs attention: ${call.function.name} isn't available in Security mode`;
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({ id: activityId, name: call.function.name, label: summary, status: "error", durationMs: 0 });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "This tool isn't available in Security mode. There is no preview, and only the user commits and pushes to GitHub (propose_pull_request asks them)." }),
        });
        continue;
      }

      if (planMode && !planToolNames.has(call.function.name)) {
        const summary = `Skipped: ${call.function.name} is disabled in Plan mode`;
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({ id: activityId, name: call.function.name, label: summary, status: "error", durationMs: 0 });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "Plan mode is strictly read-only. Do not modify files or run commands; return your diagnosis or Markdown implementation plan instead." }),
        });
        continue;
      }

      const decision = decisions.get(call.id);
      if (security && approvalMode === "review" && APPROVAL_TOOLS.has(call.function.name) && decision && decision.decision !== "allow") {
        const summary = `Not allowed: ${describeApproval(call.id, call.function.name, toolInput).title}`;
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({ id: activityId, name: call.function.name, label: summary, status: "error", durationMs: 0, target: activityTarget(call.function.name, toolInput) });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: "The user denied this action. Don't retry it.",
            ...(decision.note ? { userNote: decision.note } : {}),
          }),
        });
        continue;
      }

      if (security && call.function.name === PULL_REQUEST_TOOL_NAME) {
        let output: string;
        let summary: string;
        try {
          const result = runPullRequestProposal(toolInput, pendingRequest !== null);
          output = result.output;
          summary = result.summary;
          if (result.request) pendingRequest = result.request;
        } catch (error) {
          output = JSON.stringify({ error: error instanceof Error ? error.message : "Invalid input" });
          summary = "Needs attention: invalid pull request";
        }
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({ id: activityId, name: call.function.name, label: summary, status: summary.startsWith("Needs attention") ? "error" : "done", durationMs: Date.now() - activityStartedAt });
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
        continue;
      }

      if (isInteractiveTool(call.function.name)) {
        // Seamless on-demand Cognix Cloud provisioning when the project has not explicitly disabled Cloud!
        if (call.function.name === "request_cognix_cloud" && !cloudState.enabled && canAutoEnableCloud) {
          let autoOutput: string;
          let autoSummary: string;
          try {
            const parsed = runInteractiveTool("request_cognix_cloud", toolInput, {
              cloudEnabled: false,
              alreadyAsked: false,
            });
            const requestedFeatures: CloudFeature[] =
              parsed.request?.kind === "enable_cloud" ? parsed.request.features : ["database"];
            const needsDb = requestedFeatures.includes("database") || requestedFeatures.includes("auth");
            const needsStorage = requestedFeatures.includes("storage");

            await emit({ type: "status", label: "Provisioning Cognix Cloud" });
            await updateProjectCloud(project.id, {
              status: "ready",
              storageEnabled: true,
              authEnabled: true,
              lastError: null,
            });

            if (!cloudState.secretNames.includes("BETTER_AUTH_SECRET")) {
              await upsertSecret(project.id, "BETTER_AUTH_SECRET", randomBytes(32).toString("base64url"), "cloud");
            }
            if (needsDb && isNeonApiConfigured()) {
              await emit({ type: "status", label: "Provisioning Cloud Database" });
              await ensureProjectNeonDatabase(project);
            }
            if (needsStorage && isBucketlineConfigured()) {
              await emit({ type: "status", label: "Provisioning Cloud Storage" });
              await ensureProjectStorageBucket(project);
            }

            const [freshSecrets, freshNames] = await Promise.all([
              getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
              listSecretNames(project.id).then((items) => items.map((item) => item.name)).catch(() => cloudState.secretNames),
            ]);
            decryptedSecrets = freshSecrets;
            terminal.addSecrets(Object.values(freshSecrets));
            cloudState.enabled = true;
            cloudState.secretNames = freshNames;
            await syncProjectEnv(project);

            const liveSummaries = await loadLiveCloudSummaries(project, decryptedSecrets);
            cloudState.liveDatabaseSummary = liveSummaries.liveDatabaseSummary;
            cloudState.liveStorageSummary = liveSummaries.liveStorageSummary;
            messages[0] = { role: "system", content: computeSystemPromptContent() };
            await emit({ type: "cloud_status", enabled: true });

            const guidesToInclude = new Set(requestedFeatures);
            if (guidesToInclude.has("auth")) guidesToInclude.add("database");
            const inlineGuides = [...guidesToInclude].map((feature) => CLOUD_GUIDES[feature]).join("\n\n---\n\n");

            autoSummary = "Provisioned Cognix Cloud";
            autoOutput = [
              `Cognix Cloud is now ON and provisioned automatically for this project.`,
              `Synced environment secrets in \`.env.local\`: ${freshNames.map((n) => `\`${n}\``).join(", ")}.`,
              `Continue building the full application right now (do NOT pause or wait for user confirmation). Follow these Cognix Cloud implementation guides:`,
              "",
              inlineGuides,
            ].join("\n");
          } catch (error) {
            autoOutput = JSON.stringify({
              error: error instanceof Error ? error.message : "Could not auto-provision Cognix Cloud.",
            });
            autoSummary = "Needs attention: Cloud provisioning failed";
          }

          await emit({ type: "tool_result", id: activityId, name: call.function.name, summary: autoSummary });
          runActivity.push({
            id: activityId,
            name: call.function.name,
            label: autoSummary,
            status: autoSummary.startsWith("Needs attention") ? "error" : "done",
            durationMs: Date.now() - activityStartedAt,
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: autoOutput });
          continue;
        }

        let interactiveOutput: string;
        let interactiveSummary: string;
        try {
          const result = runInteractiveTool(call.function.name, toolInput, {
            cloudEnabled: cloudState.enabled,
            alreadyAsked: pendingRequest !== null,
          });
          interactiveOutput = result.output;
          interactiveSummary = result.summary;
          if (result.request) pendingRequest = result.request;
        } catch (error) {
          interactiveOutput = JSON.stringify({ error: error instanceof Error ? error.message : "Invalid input" });
          interactiveSummary = "Needs attention: invalid question";
        }
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary: interactiveSummary });
        if (call.function.name === "read_design_guide" && !interactiveSummary.startsWith("Needs attention")) {
          designGuideRead = true;
        }
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: interactiveSummary,
          status: interactiveSummary.startsWith("Needs attention") ? "error" : "done",
          durationMs: Date.now() - activityStartedAt,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: interactiveOutput });
        continue;
      }

      if (isCloudProviderTool(call.function.name)) {
        let cloudOutput: string;
        let cloudSummary: string;
        try {
          const result = await executeCloudProviderTool(project, call.function.name, toolInput, cloudState.enabled);
          cloudOutput = result.output;
          cloudSummary = result.summary;
          if (result.secretsUpdated) {
            const [freshSecrets, freshNames] = await Promise.all([
              getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
              listSecretNames(project.id).then((items) => items.map((item) => item.name)).catch(() => cloudState.secretNames),
            ]);
            decryptedSecrets = freshSecrets;
            terminal.addSecrets(Object.values(freshSecrets));
            cloudState.secretNames = freshNames;
            await syncProjectEnv(project).catch(() => undefined);
          }
        } catch (error) {
          cloudOutput = JSON.stringify({ error: error instanceof Error ? error.message : "Cloud tool failed" });
          cloudSummary = `Needs attention: ${error instanceof Error ? error.message : "Cloud tool failed"}`.slice(0, 300);
        }
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary: cloudSummary });
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: cloudSummary,
          status: cloudSummary.startsWith("Needs attention") ? "error" : "done",
          durationMs: Date.now() - activityStartedAt,
          target: activityTarget(call.function.name, toolInput),
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: cloudOutput });
        continue;
      }

      if (call.function.name === GITHUB_TOOL_NAME && repository) {
        let output: string;
        let summary: string;
        try {
          const result = await runGitHubCommit(project, toolInput);
          output = result.output;
          summary = result.summary;
          githubInfo = result.info;
        } catch (error) {
          output = JSON.stringify({ error: error instanceof Error ? error.message : "Invalid input" });
          summary = "Needs attention: invalid commit request";
        }
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary });
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: summary,
          status: githubInfo?.status === "error" || summary.startsWith("Needs attention") ? "error" : "done",
          durationMs: Date.now() - activityStartedAt,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
        continue;
      }

      const commandInput = call.function.name === "run_command" && typeof toolInput === "object" && toolInput !== null
        ? (toolInput as { command?: unknown; background?: unknown })
        : null;
      const commandText = commandInput ? String(commandInput.command ?? "") : "";
      const toolStage =
        call.function.name === "run_command"
          ? isProductionBuildCommand(commandText)
            ? "build"
            : isDependencyInstallCommand(commandText)
              ? "install"
              : isPreviewStartCommand(commandText, commandInput?.background === true)
                ? "preview"
                : "tool"
          : call.function.name === "inspect_preview" || call.function.name === "read_preview_console"
            ? "probe"
            : call.function.name === "get_preview_url"
              ? "preview"
              : "tool";
      const terminalEntry = commandInput
        ? await terminal.start(commandText, "agent", commandInput.background === true)
        : null;

      let toolOutput: string;
      try {
        const result = await runPerformance.withStage(toolStage, () =>
          executeAgentTool(project, sandbox, call.function.name, toolInput, {
            cloudEnabled: cloudState.enabled,
          }),
        );
        if (terminalEntry) await terminal.end(terminalEntry, parseRunCommandOutput(result.output));
        if (call.function.name === "read_file" && typeof toolInput === "object" && toolInput !== null && "path" in toolInput) {
          const readPath = String((toolInput as { path?: unknown }).path ?? "");
          const startLine = "startLine" in toolInput ? String((toolInput as { startLine?: unknown }).startLine ?? "") : "";
          const endLine = "endLine" in toolInput ? String((toolInput as { endLine?: unknown }).endLine ?? "") : "";
          const readCheck = loopGuard.recordFileRead(readPath, result.output, `${startLine}:${endLine}`);
          if (readCheck.isUnchangedReread) {
            runPerformance.recordUnchangedFileReread();
            if (boundedAgentEnabled && readCheck.warning) {
              result.output = `${result.output}\n\n[Loop guard] ${readCheck.warning}`;
            }
          }
        }
        if (call.function.name === "inspect_preview" && typeof toolInput === "object" && toolInput !== null && "routes" in toolInput) {
          const routes = Array.isArray((toolInput as { routes?: unknown }).routes)
            ? ((toolInput as { routes: unknown[] }).routes.map((route) => String(route)))
            : [];
          const previewCheck = loopGuard.recordPreviewCheck(routes);
          if (boundedAgentEnabled && previewCheck.warning) {
            result.output = `${result.output}\n\n[Loop guard] ${previewCheck.warning}`;
          }
          frontendPreviewInspected = true;
        }
        if (["write_file", "edit_file", "batch_edit_files", "move_file", "delete_file"].includes(call.function.name)) {
          for (const touched of result.changedPaths ?? []) {
            loopGuard.invalidateFile(touched);
          }
          frontendPreviewInspected = false;
        } else if (call.function.name === "run_command") {
          loopGuard.invalidateAllFiles();
        }
        if (["write_file", "edit_file", "batch_edit_files", "move_file", "delete_file", "run_command"].includes(call.function.name)) {
          previewReady = false;
          runtimeVerifiedClean = false;
        }
        if (["write_file", "edit_file", "batch_edit_files", "move_file", "delete_file"].includes(call.function.name)) {
          productionBuildPassed = false;
          devServerFreshSinceLastBuild = false;
        }
        if (call.function.name === "run_command") {
          const command = typeof toolInput === "object" && toolInput && "command" in toolInput
            ? String(toolInput.command)
            : "";
          const parsedCmd = parseRunCommandOutput(result.output);
          const cmdDiagnostics = parsedCmd.exitCode && parsedCmd.exitCode !== 0 ? parseBuildDiagnostics(parsedCmd.output, 6) : [];
          const errorSig = cmdDiagnostics[0] ? `${cmdDiagnostics[0].category}:${cmdDiagnostics[0].code}:${cmdDiagnostics[0].filePath ?? ""}` : undefined;
          const cmdCheck = loopGuard.recordCommand(command, parsedCmd.exitCode, errorSig);
          if (parsedCmd.exitCode && parsedCmd.exitCode !== 0) {
            if (cmdDiagnostics.length > 0) {
              for (const diag of cmdDiagnostics.slice(0, 3)) {
                unresolvedErrors.push(`${diag.code}${diag.filePath ? ` (${diag.filePath}${diag.line ? `:${diag.line}` : ""})` : ""}: ${diag.message}`);
              }
            } else {
              unresolvedErrors.push(`Command exited ${parsedCmd.exitCode}: ${command.slice(0, 120)}`);
            }
          } else if (parsedCmd.exitCode === 0 && isProductionBuildCommand(command)) {
            unresolvedErrors.length = 0;
          }

          if (isProductionBuildCommand(command)) {
            const wasAlreadyPassing = productionBuildPassed;
            devServerFreshSinceLastBuild = false;
            try {
              const commandResult = JSON.parse(result.output) as { exitCode?: number };
              productionBuildPassed = commandResult.exitCode === 0;
            } catch {
              productionBuildPassed = false;
            }
            if (oneBuildPolicyEnabled && wasAlreadyPassing && productionBuildPassed) {
              result.output = `${result.output}\n\n[One-build policy] Build already passed with no file changes since the last build. Proceed directly to preview verification and completion.`;
            }
          } else if (
            commandInput?.background === true &&
            productionBuildPassed &&
            /\b(?:next\s+(?:dev|start)|npm\s+run\s+(?:dev|start)|pnpm\s+(?:run\s+)?(?:dev|start)|yarn\s+(?:dev|start)|bun\s+(?:run\s+)?(?:dev|start))\b/i.test(command)
          ) {
            devServerFreshSinceLastBuild = true;
          }

          if (contextCompactionEnabled && parsedCmd.output.length > 6_000) {
            const compactOutput = truncateCommandOutputDeterministically(parsedCmd.output, 6_000);
            result.output = JSON.stringify({
              exitCode: parsedCmd.exitCode,
              output: compactOutput,
              ...(cmdDiagnostics.length ? { diagnostics: cmdDiagnostics } : {}),
              ...(boundedAgentEnabled && cmdCheck.warning ? { loopWarning: cmdCheck.warning } : {}),
            });
          } else if (boundedAgentEnabled && (cmdCheck.warning || cmdDiagnostics.length > 0)) {
            const extraNotes = [
              ...(cmdDiagnostics.length
                ? [`Parsed diagnostics:\n${cmdDiagnostics.map((d) => `- [${d.code}] ${d.suggestedFix}`).join("\n")}`]
                : []),
              ...(cmdCheck.warning ? [`[Loop guard] ${cmdCheck.warning}`] : []),
            ].join("\n");
            result.output = `${result.output}\n\n${extraNotes}`;
          }
        }
        toolOutput = result.output;
        lastToolResultChars = Math.max(lastToolResultChars, toolOutput.length);
        result.changedPaths?.forEach((filePath) => changedPaths.add(filePath));
        result.fileChanges?.forEach((change) => {
          const existing = fileChanges.get(change.path);
          fileChanges.set(change.path, existing
            ? {
                path: change.path,
                before: existing.before,
                after: change.after,
                ...(existing.truncated || change.truncated ? { truncated: true } : {}),
              }
            : change);
        });
        await emit({ type: "tool_result", id: activityId, name: call.function.name, summary: result.summary });
        if (result.changedPaths?.length) await emit({ type: "files_changed", paths: result.changedPaths });
        if (result.previewUrl) {
          runPerformance.markFirstPreview();
          await emit({ type: "preview", url: result.previewUrl, sandboxId: sandbox.id });
          previewReady = true;
        }
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: result.summary,
          status: "done",
          durationMs: Date.now() - activityStartedAt,
          target: activityTarget(call.function.name, toolInput),
        });
      } catch (error) {
        const failure = error instanceof Error ? error.message : "Tool failed";
        if (terminalEntry) await terminal.end(terminalEntry, { exitCode: null, output: failure, failed: true });
        toolOutput = JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" });
        await emit({
          type: "tool_result",
          id: activityId,
          name: call.function.name,
          summary: `Needs attention: ${failure}`,
        });
        runActivity.push({
          id: activityId,
          name: call.function.name,
          label: `Needs attention: ${failure}`.slice(0, 500),
          status: "error",
          durationMs: Date.now() - activityStartedAt,
          target: activityTarget(call.function.name, toolInput),
        });
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: redactConsoleSecrets(toolOutput, Object.values(decryptedSecrets)),
      });
    }

    if (pendingRequest) {
      finalContent = content.trim();
      break;
    }
  }

  if (pendingRequest) {
    return finishWithQuestions(pendingRequest);
  }

  if (planMode) {
    runPerformance.enterStage("persistence");
    if (!finalContent.trim()) {
      finalContent = completedNaturally
        ? "## Plan\n\nI inspected the project, but no written plan was produced. Ask a follow-up question to refine the plan."
        : "## Plan checkpoint\n\nCognix reached the inspection turn limit. Send \"Continue\" to finish the plan.";
    }
    await emit({ type: "token", value: finalContent });
    const completedAt = new Date();
    const runDurationMs = completedAt.getTime() - runStartedAt;
    const restoredStatus = project.publishedAt ? "published" : project.previewUrl ? "ready" : "draft";
    const message = await createMessage(project.id, "assistant", finalContent, {
      tools: usedTools,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      chatMode: "plan",
      runStartedAt: new Date(runStartedAt).toISOString(),
      runCompletedAt: completedAt.toISOString(),
      runDurationMs,
    });
    const usageMeta = await chargeRunCredits(message.id, runDurationMs);
    await updateProject(project.id, project.ownerId, { status: restoredStatus });
    await emit({
      type: "done",
      messageId: message.id,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      chatMode: "plan",
      runDurationMs,
      ...usageMeta,
    });
    await persistRunMetric(completedNaturally ? "completed" : "checkpoint", message.id);
    return message;
  }

  if (security) {
    runPerformance.enterStage("persistence");
    if (!finalContent.trim()) {
      finalContent = completedNaturally
        ? "## Done\n\nThe run finished without a written summary. Ask a follow-up question, such as \"Summarize the findings\", to get one."
        : "## Checkpoint\n\nCognix used this run's execution budget before finishing. Send \"Continue\" to pick up where it stopped.";
    }
    await emit({ type: "token", value: finalContent });
    const completedAt = new Date();
    const runDurationMs = completedAt.getTime() - runStartedAt;
    const source = project.securitySource;
    const changedPathList = [...changedPaths];
    const fileChangeList = [...fileChanges.values()];
    const message = await createMessage(project.id, "assistant", finalContent, {
      tools: usedTools,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      runStartedAt: new Date(runStartedAt).toISOString(),
      runCompletedAt: completedAt.toISOString(),
      runDurationMs,
      changedPaths: changedPathList,
      fileChanges: fileChangeList,
      ...(changedPathList.length ? { summary: `Updated ${changedPathList.length} ${changedPathList.length === 1 ? "file" : "files"}` } : {}),
      ...(source ? { security: { repository: source.fullName, branch: source.branch, commit: source.importedSha } } : {}),
    });
    const usageMeta = await chargeRunCredits(message.id, runDurationMs);
    await updateProject(project.id, project.ownerId, { status: "ready" });
    await emit({
      type: "done",
      messageId: message.id,
      changedPaths: changedPathList,
      fileChanges: fileChangeList,
      activity: runActivity.slice(-100),
      commands: terminal.commands,
      runDurationMs,
      ...usageMeta,
    });
    await persistRunMetric(completedNaturally ? "completed" : "checkpoint", message.id);
    return message;
  }

  if (!completedNaturally) {
    await emit({ type: "status", label: "Saving the build and verifying the preview" });
    finalContent = [
      "## Build checkpoint",
      "",
      "Cognix used the available execution budget and saved every completed file change.",
      "",
      "The live app has been verified below. You can continue refining it with another instruction without starting over.",
    ].join("\n");
  }

  runPerformance.enterStage("verification");
  await emit({ type: "status", label: "Finishing the live preview" });
  const packageCheck = await sandbox.process.executeCommand("test -f package.json", projectRoot, undefined, 10);
  if (packageCheck.exitCode !== 0) throw new Error("The generated app is missing package.json. Ask Cognix to repair the project and try again.");
  await ensureVisualEditBridge(sandbox, projectRoot, projectFsRoot).catch(() => null);
  if (cloudState.secretNames.length > 0) {
    await syncProjectEnv(project).catch(() => undefined);
    devServerFreshSinceLastBuild = true;
  }
  if (cloudState.enabled) {
    await verifyCloudDatabaseMigrations().catch(() => null);
  }
  if (changedPaths.size > 0 && !devServerFreshSinceLastBuild) {
    await runPerformance.withStage("preview", async () => {
      await restartDevelopmentPreview(sandbox, project, projectRoot).catch(() => undefined);
      runPerformance.recordPreviewRestart();
    });
    devServerFreshSinceLastBuild = true;
  }

  let health = await runPerformance.withStage("probe", () => getPreviewHealth(sandbox, 3000));
  if (!health.healthy) {
    const manifestChanged = changedPaths.has("package.json") || changedPaths.has("package-lock.json");
    const nodeModulesReady = oneBuildPolicyEnabled && !manifestChanged
      ? (await sandbox.process.executeCommand("test -d node_modules", projectRoot, undefined, 10)).exitCode === 0
      : false;
    if (!nodeModulesReady) {
      await runPerformance.withStage("install", async () => {
        await emit({ type: "status", label: "Installing app dependencies" });
        const installCommand = "npm install --include=dev --no-audit --no-fund";
        const installEntry = await terminal.start(installCommand, "system");
        const install = await sandbox.process.executeCommand(installCommand, projectRoot, { CI: "1" }, 360);
        await terminal.end(installEntry, { exitCode: install.exitCode, output: install.result });
        if (install.exitCode !== 0) throw new Error(`Dependency installation failed:\n${install.result.slice(-4000)}`);
      });
    }
    health = await runPerformance.withStage("probe", () => getPreviewHealth(sandbox, 3000));

    if (health.reachable && !health.healthy) {
      await runPerformance.withStage("probe", async () => {
        await sandbox.process.executeCommand(
          "for i in $(seq 1 15); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ || true); case \"$status\" in 2*|3*) exit 0 ;; 000) exit 1 ;; esac; sleep 2; done; exit 1",
          projectRoot,
          undefined,
          40,
        );
        health = await getPreviewHealth(sandbox, 3000);
      });
      if (health.reachable && !health.healthy) {
        throw new Error(`The development server is running but its home page returns HTTP ${health.status}. Fix the runtime error before publishing a preview.`);
      }
    }

    if (!health.healthy) {
      await runPerformance.withStage("preview", async () => {
        const sessionId = `cognix-preview-${project.id.slice(0, 12)}`;
        try {
          await sandbox.process.getSession(sessionId);
        } catch {
          await sandbox.process.createSession(sessionId);
        }
        await emit({ type: "status", label: "Starting the development server" });
        const devEntry = await terminal.start("npm run dev -- --hostname 0.0.0.0 --port 3000", "system", true);
        const command = await sandbox.process.executeSessionCommand(
          sessionId,
          {
            command: buildDevServerCommand(projectRoot, 3000),
            runAsync: true,
            suppressInputEcho: true,
          },
          30,
        );
        const healthWait = await sandbox.process.executeCommand(
          "for i in $(seq 1 50); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ || true); case \"$status\" in 2*|3*) exit 0 ;; esac; sleep 2; done; exit 1",
          projectRoot,
          undefined,
          110,
        );
        if (healthWait.exitCode !== 0) {
          const logs = await sandbox.process.getSessionCommandLogs(sessionId, command.cmdId);
          const output = [logs.stdout, logs.stderr, logs.output].filter(Boolean).join("\n").slice(-5000);
          await terminal.end(devEntry, { exitCode: null, output: output || "No server output was captured.", failed: true });
          throw new Error(`The development server did not start:\n${output || "No server output was captured."}`);
        }
        await terminal.end(devEntry, { exitCode: null, output: "Development server is running on port 3000." });
        health = await getPreviewHealth(sandbox, 3000);
        if (!health.healthy) {
          throw new Error(`The development server started but its home page returns HTTP ${health.status}.`);
        }
      });
    }
  }

  const previewUrl = await getPreviewUrl({ ...project, sandboxId: sandbox.id }, 3000);
  if (!previewUrl) throw new Error("Could not create a live preview URL for port 3000.");
  await updateProject(project.id, project.ownerId, {
    previewUrl,
    status: project.publishedAt ? "published" : "ready",
  });
  runPerformance.markFirstPreview();
  await emit({ type: "preview", url: previewUrl, sandboxId: sandbox.id });
  previewReady = true;

  // Clear stale pre-build console errors when files were updated so resolved errors don't linger
  if (changedPaths.size > 0) {
    await clearProjectConsoleLogs(project.id).catch(() => undefined);
    // Persist any fresh server-side warnings/errors if present right now
    const freshRuntime = await readSandboxRuntimeLogs(project, { maxLines: 50 }).catch(() => null);
    if (freshRuntime?.serverLogs) {
      const freshServerErrors = extractServerErrorsFromLog(freshRuntime.serverLogs);
      if (freshServerErrors.length > 0) {
        await appendProjectConsoleLogs(project.id, freshServerErrors).catch(() => undefined);
      }
    }
  }

  // The task is finished and verified: save it to GitHub. No confirmation needed; a failed push never fails the build.
  runPerformance.enterStage("github");
  if (repository && changedPaths.size > 0) {
    await emit({ type: "status", label: `Committing to ${repository.fullName}` });
    const commitStartedAt = Date.now();
    const message = boundedAgentEnabled
      ? buildDeterministicCommitMessage({ request: prompt, changedPaths: [...changedPaths] })
      : await (async () => {
          await emit({ type: "status", label: "Writing the commit message" });
          return writeCommitMessage({
            request: prompt,
            summary: finalContent,
            changes: changesFromSnapshots([...changedPaths], [...fileChanges.values()]),
          });
        })();
    await emit({ type: "status", label: `Committing to ${repository.fullName}` });
    const result = await runGitHubCommit(project, { message });
    if (!(result.info.status === "unchanged" && githubInfo?.status === "committed")) githubInfo = result.info;
    runActivity.push({
      id: `github-${commitStartedAt}`,
      name: GITHUB_TOOL_NAME,
      label: result.summary,
      status: result.info.status === "error" ? "error" : "done",
      durationMs: Date.now() - commitStartedAt,
    });
  }

  runPerformance.enterStage("persistence");

  if (!finalContent.trim()) {
    finalContent = "## What changed\n\nThe requested update is implemented in the existing app.\n\n## Checks\n\n- The development server is healthy.\n- The live preview is ready.";
  }
  await emit({ type: "token", value: finalContent });

  const changedPathList = [...changedPaths];
  const fileChangeList = [...fileChanges.values()];
  const completedAt = new Date();
  const runDurationMs = completedAt.getTime() - runStartedAt;
  const message = await createMessage(project.id, "assistant", finalContent, {
    tools: usedTools,
    activity: runActivity.slice(-100),
    commands: terminal.commands,
    ...(githubInfo ? { github: githubInfo } : {}),
    runStartedAt: new Date(runStartedAt).toISOString(),
    runCompletedAt: completedAt.toISOString(),
    runDurationMs,
    changedPaths: changedPathList,
    fileChanges: fileChangeList,
    summary: changedPathList.length
      ? `Updated ${changedPathList.length} ${changedPathList.length === 1 ? "file" : "files"}`
      : "Verified the existing app",
  });
  const usageMeta = await chargeRunCredits(message.id, runDurationMs);
  await updateProject(project.id, project.ownerId, {
    status: previewReady ? (project.publishedAt ? "published" : "ready") : "error",
  });
  await emit({
    type: "done",
    messageId: message.id,
    changedPaths: changedPathList,
    fileChanges: fileChangeList,
    activity: runActivity.slice(-100),
    commands: terminal.commands,
    ...(githubInfo ? { github: githubInfo } : {}),
    runDurationMs,
    ...usageMeta,
  });
  await persistRunMetric(completedNaturally ? "completed" : "checkpoint", message.id);
  return message;
  } catch (runError) {
    runPerformance.enterStage("persistence");
    if (!creditsSettled) {
      if (modelTurnsExecuted > 0) {
        await chargeRunCredits(null, Date.now() - runStartedAt).catch(() => undefined);
      } else if (reservedHold > 0) {
        creditsSettled = true;
        await refundReservedCredits(project.ownerId, reservedHold).catch(() => undefined);
      }
    }
    await persistRunMetric("error", null, runErrorCategory(runError));
    throw runError;
  }
}
