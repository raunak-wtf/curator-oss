import { createHash } from "node:crypto";
import type { CloudFeature } from "../cloud-features";
import { inferPromptCloudFeatures } from "../ai/cloud-intent";
import {
  DATABASE_WITH_AUTH_SCHEMA_TS,
  PROFILE_OVERLAYS,
  SCAFFOLD_PROFILE_ORDER,
  SCAFFOLD_TEMPLATE_VERSION,
} from "./profiles";
import type { ComposedScaffold, ScaffoldFile, ScaffoldProfile } from "./types";

const FORBIDDEN_SECRET_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI/Stripe secret key", pattern: /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{12,}\b/ },
  { label: "Bucketline management key", pattern: /\bbk_[A-Za-z0-9_-]{12,}\b/ },
  { label: "Resend API key", pattern: /\bre_[A-Za-z0-9_-]{12,}\b/ },
  { label: "Webhook signing secret", pattern: /\bwhsec_[A-Za-z0-9+/=_-]{16,}\b/ },
  { label: "PostgreSQL credentials URI", pattern: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i },
  { label: "Host service env var", pattern: /\b(?:DAYTONA_API_KEY|AUTH0_CLIENT_SECRET|NEON_API_KEY|BUCKETLINE_API_KEY|COGNIX_SECRETS_KEY|COGNIX_EDGE_SECRET|DODO_PAYMENTS_API_KEY)\b/ },
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

export function resolveScaffoldProfiles(requested: readonly ScaffoldProfile[]): ScaffoldProfile[] {
  const active = new Set<ScaffoldProfile>(["base"]);
  for (const profile of requested) {
    active.add(profile);
    if (profile === "auth") active.add("database");
  }
  return SCAFFOLD_PROFILE_ORDER.filter((profile) => active.has(profile));
}

export function selectScaffoldProfilesForPrompt(
  prompt: string,
  enabledCloudFeatures?: readonly CloudFeature[],
): ScaffoldProfile[] {
  const inferred = enabledCloudFeatures?.length ? [...enabledCloudFeatures] : inferPromptCloudFeatures(prompt);
  return resolveScaffoldProfiles(["base", ...inferred]);
}

/**
 * Only genuinely new projects with no user-owned `package.json` may receive the automatic scaffold.
 * Existing and imported repositories always preserve their own framework and dependency graph.
 */
export function isEligibleForNewProjectScaffold(existingFilePaths: readonly string[]): boolean {
  return !existingFilePaths.some((filePath) => {
    const normalized = filePath.replaceAll("\\", "/").replace(/^\.?\//, "").toLowerCase();
    return normalized === "package.json";
  });
}

export function assertScaffoldContainsNoSecrets(files: readonly ScaffoldFile[]): void {
  for (const file of files) {
    for (const rule of FORBIDDEN_SECRET_PATTERNS) {
      if (rule.pattern.test(file.content)) {
        throw new Error(`Scaffold secret-scan failed on ${file.path}: matched ${rule.label}.`);
      }
    }
  }
}

export function composeScaffold(
  requestedProfiles: readonly ScaffoldProfile[] = ["base"],
  templateVersion = SCAFFOLD_TEMPLATE_VERSION,
): ComposedScaffold {
  const profiles = resolveScaffoldProfiles(requestedProfiles);
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const scripts: Record<string, string> = {};
  const fileMap = new Map<string, string>();

  for (const profile of profiles) {
    const overlay = PROFILE_OVERLAYS[profile];
    Object.assign(dependencies, overlay.dependencies);
    Object.assign(devDependencies, overlay.devDependencies);
    Object.assign(scripts, overlay.scripts);
    for (const file of overlay.files) {
      if (fileMap.has(file.path)) {
        throw new Error(`Scaffold overlay conflict detected on ${file.path} while applying profile "${profile}".`);
      }
      fileMap.set(file.path, file.content);
    }
  }

  // When both database and auth profiles are composed, upgrade schema.ts to include Better Auth's 4 core tables.
  if (profiles.includes("database") && profiles.includes("auth")) {
    fileMap.set("src/lib/schema.ts", DATABASE_WITH_AUTH_SCHEMA_TS);
  }

  const packageJson = {
    name: "cognix-app",
    version: "0.1.0",
    private: true,
    scripts: sortRecord(scripts),
    dependencies: sortRecord(dependencies),
    devDependencies: sortRecord(devDependencies),
  };
  fileMap.set("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

  const files: ScaffoldFile[] = [...fileMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, content]) => ({ path: filePath, content }));

  assertScaffoldContainsNoSecrets(files);

  const fileHashes: Record<string, string> = {};
  for (const file of files) {
    fileHashes[file.path] = sha256(file.content);
  }

  const manifestPayload = JSON.stringify({
    templateVersion,
    profiles,
    fileHashes,
  });
  const contentHash = sha256(manifestPayload);

  return {
    manifest: {
      templateVersion,
      profiles,
      frameworkVersions: {
        next: dependencies.next,
        react: dependencies.react,
        typescript: devDependencies.typescript,
        tailwindcss: devDependencies.tailwindcss,
      },
      fileHashes,
      contentHash,
    },
    files,
  };
}
