export type ScaffoldProfile = "base" | "database" | "auth" | "storage" | "email";

export type ScaffoldFile = {
  path: string;
  content: string;
};

export type ScaffoldManifest = {
  templateVersion: string;
  profiles: ScaffoldProfile[];
  frameworkVersions: Record<string, string>;
  fileHashes: Record<string, string>;
  contentHash: string;
};

export type ComposedScaffold = {
  manifest: ScaffoldManifest;
  files: ScaffoldFile[];
};
