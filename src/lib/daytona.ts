import path from "node:path";
import { CodeLanguage, Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk";
import { appsDomain, directPreviewUrl, type DomainEnv } from "./domains";
import type { Project } from "./types";
import { updateProject } from "./store";

export const isDaytonaConfigured = Boolean(process.env.DAYTONA_API_KEY);

/** True when Cognix serves previews and published apps through its own custom preview proxy. */
export function isDirectPreviewProxyConfigured(env: DomainEnv = process.env) {
  return Boolean(appsDomain(env) && env.COGNIX_EDGE_SECRET?.trim());
}

/** Idle minutes before Daytona stops a published sandbox (0 keeps it running continuously). */
export function publishedAutoStopMinutes(env: DomainEnv = process.env) {
  const raw = env.COGNIX_PUBLISHED_AUTOSTOP_MINUTES?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) return 0;
  return parsed;
}

let client: Daytona | null = null;
const PUBLISHED_PORT = 3001;
const PREVIEW_URL_TTL_SECONDS = 60 * 60;
const PREVIEW_PROXY_VERIFY_ATTEMPTS = 5;
// Reuse a published runtime URL well inside its signed lifetime so visitors always get a fresh-enough link.
const PUBLISHED_URL_REUSE_MS = 45 * 60 * 1000;
// Within this window a cached URL is served without any network check.
const PUBLISHED_URL_RECHECK_MS = 30 * 1000;

type PublishedRuntime = { url: string; issuedAt: number; checkedAt: number };

declare global {
  var __cognixPublishedRuntimes: Map<string, PublishedRuntime> | undefined;
  var __cognixPublishedRuntimeLookups: Map<string, Promise<string | null>> | undefined;
}

const publishedRuntimes = globalThis.__cognixPublishedRuntimes ?? (globalThis.__cognixPublishedRuntimes = new Map());
const publishedRuntimeLookups =
  globalThis.__cognixPublishedRuntimeLookups ?? (globalThis.__cognixPublishedRuntimeLookups = new Map());

function rememberPublishedRuntime(projectId: string, url: string) {
  const now = Date.now();
  publishedRuntimes.set(projectId, { url, issuedAt: now, checkedAt: now });
}

function getClient() {
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error("Add DAYTONA_API_KEY to start a secure build sandbox.");
  }
  if (!client) {
    client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL,
      target: process.env.DAYTONA_TARGET,
    });
  }
  return client;
}

export async function getSandbox(project: Project): Promise<Sandbox | null> {
  if (!project.sandboxId) return null;
  const sandbox = await getClient().get(project.sandboxId);
  if (String(sandbox.state) !== "started") await sandbox.start(90);
  return sandbox;
}

export async function ensureSandbox(project: Project): Promise<{ sandbox: Sandbox; project: Project }> {
  const existing = await getSandbox(project);
  if (existing) {
    const updated = await updateProject(project.id, project.ownerId, { status: "building" });
    return { sandbox: existing, project: updated ?? { ...project, status: "building" } };
  }

  const sandbox = await getClient().create(
    {
      name: `cognix-${project.id.slice(0, 8)}`,
      image: "node:22-bookworm",
      language: CodeLanguage.TYPESCRIPT,
      public: !isDirectPreviewProxyConfigured(),
      autoStopInterval: 30,
      autoArchiveInterval: 1440,
      labels: { app: "cognix", projectId: project.id },
      envVars: { CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
    },
    { timeout: 180 },
  );

  const updated = await updateProject(project.id, project.ownerId, {
    sandboxId: sandbox.id,
    status: "building",
  });
  return { sandbox, project: updated ?? { ...project, sandboxId: sandbox.id, status: "building" } };
}

export async function getProjectRoot(sandbox: Sandbox) {
  const workDir = (await sandbox.getWorkDir()) ?? (await sandbox.getUserHomeDir()) ?? "/home/daytona";
  return `${workDir.replace(/\/$/, "")}/app`;
}

// Daytona's filesystem API resolves relative paths from the sandbox WORKDIR,
// while process commands use normal absolute paths inside the sandbox.
export function getProjectFsRoot() {
  return "app";
}

export async function getPreviewHealth(sandbox: Sandbox, port = 3000) {
  const root = await getProjectRoot(sandbox);
  const response = await sandbox.process.executeCommand(
    `status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:${port}/ || true); printf 'COGNIX_HTTP_%s' "$status"`,
    root,
    undefined,
    12,
  );
  const status = response.result.match(/COGNIX_HTTP_(\d{3})/)?.[1] ?? "000";
  return {
    healthy: isHealthyPreviewStatus(Number(status)),
    reachable: status !== "000",
    status,
  };
}

export function isHealthyPreviewStatus(status: number) {
  return status >= 200 && status < 400;
}

async function getVerifiedSignedPreviewUrl(sandbox: Sandbox, port: number) {
  for (let attempt = 0; attempt < PREVIEW_PROXY_VERIFY_ATTEMPTS; attempt += 1) {
    const preview = await sandbox.getSignedPreviewUrl(port, PREVIEW_URL_TTL_SECONDS);
    if (await isPreviewUrlHealthy(preview.url)) return preview.url;
    if (attempt < PREVIEW_PROXY_VERIFY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return null;
}

async function isPreviewUrlHealthy(url: string, timeoutMs = 8_000) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "X-Daytona-Skip-Preview-Warning": "true",
        "X-Daytona-Skip-Last-Activity-Update": "true",
      },
    });
    await response.body?.cancel();
    return isHealthyPreviewStatus(response.status);
  } catch {
    // Daytona's external preview proxy can trail the local port by a few seconds.
    return false;
  }
}

