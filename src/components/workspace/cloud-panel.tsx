"use client";

import {
  BarChart3,
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
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CustomDomainsPanel } from "@/components/custom-domains-panel";
import { PixelLoader } from "@/components/pixel-loader";
import { SecretsPanel } from "@/components/secrets-panel";
import { CLOUD_FEATURE_ORDER, CLOUD_FEATURES, type CloudFeature } from "@/lib/cloud-features";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CloudAnalyticsPanel } from "./cloud-analytics-panel";
import { CloudAuthPanel } from "./cloud-auth-panel";
import { CloudDatabasePanel } from "./cloud-database-panel";
import { CloudEmailsPanel } from "./cloud-emails-panel";
import { CloudStoragePanel } from "./cloud-storage-panel";
import { ProjectSettings } from "./project-settings";
import { PublishSection } from "./publish-section";

export type CloudSection = "settings" | "publish" | "domains" | "analytics" | "secrets" | "cloud" | CloudFeature;

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
      { id: "analytics", label: "Analytics", icon: BarChart3 },
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
  onSetCloudEnabled: (enabled: boolean, feature?: CloudFeature) => void;
  /** Puts a prompt into the chat composer so the agent can build the feature. */
  onAskAgent: (prompt: string) => void;
  onProjectChange: (project: Project) => void;
};

export function CloudPanel(props: CloudPanelProps) {
  const { project, cloudEnabled, cloudBusy, isBuilding, focusRequest, onSetCloudEnabled, onAskAgent } = props;
  const [section, setSection] = useState<CloudSection>("publish");
  const [handledFocus, setHandledFocus] = useState(focusRequest);
  const [secretNames, setSecretNames] = useState<string[] | null>(null);

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
    } catch {
      // Keep last known secret list on transient error.
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
      })
      .catch(() => undefined);
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
          isBuilding={isBuilding}
          onEnable={() => onSetCloudEnabled(true, feature)}
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
      <CloudStoragePanel
        projectId={project.id}
        onAskAgent={onAskAgent}
        onSecretsChanged={() => void loadSecretNames()}
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
                  isBuilding={isBuilding}
                  hasUnpublishedChanges={props.hasUnpublishedChanges}
                  focusRequest={focusRequest}
                  onSlugChange={props.onSlugChange}
                  onPublish={props.onPublish}
                  onUnpublish={props.onUnpublish}
                  onAskAgent={onAskAgent}
                />
              ) : section === "analytics" ? (
                <CloudAnalyticsPanel
                  projectId={project.id}
                  publishedUrl={props.publishedUrl}
                  isPublished={Boolean(project.publishedAt)}
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
                  isBuilding={isBuilding}
                  secretNames={secretNames}
                  onSetEnabled={(next) => onSetCloudEnabled(next)}
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

function EnableButton({
  busy,
  isBuilding = false,
  onClick,
  label = "Turn on Cognix Cloud",
}: {
  busy: boolean;
  isBuilding?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || isBuilding}
      title={isBuilding ? "Wait for the current build to finish before turning on Cognix Cloud" : undefined}
      className="inline-flex h-9 w-full max-w-64 items-center justify-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:opacity-60 [@media(pointer:coarse)]:h-11"
    >
      {busy ? <PixelLoader className="text-black" /> : null}
      {busy ? "Turning on…" : isBuilding ? "Wait for current build…" : label}
    </button>
  );
}

/** The locked state shown on every Cognix Cloud page until the owner turns it on. */
function CloudGate({
  icon: Icon,
  title,
  description,
  busy,
  isBuilding = false,
  onEnable,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  busy: boolean;
  isBuilding?: boolean;
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
        <EnableButton busy={busy} isBuilding={isBuilding} onClick={onEnable} />
      </div>
      <p className="mt-3 max-w-sm text-[12px] leading-5 text-white/40">
        Turning on Cognix Cloud provisions Managed Neon PostgreSQL and Bucketline Storage, unlocks Better Auth and Resend Emails, and asks Cognix to wire them into your app.
      </p>
    </div>
  );
}

function CloudOverview({
  enabled,
  busy,
  isBuilding,
  secretNames,
  onSetEnabled,
  onOpen,
}: {
  enabled: boolean;
  busy: boolean;
  isBuilding: boolean;
  secretNames: string[] | null;
  onSetEnabled: (enabled: boolean) => void;
  onOpen: (section: CloudSection) => void;
}) {
  if (!enabled) {
    return (
      <CloudGate
        icon={Cloud}
        title="Turn on Cognix Cloud"
        description="Provision managed Neon PostgreSQL, Bucketline S3 storage & CDN, Better Auth on Postgres, and Resend email management."
        busy={busy}
        isBuilding={isBuilding}
        onEnable={() => onSetEnabled(true)}
      />
    );
  }

  function statusSummary(feature: CloudFeature) {
    if (secretNames === null) return "Checking variables…";
    const meta = CLOUD_FEATURES[feature];
    const missing = meta.env.filter((name) => !secretNames.includes(name)).length;
    if (feature === "database") return missing === 0 ? "Managed Neon · Ready" : "Click to provision Neon";
    if (feature === "storage") return missing === 0 ? "Managed Bucketline · Ready" : "Click to provision bucket";
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
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" /> On · Managed Neon PostgreSQL, Bucketline Storage, Resend, and Better Auth unlocked.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || isBuilding}
          onClick={() => {
            if (
              window.confirm(
                "Turn off Cognix Cloud? Existing code, database, buckets, and secrets stay intact, and Cognix will ask again before adding new Cloud services.",
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
