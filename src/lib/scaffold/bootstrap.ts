import path from "node:path";
import {
  buildDevServerCommand,
  getPreviewHealth,
  getPreviewUrl,
  syncProjectEnv,
  type Sandbox,
} from "../daytona";
import { getPinnedScaffoldVersion } from "../feature-flags";
import { upsertProjectFile } from "../store";
import type { Project } from "../types";
import { composeScaffold, isEligibleForNewProjectScaffold, selectScaffoldProfilesForPrompt } from "./composer";
import type { ScaffoldManifest } from "./types";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export type ScaffoldBootstrapResult =
  | { applied: false; reason: "existing_project" | "failed" }
  | {
      applied: true;
      manifest: ScaffoldManifest;
      changedPaths: string[];
      previewUrl: string | null;
      installDurationMs: number;
      previewStartDurationMs: number;
    };

/**
 * Phase 2 deterministic bootstrap for genuinely new projects (gated behind `COGNIX_PERF_SCAFFOLD_BOOTSTRAP`).
 * Materializes the minimal versioned scaffold, injects `.env.local`, installs dependencies once,
 * and starts the persistent development preview server before Turn 0 of the coding agent.
 */
export async function materializeProjectScaffold(input: {
  project: Project;
  sandbox: Sandbox;
  projectRoot: string;
  projectFsRoot: string;
  prompt: string;
  cloudEnabled: boolean;
  onStatus?: (label: string) => void | Promise<void>;
}): Promise<ScaffoldBootstrapResult> {
  const { project, sandbox, projectRoot, projectFsRoot, prompt, cloudEnabled, onStatus } = input;

  const existingListing = await sandbox.process
    .executeCommand("find . -maxdepth 2 -not -path './node_modules/*' -not -path './.next/*' -print", projectRoot, undefined, 15)
    .catch(() => ({ exitCode: 1, result: "" }));
  const existingFiles = existingListing.result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== ".");

  if (!isEligibleForNewProjectScaffold(existingFiles)) {
    return { applied: false, reason: "existing_project" };
  }

  const profiles = cloudEnabled ? selectScaffoldProfilesForPrompt(prompt) : (["base"] as const);
  const composed = composeScaffold(profiles, getPinnedScaffoldVersion());

  await onStatus?.(`Preparing Cognix scaffold v${composed.manifest.templateVersion} (${composed.manifest.profiles.join(", ")})`);

  const directories = [
    ...new Set(
      composed.files
        .map((file) => path.posix.dirname(file.path))
        .filter((dir) => dir && dir !== "."),
    ),
  ];
  if (directories.length > 0) {
    await sandbox.process.executeCommand(
      `mkdir -p -- ${directories.map(shellQuote).join(" ")}`,
      projectRoot,
      undefined,
      20,
    );
  }

  for (const file of composed.files) {
    await sandbox.fs.uploadFile(Buffer.from(file.content, "utf8"), `${projectFsRoot}/${file.path}`);
    await upsertProjectFile(project.id, file.path, file.content).catch(() => undefined);
  }

  // Inject project environment variables after scaffold creation and before starting the server.
  await syncProjectEnv(project).catch(() => undefined);

  const installStart = Date.now();
  await onStatus?.("Installing scaffold dependencies");
  const install = await sandbox.process.executeCommand(
    "npm install --include=dev --no-audit --no-fund",
    projectRoot,
    { CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
    360,
  );
  const installDurationMs = Date.now() - installStart;
  if (install.exitCode !== 0) {
    return { applied: false, reason: "failed" };
  }

  const previewStart = Date.now();
  await onStatus?.("Starting early live preview");
  const sessionId = `cognix-preview-${project.id.slice(0, 12)}`;
  try {
    await sandbox.process.getSession(sessionId);
  } catch {
    await sandbox.process.createSession(sessionId);
  }
  await sandbox.process.executeSessionCommand(
    sessionId,
    {
      command: buildDevServerCommand(projectRoot, 3000),
      runAsync: true,
      suppressInputEcho: true,
    },
    30,
  );

  await sandbox.process
    .executeCommand(
      "for i in $(seq 1 35); do status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health || true); case \"$status\" in 2*|3*) exit 0 ;; esac; sleep 1; done; exit 1",
      projectRoot,
      undefined,
      45,
    )
    .catch(() => ({ exitCode: 1, result: "" }));

  const health = await getPreviewHealth(sandbox, 3000).catch(() => ({ healthy: false, reachable: false, status: "000" }));
  const previewUrl = health.healthy ? await getPreviewUrl({ ...project, sandboxId: sandbox.id }, 3000).catch(() => null) : null;
  const previewStartDurationMs = Date.now() - previewStart;

  return {
    applied: true,
    manifest: composed.manifest,
    changedPaths: composed.files.map((file) => file.path),
    previewUrl,
    installDurationMs,
    previewStartDurationMs,
  };
}