async function ensureDevServerHealthy(sandbox: Sandbox, project: Project, port = 3000) {
  let health = await getPreviewHealth(sandbox, port);
  if (!health.healthy && !health.reachable) {
    const root = await getProjectRoot(sandbox);
    const packageCheck = await sandbox.process.executeCommand("test -f package.json", root, undefined, 10);
    if (packageCheck.exitCode !== 0) return false;

    const dependencyCheck = await sandbox.process.executeCommand(
      "test -d node_modules && if [ -f tsconfig.json ]; then node -e \"require.resolve('typescript/package.json'); require.resolve('@types/node/package.json'); require.resolve('@types/react/package.json'); require.resolve('@types/react-dom/package.json')\"; else true; fi",
      root,
      undefined,
      20,
    );
    if (dependencyCheck.exitCode !== 0) {
      const install = await sandbox.process.executeCommand(
        "npm install --include=dev --no-audit --no-fund",
        root,
        { CI: "1" },
        360,
      );
      if (install.exitCode !== 0) return false;
    }

    const sessionId = `cognix-preview-${project.id.slice(0, 12)}`;
    let hasActiveCommand = false;
    try {
      const session = await sandbox.process.getSession(sessionId);
      hasActiveCommand = session.commands?.some((command) => command.exitCode == null) ?? false;
    } catch {
      await sandbox.process.createSession(sessionId);
    }
    if (!hasActiveCommand) {
      await sandbox.process.executeSessionCommand(
        sessionId,
        {
          command: `cd ${JSON.stringify(root)} && npm run dev -- --hostname 0.0.0.0 --port ${port}`,
          runAsync: true,
          suppressInputEcho: true,
        },
        30,
      );
    }

    await sandbox.process.executeCommand(
      `for i in $(seq 1 60); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${port}/ || true); case "$status" in 2*|3*) exit 0 ;; esac; sleep 2; done; exit 1`,
      root,
      undefined,
      130,
    );
    health = await getPreviewHealth(sandbox, port);
  }
  return health.healthy;
}

export async function getPreviewUrl(project: Project, port = 3000) {
  const sandbox = await getSandbox(project);
  if (!sandbox) return null;
  const health = await getPreviewHealth(sandbox, port);
  if (!health.healthy) return null;
  if (port === 3000 && isDirectPreviewProxyConfigured()) {
    const directUrl = directPreviewUrl(project.id);
    if (directUrl) {
      const target = await verifyPortProxyTarget(sandbox, port);
      if (!target) return null;
      rememberPreviewProxyTarget(project.id, target);
      return directUrl;
    }
  }
  return getVerifiedSignedPreviewUrl(sandbox, port);
}

