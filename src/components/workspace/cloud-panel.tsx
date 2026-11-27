"use client";

import {
  Check,
  Cloud,
  Database,
  Globe2,
  HardDrive,
  KeyRound,
  Lock,
  Mail,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CustomDomainsPanel } from "@/components/custom-domains-panel";
import { PixelLoader } from "@/components/pixel-loader";
import { SecretsPanel } from "@/components/secrets-panel";
import { CLOUD_FEATURE_ORDER, CLOUD_FEATURES, type CloudFeature } from "@/lib/cloud-features";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CloudAuthPanel } from "./cloud-auth-panel";
import { CloudDatabasePanel } from "./cloud-database-panel";
import { CloudEmailsPanel } from "./cloud-emails-panel";
import { ProjectSettings } from "./project-settings";
import { PublishSection } from "./publish-section";

export type CloudSection = "settings" | "publish" | "domains" | "secrets" | "cloud" | CloudFeature;

const FEATURE_ICONS: Record<CloudFeature, LucideIcon> = {
  database: Database,
  storage: HardDrive,
  email: Mail,
  auth: ShieldCheck,
};

const NAV: { heading: string; items: { id: CloudSection; label: string; icon: LucideIcon; cloud?: boolean }[] }[] = [
  {
    heading: "Deployment",
    items: [
      { id: "publish", label: "Publish", icon: Rocket },
      { id: "domains", label: "Domains", icon: Globe2 },
      { id: "secrets", label: "Secrets", icon: KeyRound },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
  {
    heading: "Cognix Cloud",
    items: [
      { id: "cloud", label: "Overview", icon: Cloud },
      ...CLOUD_FEATURE_ORDER.map((feature) => ({
        id: feature as CloudSection,
        label: CLOUD_FEATURES[feature].label,
        icon: FEATURE_ICONS[feature],
        cloud: true,
      })),
    ],
  },
];

type CloudPanelProps = {
  project: Project;
  slug: string;
  publishBaseLabel: string;
  publishDomainSuffix?: string;
  publishedAutoStopMinutes?: number;
  publishedUrl: string;
  canPublish: boolean;
  isPublishing: boolean;
  isBuilding: boolean;
  hasUnpublishedChanges: boolean;
  domainRefreshKey: number;
  /** Changes when another control asks to open Publish and focus the address field. */
  focusRequest: number;
  cloudEnabled: boolean;
  cloudBusy: boolean;
  onSlugChange: (slug: string) => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onSetCloudEnabled: (enabled: boolean) => void;
  /** Puts a prompt into the chat composer so the agent can build the feature. */
  onAskAgent: (prompt: string) => void;
  onProjectChange: (project: Project) => void;
};

export function CloudPanel(props: CloudPanelProps) {
  const { project, cloudEnabled, cloudBusy, focusRequest, onSetCloudEnabled, onAskAgent } = props;
  const [section, setSection] = useState<CloudSection>("publish");
  const [handledFocus, setHandledFocus] = useState(focusRequest);
  const [secretNames, setSecretNames] = useState<string[] | null>(null);
  const [secretsError, setSecretsError] = useState(false);

  // Opening from the toolbar rocket always lands on Publish.
  if (focusRequest !== handledFocus) {
    setHandledFocus(focusRequest);
    setSection("publish");
  }

  const loadSecretNames = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${project.id}/secrets`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load secrets");
      const payload = (await response.json()) as { secrets?: { name: string }[] };
      setSecretNames((payload.secrets ?? []).map((secret) => secret.name));
      setSecretsError(false);
    } catch {
      setSecretsError(true);
    }
  }, [project.id]);

  // Refresh which variables are set whenever a Cognix Cloud page opens, since Secrets may have changed.
  const onCloudPage = section === "cloud" || section in CLOUD_FEATURES;
  useEffect(() => {
    if (!onCloudPage) return;
    let cancelled = false;
    fetch(`/api/projects/${project.id}/secrets`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load secrets");
        const payload = (await response.json()) as { secrets?: { name: string }[] };
        if (cancelled) return;
        setSecretNames((payload.secrets ?? []).map((secret) => secret.name));
        setSecretsError(false);
      })
      .catch(() => !cancelled && setSecretsError(true));
    return () => {
      cancelled = true;
    };
  }, [project.id, onCloudPage, section, cloudEnabled]);

  function renderFeatureSection(feature: CloudFeature) {
    const meta = CLOUD_FEATURES[feature];
    const Icon = FEATURE_ICONS[feature];
    if (!cloudEnabled) {
      return (
        <CloudGate
          icon={Icon}
          title={meta.title}
          description={meta.description}
          busy={cloudBusy}
          onEnable={() => onSetCloudEnabled(true)}
        />
      );
    }

    if (feature === "database") {
      return (
        <CloudDatabasePanel
          projectId={project.id}
          onAskAgent={onAskAgent}
          onSecretsChanged={() => void loadSecretNames()}
        />
      );
    }

    if (feature === "email") {
      return (
        <CloudEmailsPanel
          projectId={project.id}
          onAskAgent={onAskAgent}
          onSecretsChanged={() => void loadSecretNames()}
        />
      );
    }

    if (feature === "auth") {
      return (
        <CloudAuthPanel
          projectId={project.id}
          onAskAgent={onAskAgent}
          onOpenSection={(nextSection) => setSection(nextSection)}
          onSecretsChanged={() => void loadSecretNames()}
        />
      );
    }

    return (
      <StorageFeaturePage
        secretNames={secretNames}
        secretsError={secretsError}
        onRetrySecrets={() => void loadSecretNames()}
        onOpenSecrets={() => setSection("secrets")}
        onAskAgent={onAskAgent}
      />
    );
  }

  return (
    <div className="@container flex h-full min-h-0 bg-[#0a0a0a]">
      <div className="flex h-full min-h-0 w-full flex-col @[620px]:flex-row">
        <nav
          aria-label="Cloud sections"
          className="flex shrink-0 gap-4 overflow-x-auto border-b border-white/[0.06] px-2 py-2 @[620px]:w-48 @[620px]:flex-col @[620px]:gap-5 @[620px]:overflow-y-auto @[620px]:border-b-0 @[620px]:border-r @[620px]:py-4"
        >
          {NAV.map((group) => (
            <div key={group.heading} className="flex shrink-0 items-center gap-0.5 @[620px]:flex-col @[620px]:items-stretch">
              <p className="hidden px-2.5 pb-1 text-[11px] font-medium text-white/40 @[620px]:block">{group.heading}</p>
              {group.items.map((item) => {
                const active = section === item.id;
                const locked = item.cloud && !cloudEnabled;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11",
                      active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.id === "cloud" ? "Cognix Cloud" : item.label}</span>
                    {locked ? <Lock className="ml-auto size-3 text-white/30" aria-label="Locked until Cognix Cloud is on" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {section === "settings" ? (
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <ProjectSettings project={project} onProjectChange={props.onProjectChange} />
            </div>
          ) : section === "secrets" ? (
            <SecretsPanel projectId={project.id} />
          ) : (
            <div className="mx-auto w-full max-w-4xl px-6 py-6">
              {section === "publish" ? (
                <PublishSection
                  project={project}
                  slug={props.slug}
                  publishBaseLabel={props.publishBaseLabel}
                  publishDomainSuffix={props.publishDomainSuffix}
                  publishedAutoStopMinutes={props.publishedAutoStopMinutes}
                  publishedUrl={props.publishedUrl}
                  canPublish={props.canPublish}
                  isPublishing={props.isPublishing}
                  isBuilding={props.isBuilding}
                  hasUnpublishedChanges={props.hasUnpublishedChanges}
                  focusRequest={focusRequest}
                  onSlugChange={props.onSlugChange}
                  onPublish={props.onPublish}
                  onUnpublish={props.onUnpublish}
                />
              ) : section === "domains" ? (
                <section aria-label="Domains">
                  <div className="text-[12px] [&_.domain-panel]:border-0 [&_.domain-panel]:pt-0 [&_.domain-panel_header_p]:text-[13px] [&_.domain-panel_header_strong]:text-lg [&_.domain-panel_header_strong]:font-semibold">
                    <CustomDomainsPanel
                      projectId={project.id}
                      published={Boolean(project.publishedAt)}
                      disabled={props.isPublishing || project.status === "publishing"}
                      refreshKey={props.domainRefreshKey}
                    />
                  </div>
                </section>
              ) : section === "cloud" ? (
                <CloudOverview
                  enabled={cloudEnabled}
                  busy={cloudBusy}
                  secretNames={secretNames}
                  onSetEnabled={onSetCloudEnabled}
                  onOpen={setSection}
                />
              ) : (
                renderFeatureSection(section)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EnableButton({ busy, onClick, label = "Turn on Cognix Cloud" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-9 w-full max-w-64 items-center justify-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:opacity-60 [@media(pointer:coarse)]:h-11"
    >
      {busy ? <PixelLoader className="text-black" /> : null}
      {busy ? "Turning on…" : label}
    </button>
  );
}

/** The locked state shown on every Cognix Cloud page until the owner turns it on. */
function CloudGate({
  icon: Icon,
  title,
  description,
  busy,
  onEnable,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  busy: boolean;
  onEnable: () => void;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
      <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/80">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-white">{title}</h2>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-white/55">{description}</p>
      <div className="mt-5 flex w-full justify-center">
        <EnableButton busy={busy} onClick={onEnable} />
      </div>
      <p className="mt-3 max-w-sm text-[12px] leading-5 text-white/40">
        Turning on Cognix Cloud unlocks Managed Neon PostgreSQL, Storage, Resend Emails, and Better Auth for this app.
      </p>
    </div>
  );
}

function VariableList({
  names,
  secretNames,
  error,
  onRetry,
}: {
  names: string[];
  secretNames: string[] | null;
  error: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <p className="text-[12px] text-white/50">
        Could not check your secrets.{" "}
        <button type="button" onClick={onRetry} className="font-medium text-white/80 hover:text-white">
          Try again
        </button>
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.06]">
      {names.map((name) => {
        const set = secretNames?.includes(name);
        return (
          <li key={name} className="flex items-center justify-between gap-3 py-2">
            <code className="font-mono text-[12.5px] text-white/80">{name}</code>
            {secretNames === null ? (
              <PixelLoader className="text-white/40" />
            ) : set ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-emerald-300">
                <Check className="size-3.5" aria-hidden="true" /> Set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-amber-300">
                <TriangleAlert className="size-3.5" aria-hidden="true" /> Missing
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CloudOverview({
  enabled,
  busy,
  secretNames,
  onSetEnabled,
  onOpen,
}: {
  enabled: boolean;
  busy: boolean;
  secretNames: string[] | null;
  onSetEnabled: (enabled: boolean) => void;
  onOpen: (section: CloudSection) => void;
}) {
  if (!enabled) {
    return (
      <CloudGate
        icon={Cloud}
        title="Turn on Cognix Cloud"
        description="Provision managed Neon PostgreSQL, Better Auth on Postgres, Resend email management, and file storage."
        busy={busy}
        onEnable={() => onSetEnabled(true)}
      />
    );
  }

  function statusSummary(feature: CloudFeature) {
    if (secretNames === null) return "Checking variables…";
    const meta = CLOUD_FEATURES[feature];
    const missing = meta.env.filter((name) => !secretNames.includes(name)).length;
    if (feature === "database") return missing === 0 ? "Managed Neon · Ready" : "Click to provision Neon";
    if (feature === "email") return secretNames.includes("RESEND_API_KEY") ? "Resend connected" : "Connect Resend API key";
    if (feature === "auth") return missing === 0 ? "Better Auth · Ready" : "Needs database setup";
    return missing === 0 ? "Ready" : `${missing} ${missing === 1 ? "variable" : "variables"} missing`;
  }

  return (
    <section aria-labelledby="cloud-overview-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-overview-heading" className="text-lg font-semibold tracking-tight text-white">
            Cognix Cloud
          </h2>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-white/55">
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" /> On · Managed Neon PostgreSQL, Resend, and Better Auth unlocked.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Turn off Cognix Cloud? Existing code, database, and secrets stay intact, and Cognix will ask again before adding new Cloud services.",
              )
            ) {
              onSetEnabled(false);
            }
          }}
          className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[12.5px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9f94ff] disabled:opacity-40 [@media(pointer:coarse)]:h-11"
        >
          {busy ? "Saving…" : "Turn off"}
        </button>
      </div>
      <ul className="mt-5 grid gap-2 @[520px]:grid-cols-2">
        {CLOUD_FEATURE_ORDER.map((feature) => {
          const meta = CLOUD_FEATURES[feature];
          const Icon = FEATURE_ICONS[feature];
          return (
            <li key={feature}>
              <button
                type="button"
                onClick={() => onOpen(feature)}
                className="flex w-full items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-left hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[#9f94ff]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/75">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-white">{meta.label}</span>
                  <span className="block text-[12px] tabular-nums text-white/45">{statusSummary(feature)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StorageFeaturePage({
  secretNames,
  secretsError,
  onRetrySecrets,
  onOpenSecrets,
  onAskAgent,
}: {
  secretNames: string[] | null;
  secretsError: boolean;
  onRetrySecrets: () => void;
  onOpenSecrets: () => void;
  onAskAgent: (prompt: string) => void;
}) {
  const meta = CLOUD_FEATURES.storage;
  const missing = secretNames ? meta.env.filter((name) => !secretNames.includes(name)) : [];
  return (
    <section aria-labelledby="cloud-storage-heading">
      <h2 id="cloud-storage-heading" className="text-lg font-semibold tracking-tight text-white">
        {meta.label}
      </h2>
      <p className="mt-1 text-[13px] text-white/55">{meta.description}</p>

      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium text-white">Connection</h3>
          <button
            type="button"
            onClick={onOpenSecrets}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11"
          >
            <KeyRound className="size-3.5" aria-hidden="true" /> Open Secrets
          </button>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-white/45">
          Your app reads these server-side variables.{" "}
          {missing.length ? "Add the missing ones in Secrets." : secretNames ? "Everything needed is set." : ""}
        </p>
        <div className="mt-2">
          <VariableList names={meta.env} secretNames={secretNames} error={secretsError} onRetry={onRetrySecrets} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <h3 className="text-[13px] font-medium text-white">Ask Cognix to build it</h3>
        <p className="mt-1 text-[12px] text-white/45">
          Pick a starting point. It goes into the chat box so you can edit it before sending.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {meta.examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onAskAgent(example)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-left text-[12.5px] text-white/75 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:min-h-11"
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" /> {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