export async function ensurePreviewUrl(project: Project, port = 3000) {
  const sandbox = await getSandbox(project);
  if (!sandbox) return null;

  const healthy = await ensureDevServerHealthy(sandbox, project, port);
  if (!healthy) return null;

  let url: string | null = null;
  if (port === 3000 && isDirectPreviewProxyConfigured()) {
    const directUrl = directPreviewUrl(project.id);
    if (directUrl) {
      const target = await verifyPortProxyTarget(sandbox, port);
      if (target) {
        rememberPreviewProxyTarget(project.id, target);
        url = directUrl;
      }
    }
  }
  if (!url) {
    url = await getVerifiedSignedPreviewUrl(sandbox, port);
  }
  if (url) {
    await updateProject(project.id, project.ownerId, {
      previewUrl: url,
      status: project.status === "published" || project.status === "publishing" ? project.status : "ready",
    }).catch(() => null);
  }
  return url;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function clonePublishedDependenciesCommand(sourceNodeModules: string, targetNodeModules: string) {
  const source = shellQuote(sourceNodeModules);
  const target = shellQuote(targetNodeModules);
  return [
    `test -d ${source}`,
    `if ! cp -al ${source} ${target}; then rm -rf ${target} && ln -s ${source} ${target}; fi`,
  ].join(" && ");
}

export const publishedBuildLimitsSource = [
  `const os = require("node:os");`,
  `const detectedCpus = os.cpus.bind(os);`,
  `os.cpus = () => detectedCpus().slice(0, 1);`,
  `if (typeof os.availableParallelism === "function") os.availableParallelism = () => 1;`,
  "",
].join("\n");

function publishedPaths(project: Project, root: string) {
  const base = path.posix.join(path.posix.dirname(root), `.cognix-published-${project.id}`);
  return {
    base,
    current: path.posix.join(base, "current"),
    previous: path.posix.join(base, "previous"),
    staging: path.posix.join(base, `staging-${Date.now()}`),
  };
}

function publishedSessionId(project: Project) {
  return `cognix-published-${project.id.slice(0, 12)}`;
}

function developmentSessionIds(project: Project) {
  const suffix = project.id.slice(0, 12);
  return [`cognix-${suffix}`, `cognix-preview-${suffix}`];
}

async function pauseDevelopmentPreview(sandbox: Sandbox, project: Project, root: string) {
  const health = await getPreviewHealth(sandbox, 3000);
  for (const sessionId of developmentSessionIds(project)) {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
  if (health.reachable) {
    await sandbox.process.executeCommand(
      "if command -v fuser >/dev/null 2>&1; then fuser -k 3000/tcp >/dev/null 2>&1 || true; fi",
      root,
      undefined,
      20,
    );
  }
  return health.reachable;
}

async function resumeDevelopmentPreview(sandbox: Sandbox, project: Project, root: string) {
  const sessionId = `cognix-preview-${project.id.slice(0, 12)}`;
  await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  await sandbox.process.createSession(sessionId);
  await sandbox.process.executeSessionCommand(
    sessionId,
    {
      command: `cd ${shellQuote(root)} && npm run dev -- --hostname 0.0.0.0 --port 3000`,
      runAsync: true,
      suppressInputEcho: true,
    },
    30,
  );
  await sandbox.process.executeCommand(
    "for i in $(seq 1 60); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ || true); case \"$status\" in 2*|3*) exit 0 ;; esac; sleep 1; done; exit 1",
    root,
    undefined,
    70,
  );
}

async function stopPublishedSession(sandbox: Sandbox, project: Project) {
  await sandbox.process.deleteSession(publishedSessionId(project)).catch(() => undefined);
}

async function startPublishedProcess(sandbox: Sandbox, project: Project, productionRoot: string, command: string) {
  const sessionId = publishedSessionId(project);
  await stopPublishedSession(sandbox, project);
  await sandbox.process.createSession(sessionId);
  const started = await sandbox.process.executeSessionCommand(
    sessionId,
    {
      command: `cd ${shellQuote(productionRoot)} && ${command}`,
      runAsync: true,
      suppressInputEcho: true,
    },
    30,
  );
  const wait = await sandbox.process.executeCommand(
    `for i in $(seq 1 60); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PUBLISHED_PORT}/ || true); case "$status" in 2*|3*) exit 0 ;; esac; sleep 2; done; exit 1`,
    productionRoot,
    undefined,
    130,
  );
  if (wait.exitCode !== 0) {
    const logs = await sandbox.process.getSessionCommandLogs(sessionId, started.cmdId).catch(() => null);
    const output = [logs?.stdout, logs?.stderr, logs?.output].filter(Boolean).join("\n").slice(-5000);
    throw new Error(`The published server did not become healthy:\n${output || "No server output was captured."}`);
  }
}

async function publishedStartCommand(sandbox: Sandbox, root: string) {
  const packageJson = JSON.parse((await sandbox.fs.downloadFile(`${root}/package.json`)).toString("utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  if (scripts.start) {
    const isNext = Boolean(packageJson.dependencies?.next || packageJson.devDependencies?.next);
    return isNext
      ? `PORT=${PUBLISHED_PORT} HOSTNAME=0.0.0.0 npm run start -- --hostname 0.0.0.0 --port ${PUBLISHED_PORT}`
      : `PORT=${PUBLISHED_PORT} HOST=0.0.0.0 npm run start`;
  }
  if (scripts.preview) return `npm run preview -- --host 0.0.0.0 --port ${PUBLISHED_PORT}`;
  throw new Error("The generated app needs a production `start` or `preview` script before it can be published.");
}

async function configurePublishedLifecycle(sandbox: Sandbox) {
  const autoStop = publishedAutoStopMinutes();
  await sandbox.setAutostopInterval(autoStop);
  await sandbox.setAutoArchiveInterval(autoStop > 0 ? 1440 : 0);
  await sandbox.setAutoDeleteInterval(-1);
  await sandbox.refreshData();
  if (sandbox.autoStopInterval !== autoStop) {
    throw new Error("Daytona did not apply the auto-stop interval for the published sandbox.");
  }
  if (sandbox.autoDeleteInterval !== -1) {
    throw new Error("Daytona did not disable auto-delete for the published sandbox.");
  }
}

export async function deployPublishedApp(project: Project) {
  const sandbox = await getSandbox(project);
  if (!sandbox) throw new Error("Build the app before publishing it.");
  const root = await getProjectRoot(sandbox);
  const paths = publishedPaths(project, root);
  const resumePreview = await pauseDevelopmentPreview(sandbox, project, root);
  try {
    const sourcePackage = await sandbox.process.executeCommand("test -f package.json", root, undefined, 10);
    if (sourcePackage.exitCode !== 0) throw new Error("The project is missing package.json.");

    const sourceNodeModules = path.posix.join(root, "node_modules");
    const stagingNodeModules = path.posix.join(paths.staging, "node_modules");
    const prepare = await sandbox.process.executeCommand(
      [
        `mkdir -p ${shellQuote(paths.base)}`,
        `find ${shellQuote(paths.base)} -mindepth 1 -maxdepth 1 -type d -name 'staging-*' -exec rm -rf -- {} +`,
        `mkdir -p ${shellQuote(paths.staging)}`,
        `tar --exclude='./node_modules' --exclude='./.next' --exclude='./.git' -cf - . | tar -xf - -C ${shellQuote(paths.staging)}`,
        clonePublishedDependenciesCommand(sourceNodeModules, stagingNodeModules),
      ].join(" && "),
      root,
      undefined,
      180,
    );
    if (prepare.exitCode !== 0) {
      await sandbox.process.executeCommand(`rm -rf ${shellQuote(paths.staging)}`, root, undefined, 60);
      throw new Error(
        `Could not prepare the production release from the verified workspace dependencies:\n${prepare.result.slice(-5000)}`,
      );
    }

    const buildLimitsPath = path.posix.join(paths.staging, ".cognix-build-limits.cjs");
    await sandbox.fs.uploadFile(Buffer.from(publishedBuildLimitsSource), buildLimitsPath);
    const build = await sandbox.process.executeCommand(
      "npm run build",
      paths.staging,
      {
        CI: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `--max-old-space-size=512 --require=${buildLimitsPath}`,
      },
      600,
    );
    if (build.exitCode !== 0) {
      await sandbox.process.executeCommand(`rm -rf ${shellQuote(paths.staging)}`, root, undefined, 60);
      throw new Error(`The production build failed:\n${build.result.slice(-6000)}`);
    }
    const command = await publishedStartCommand(sandbox, paths.staging);

    const currentCheck = await sandbox.process.executeCommand(
      `test -d ${shellQuote(paths.current)}`,
      root,
      undefined,
      10,
    );
    const hadCurrent = currentCheck.exitCode === 0;
    await stopPublishedSession(sandbox, project);
    const swap = await sandbox.process.executeCommand(
      `rm -rf ${shellQuote(paths.previous)} && ${hadCurrent ? `mv ${shellQuote(paths.current)} ${shellQuote(paths.previous)} && ` : ""}mv ${shellQuote(paths.staging)} ${shellQuote(paths.current)}`,
      root,
      undefined,
      60,
    );
    if (swap.exitCode !== 0) {
      await sandbox.process.executeCommand(`rm -rf ${shellQuote(paths.staging)}`, root, undefined, 60);
      throw new Error(`The production release could not be activated:\n${swap.result.slice(-4000)}`);
    }

    try {
      await startPublishedProcess(sandbox, project, paths.current, command);
    } catch (error) {
      await stopPublishedSession(sandbox, project);
      if (hadCurrent) {
        await sandbox.process.executeCommand(
          `rm -rf ${shellQuote(paths.current)} && mv ${shellQuote(paths.previous)} ${shellQuote(paths.current)}`,
          root,
          undefined,
          60,
        );
        const previousCommand = await publishedStartCommand(sandbox, paths.current);
        await startPublishedProcess(sandbox, project, paths.current, previousCommand).catch(() => undefined);
      }
      throw error;
    }

    await sandbox.process.executeCommand(`rm -rf ${shellQuote(paths.previous)}`, root, undefined, 60);
    await configurePublishedLifecycle(sandbox);
    const runtimeUrl = await getVerifiedSignedPreviewUrl(sandbox, PUBLISHED_PORT);
    if (!runtimeUrl) throw new Error("The production server started, but its public proxy did not become ready.");
    rememberPublishedRuntime(project.id, runtimeUrl);
    forgetPublishedProxyTarget(project.id);
    return { runtimeUrl, port: PUBLISHED_PORT };
  } finally {
    if (resumePreview) {
      await resumeDevelopmentPreview(sandbox, project, root).catch(() => undefined);
    }
  }
}

/**
 * Returns a verified URL for the published production server.
 * Hot path: a recently verified URL is reused, and concurrent visitors share one lookup,
 * so a page view normally costs no Daytona API calls.
 */
export async function getPublishedAppRuntimeUrl(project: Project) {
  const cached = publishedRuntimes.get(project.id);
  if (cached && Date.now() - cached.issuedAt < PUBLISHED_URL_REUSE_MS) {
    if (Date.now() - cached.checkedAt < PUBLISHED_URL_RECHECK_MS) return cached.url;
    if (await isPreviewUrlHealthy(cached.url, 5_000)) {
      cached.checkedAt = Date.now();
      return cached.url;
    }
  }
  publishedRuntimes.delete(project.id);

  let lookup = publishedRuntimeLookups.get(project.id);
  if (!lookup) {
    lookup = resolvePublishedAppRuntimeUrl(project)
      .then((url) => {
        if (url) rememberPublishedRuntime(project.id, url);
        return url;
      })
      .finally(() => publishedRuntimeLookups.delete(project.id));
    publishedRuntimeLookups.set(project.id, lookup);
  }
  return lookup;
}

/** Starts the sandbox and the saved production server if needed. Returns null when there is no release to serve. */
async function ensurePublishedRuntime(project: Project) {
  const sandbox = await getSandbox(project);
  if (!sandbox) return null;
  const root = await getProjectRoot(sandbox);
  const current = publishedPaths(project, root).current;
  const exists = await sandbox.process.executeCommand(`test -f ${shellQuote(`${current}/package.json`)}`, root, undefined, 10);
  if (exists.exitCode !== 0) return null;
  let health = await getPreviewHealth(sandbox, PUBLISHED_PORT);
  if (!health.healthy) {
    const command = await publishedStartCommand(sandbox, current);
    await startPublishedProcess(sandbox, project, current, command);
    health = await getPreviewHealth(sandbox, PUBLISHED_PORT);
  }
  if (!health.healthy) return null;
  await configurePublishedLifecycle(sandbox);
  return sandbox;
}

async function resolvePublishedAppRuntimeUrl(project: Project) {
  const sandbox = await ensurePublishedRuntime(project);
  if (!sandbox) return null;
  // Serving the published copy must not change the project's status: that tracks the editor's live preview
  // and whether there are changes waiting to publish.
  return getVerifiedSignedPreviewUrl(sandbox, PUBLISHED_PORT);
}

/**
 * Where a custom preview proxy (cloudflare/edge-worker.js) forwards a published app's traffic:
 * Daytona's standard preview URL for the production port plus the sandbox's preview token.
 * See https://www.daytona.io/docs/en/custom-preview-proxy/
 */
export type PublishedProxyTarget = { upstream: string; token: string };

type CachedProxyTarget = PublishedProxyTarget & { issuedAt: number; checkedAt: number };

declare global {
  var __cognixPublishedProxyTargets: Map<string, CachedProxyTarget> | undefined;
  var __cognixPublishedProxyLookups: Map<string, Promise<PublishedProxyTarget | null>> | undefined;
  var __cognixPreviewProxyTargets: Map<string, CachedProxyTarget> | undefined;
  var __cognixPreviewProxyLookups: Map<string, Promise<PublishedProxyTarget | null>> | undefined;
}

const publishedProxyTargets =
  globalThis.__cognixPublishedProxyTargets ?? (globalThis.__cognixPublishedProxyTargets = new Map());
const publishedProxyLookups =
  globalThis.__cognixPublishedProxyLookups ?? (globalThis.__cognixPublishedProxyLookups = new Map());
const previewProxyTargets =
  globalThis.__cognixPreviewProxyTargets ?? (globalThis.__cognixPreviewProxyTargets = new Map());
const previewProxyLookups =
  globalThis.__cognixPreviewProxyLookups ?? (globalThis.__cognixPreviewProxyLookups = new Map());

function forgetPublishedProxyTarget(projectId: string) {
  publishedProxyTargets.delete(projectId);
  publishedProxyLookups.delete(projectId);
}

function forgetPreviewProxyTarget(projectId: string) {
  previewProxyTargets.delete(projectId);
  previewProxyLookups.delete(projectId);
}

function rememberPreviewProxyTarget(projectId: string, target: PublishedProxyTarget) {
  const now = Date.now();
  previewProxyTargets.set(projectId, { ...target, issuedAt: now, checkedAt: now });
}

/** Headers a custom proxy sends to Daytona so the sandbox sees the visitor's host and no Daytona interstitial. */
export function publishedProxyHeaders(target: Pick<PublishedProxyTarget, "token">, forwardedHost: string) {
  return {
    "X-Daytona-Preview-Token": target.token,
    "X-Daytona-Skip-Preview-Warning": "true",
    // Daytona's default CORS policy allows every origin with credentials. The published app sets its own.
    "X-Daytona-Disable-CORS": "true",
    "X-Forwarded-Host": forwardedHost,
    "X-Forwarded-Proto": "https",
    "X-Daytona-Trust-Forwarded-Host": "true",
  };
}

async function isProxyTargetHealthy(target: PublishedProxyTarget, timeoutMs = 8_000) {
  try {
    const response = await fetch(target.upstream, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "X-Daytona-Preview-Token": target.token,
        "X-Daytona-Skip-Preview-Warning": "true",
        "X-Daytona-Skip-Last-Activity-Update": "true",
      },
    });
    await response.body?.cancel();
    return isHealthyPreviewStatus(response.status);
  } catch {
    return false;
  }
}

async function verifyPortProxyTarget(sandbox: Sandbox, port: number): Promise<PublishedProxyTarget | null> {
  for (let attempt = 0; attempt < PREVIEW_PROXY_VERIFY_ATTEMPTS; attempt += 1) {
    const link = await sandbox.getPreviewLink(port);
    const target = { upstream: link.url, token: link.token };
    if (await isProxyTargetHealthy(target)) return target;
    if (attempt < PREVIEW_PROXY_VERIFY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return null;
}

async function resolvePublishedProxyTarget(project: Project): Promise<PublishedProxyTarget | null> {
  const sandbox = await ensurePublishedRuntime(project);
  if (!sandbox) return null;
  return verifyPortProxyTarget(sandbox, PUBLISHED_PORT);
}

async function resolvePreviewProxyTarget(project: Project): Promise<PublishedProxyTarget | null> {
  const sandbox = await getSandbox(project);
  if (!sandbox) return null;
  if (!(await ensureDevServerHealthy(sandbox, project, 3000))) return null;
  return verifyPortProxyTarget(sandbox, 3000);
}

/**
 * Returns the verified Daytona upstream and preview token for a live dev preview (port 3000),
 * waking the sandbox and starting `npm run dev` when needed.
 */
export async function getPreviewProxyTarget(project: Project, options: { fresh?: boolean } = {}) {
  const cached = options.fresh ? undefined : previewProxyTargets.get(project.id);
  if (cached && Date.now() - cached.issuedAt < PUBLISHED_URL_REUSE_MS) {
    if (Date.now() - cached.checkedAt < PUBLISHED_URL_RECHECK_MS) return { upstream: cached.upstream, token: cached.token };
    if (await isProxyTargetHealthy(cached, 5_000)) {
      cached.checkedAt = Date.now();
      return { upstream: cached.upstream, token: cached.token };
    }
  }
  previewProxyTargets.delete(project.id);

  let lookup = previewProxyLookups.get(project.id);
  if (!lookup) {
    lookup = resolvePreviewProxyTarget(project)
      .then((target) => {
        if (target) rememberPreviewProxyTarget(project.id, target);
        return target;
      })
      .finally(() => previewProxyLookups.delete(project.id));
    previewProxyLookups.set(project.id, lookup);
  }
  return lookup;
}

/**
 * Returns the verified Daytona upstream and preview token for a published app, starting it when needed.
 * Like the runtime URL, a recent result is reused and concurrent lookups for one project share a request.
 * The token never leaves the server except to the Cognix edge worker, which authenticates with COGNIX_EDGE_SECRET.
 */
export async function getPublishedProxyTarget(project: Project, options: { fresh?: boolean } = {}) {
  const cached = options.fresh ? undefined : publishedProxyTargets.get(project.id);
  if (cached && Date.now() - cached.issuedAt < PUBLISHED_URL_REUSE_MS) {
    if (Date.now() - cached.checkedAt < PUBLISHED_URL_RECHECK_MS) return { upstream: cached.upstream, token: cached.token };
    if (await isProxyTargetHealthy(cached, 5_000)) {
      cached.checkedAt = Date.now();
      return { upstream: cached.upstream, token: cached.token };
    }
  }
  publishedProxyTargets.delete(project.id);

  let lookup = publishedProxyLookups.get(project.id);
  if (!lookup) {
    lookup = resolvePublishedProxyTarget(project)
      .then((target) => {
        if (target) {
          const now = Date.now();
          publishedProxyTargets.set(project.id, { ...target, issuedAt: now, checkedAt: now });
        }
        return target;
      })
      .finally(() => publishedProxyLookups.delete(project.id));
    publishedProxyLookups.set(project.id, lookup);
  }
  return lookup;
}

export async function stopPublishedApp(project: Project) {
  publishedRuntimes.delete(project.id);
  forgetPublishedProxyTarget(project.id);
  const sandbox = await getSandbox(project);
  if (!sandbox) return;
  await stopPublishedSession(sandbox, project);
  await sandbox.setAutostopInterval(30);
  await sandbox.setAutoArchiveInterval(1440);
  await sandbox.setAutoDeleteInterval(-1);
}

/** Permanently deletes the project's sandbox, including its development preview and published runtime. */
export async function deleteProjectSandbox(project: Project) {
  publishedRuntimes.delete(project.id);
  publishedRuntimeLookups.delete(project.id);
  forgetPublishedProxyTarget(project.id);
  forgetPreviewProxyTarget(project.id);
  if (!project.sandboxId) return;
  try {
    const sandbox = await getClient().get(project.sandboxId);
    await sandbox.delete(60);
  } catch (error) {
    // A sandbox that is already gone needs no cleanup.
    if (error instanceof DaytonaNotFoundError) return;
    throw error;
  }
}

/**
 * Reads the project's source files from its sandbox for committing to GitHub.
 * Dependencies, build output, `.git`, logs, and every `.env*` file are excluded, the same as Download.
 * Credentials never enter the sandbox: this only packs files there and reads them on the server.
 */
export async function readProjectSnapshot(project: Project, limits = { maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 150 * 1024 * 1024 }) {
  const sandbox = await getSandbox(project);
  if (!sandbox) return null;
  const root = await getProjectRoot(sandbox);
  const archiveName = `.cognix-snapshot-${project.id}.tar.gz`;
  const result = await sandbox.process.executeCommand(
    `tar --warning=no-file-changed --ignore-failed-read --exclude='./node_modules' --exclude='./.next' --exclude='./.git' --exclude='./${archiveName}' --exclude='./.cognix-export-*' --exclude='.env*' --exclude='*.log' --exclude='./uploads' -czf '${archiveName}' .`,
    root,
    undefined,
    150,
  );
  // GNU tar exits 1 when a file changed while it was read (a running dev server does this). The archive is still valid.
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(`The project files could not be packed:\n${result.result.slice(-2000)}`);
  const remotePath = `${getProjectFsRoot()}/${archiveName}`;
  try {
    const archive = await sandbox.fs.downloadFile(remotePath);
    const { extractTarGz } = await import("./tar");
    return extractTarGz(archive, limits);
  } finally {
    await sandbox.fs.deleteFile(remotePath).catch(() => undefined);
  }
}

/** Paths Git sync never reads from or writes to the sandbox: dependencies, build output, secrets, logs. */
export function isSyncablePath(path: string) {
  const segments = path.split("/");
  if (!path || path.startsWith("/") || segments.some((segment) => segment === ".." || segment === "." || segment === "")) return false;
  const [first] = segments;
  if (["node_modules", ".next", ".git", "uploads"].includes(first)) return false;
  const name = segments.at(-1) ?? "";
  return !name.startsWith(".env") && !name.endsWith(".log") && !name.startsWith(".cognix-");
}

/**
 * Applies files pulled from GitHub to the sandbox. Every path is checked again here, so a crafted
 * repository can't write outside the project, replace `.env*`, or touch dependencies.
 */
export async function applyProjectFiles(
  project: Project,
  changes: { write: { path: string; content: Buffer }[]; remove: string[] },
) {
  const sandbox = await getSandbox(project);
  if (!sandbox) throw new Error("Build the project before syncing files into it.");
  const root = await getProjectRoot(sandbox);
  const fsRoot = getProjectFsRoot();
  const write = changes.write.filter((file) => isSyncablePath(file.path));
  const remove = changes.remove.filter(isSyncablePath);

  const folders = [...new Set(write.map((file) => path.posix.dirname(file.path)).filter((folder) => folder !== "."))];
  for (let index = 0; index < folders.length; index += 200) {
    const batch = folders.slice(index, index + 200).map((folder) => shellQuote(folder)).join(" ");
    await sandbox.process.executeCommand(`mkdir -p -- ${batch}`, root, undefined, 30);
  }
  for (let index = 0; index < write.length; index += 50) {
    await sandbox.fs.uploadFiles(
      write.slice(index, index + 50).map((file) => ({ source: file.content, destination: `${fsRoot}/${file.path}` })),
      120,
    );
  }
  for (let index = 0; index < remove.length; index += 200) {
    const batch = remove.slice(index, index + 200).map((file) => shellQuote(file)).join(" ");
    await sandbox.process.executeCommand(`rm -f -- ${batch}`, root, undefined, 30);
  }

  // New or changed dependencies need installing before the dev server can use them. Runs in the background.
  if (write.some((file) => /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(file.path))) {
    const sessionId = `cognix-sync-${project.id.slice(0, 12)}`;
    await sandbox.process.createSession(sessionId).catch(() => undefined);
    await sandbox.process
      .executeSessionCommand(sessionId, { command: `cd ${shellQuote(root)} && npm install --include=dev --no-audit --no-fund`, runAsync: true }, 30)
      .catch(() => undefined);
  }
  return { written: write.length, removed: remove.length };
}

/**
 * Copies a project's source files into another project's new sandbox, then installs dependencies and
 * starts the preview. Secrets (`.env*`), dependencies, build output, and Git data are not copied.
 */
export async function copyProjectSandbox(source: Project, target: Project) {
  const snapshot = await readProjectSnapshot(source);
  if (!snapshot) throw new Error("The original project has no files to copy yet.");
  const { sandbox, project } = await ensureSandbox(target);
  const root = await getProjectRoot(sandbox);
  await sandbox.process.executeCommand("mkdir -p app", path.posix.dirname(root), undefined, 30);
  await applyProjectFiles(project, { write: snapshot.files.map((file) => ({ path: file.path, content: file.content })), remove: [] });
  const install = await sandbox.process.executeCommand("npm install --include=dev --no-audit --no-fund", root, { CI: "1" }, 600);
  if (install.exitCode !== 0) throw new Error(`Dependencies couldn't be installed:\n${install.result.slice(-3000)}`);
  await resumeDevelopmentPreview(sandbox, project, root);
  return { project, files: snapshot.files };
}

export async function syncProjectEnv(project: Project) {
  const sandbox = await getSandbox(project);
  if (!sandbox) return;

  const { getDecryptedSecrets } = await import("./store");
  const { renderEnvFile } = await import("./env-files");
  
  const secrets = await getDecryptedSecrets(project.id);
  const envContent = renderEnvFile(secrets);

  const root = await getProjectRoot(sandbox);
  if (project.mode === "security") {
    // Security mode works on the user's own repository: keep secrets outside it, so they never show up as a change
    // to push, and never touch the repository's .gitignore or its own .env files.
    const outsidePath = `${path.posix.dirname(root)}/.cognix-env`;
    await sandbox.fs.uploadFile(Buffer.from(envContent), outsidePath);
    await sandbox.process.executeCommand(`chmod 600 ${shellQuote(outsidePath)}`, root, undefined, 10);
    return;
  }
  const envPath = `${root}/.env.local`;
  
  await sandbox.fs.uploadFile(Buffer.from(envContent), envPath);
  await sandbox.process.executeCommand(`chmod 600 ${shellQuote(envPath)}`, root, undefined, 10);
  await sandbox.process.executeCommand(`grep -q '^\\.env\\*$' .gitignore || echo '.env*' >> .gitignore`, root, undefined, 10);

  // Restart development session
  const sessionId = `cognix-preview-${project.id.slice(0, 12)}`;
  let hasActiveCommand = false;
  try {
    const session = await sandbox.process.getSession(sessionId);
    hasActiveCommand = session.commands?.some((command) => command.exitCode == null) ?? false;
  } catch {
    // Session doesn't exist
  }
  
  if (hasActiveCommand) {
    const health = await getPreviewHealth(sandbox, 3000);
    if (health.reachable) {
      await sandbox.process.executeCommand(
        "if command -v fuser >/dev/null 2>&1; then fuser -k 3000/tcp >/dev/null 2>&1 || true; fi",
        root,
        undefined,
        20,
      );
    }
    forgetPreviewProxyTarget(project.id);
    await resumeDevelopmentPreview(sandbox, project, root).catch(() => undefined);
  }
}

// Keep every Daytona lifecycle operation behind this module.
