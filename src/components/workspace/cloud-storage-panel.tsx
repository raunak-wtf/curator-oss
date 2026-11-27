"use client";

import {
  Check,
  Copy,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderPlus,
  Globe2,
  HardDrive,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { CLOUD_FEATURES } from "@/lib/cloud-features";
import type { BucketAccessMode, BucketlineBucket, StorageObjectItem } from "@/lib/cloud/bucketline";
import { cn, formatRelativeDate } from "@/lib/utils";

type StorageOverviewPayload = {
  configured: boolean;
  s3Endpoint: string | null;
  activeBucket: string | null;
  selectedBucket?: string | null;
  buckets: BucketlineBucket[];
  prefix: string;
  folders: string[];
  objects: StorageObjectItem[];
  truncated?: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${idx === 0 ? value : value.toFixed(1)} ${units[idx]}`;
}

export function CloudStoragePanel({
  projectId,
  onAskAgent,
  onSecretsChanged,
}: {
  projectId: string;
  onAskAgent: (prompt: string) => void;
  onSecretsChanged: () => void;
}) {
  const [data, setData] = useState<StorageOverviewPayload | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>("");
  const [prefix, setPrefix] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newBucketSuffix, setNewBucketSuffix] = useState("");
  const [newBucketMode, setNewBucketMode] = useState<BucketAccessMode>("private");
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStorage = useCallback(
    async (targetBucket = selectedBucket, targetPrefix = prefix) => {
      const params = new URLSearchParams();
      if (targetBucket) params.set("bucket", targetBucket);
      if (targetPrefix) params.set("prefix", targetPrefix);
      const qs = params.toString();
      const response = await fetch(`/api/projects/${projectId}/cloud/storage${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load Cognix Cloud Storage.");
      }
      return payload as StorageOverviewPayload;
    },
    [prefix, projectId, selectedBucket],
  );

  useEffect(() => {
    let active = true;
    fetchStorage(selectedBucket, prefix)
      .then((payload) => {
        if (!active) return;
        setData(payload);
        if (payload.selectedBucket && payload.selectedBucket !== selectedBucket) {
          setSelectedBucket(payload.selectedBucket);
        }
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load Cognix Cloud Storage.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchStorage, prefix, selectedBucket]);

  async function refresh(nextBucket = selectedBucket, nextPrefix = prefix) {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchStorage(nextBucket, nextPrefix);
      setData(payload);
      if (payload.selectedBucket) setSelectedBucket(payload.selectedBucket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Cognix Cloud Storage.");
    } finally {
      setLoading(false);
    }
  }

  async function runAction(actionKey: string, body: Record<string, unknown>, successToast?: string) {
    if (busyAction) return null;
    setBusyAction(actionKey);
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/storage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Storage action failed.");
      if (successToast) toast.success(successToast);
      onSecretsChanged();
      return payload;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Storage action failed.");
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || !currentBucket) return;
    setBusyAction("upload");
    try {
      let uploadedCount = 0;
      for (const file of list) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} exceeds the 50 MB object limit.`);
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        form.append("bucket", currentBucket.name);
        form.append("prefix", prefix);
        const response = await fetch(`/api/projects/${projectId}/cloud/storage`, {
          method: "POST",
          body: form,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `Could not upload ${file.name}.`);
        uploadedCount += 1;
      }
      if (uploadedCount > 0) {
        toast.success(`Uploaded ${uploadedCount} ${uploadedCount === 1 ? "file" : "files"}.`);
        await refresh(currentBucket.name, prefix);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyShareOrCdnLink(obj: StorageObjectItem) {
    if (!currentBucket) return;
    if (currentBucket.accessMode === "public" && obj.cdnUrl) {
      await navigator.clipboard.writeText(obj.cdnUrl);
      toast.success("Public CDN URL copied.");
      return;
    }
    const result = await runAction(`share:${obj.key}`, {
      action: "presign_url",
      bucket: currentBucket.name,
      key: obj.key,
      method: "GET",
      expiresInSeconds: 86_400,
    });
    if (result && typeof result.url === "string") {
      await navigator.clipboard.writeText(result.url);
      toast.success("24-hour signed download URL copied.");
    }
  }

  async function openObjectInNewTab(obj: StorageObjectItem) {
    if (!currentBucket) return;
    if (currentBucket.accessMode === "public" && obj.cdnUrl) {
      window.open(obj.cdnUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const result = await runAction(`open:${obj.key}`, {
      action: "presign_url",
      bucket: currentBucket.name,
      key: obj.key,
      method: "GET",
      expiresInSeconds: 3600,
    });
    if (result && typeof result.url === "string") {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  }

  const buckets = data?.buckets ?? [];
  const currentBucket = buckets.find((b) => b.name === selectedBucket) ?? buckets[0] ?? null;
  const activeBucketName = data?.activeBucket ?? null;
  const pathSegments = prefix.split("/").filter(Boolean);

  return (
    <section aria-labelledby="cloud-storage-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-storage-heading" className="text-lg font-semibold tracking-tight text-white">
            Storage
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Managed S3-compatible buckets with scoped credentials, 24h signed links, and CDN delivery.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(selectedBucket, prefix)}
          disabled={loading || Boolean(busyAction)}
          aria-label="Refresh storage buckets"
          title="Refresh storage buckets"
          className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/65 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-40 [@media(pointer:coarse)]:size-11"
        >
          {loading ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-400/25 bg-red-500/10 p-4">
          <p className="text-[13px] font-medium text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void refresh(selectedBucket, prefix)}
            className="mt-2.5 inline-flex h-8 items-center rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11"
          >
            Try again
          </button>
        </div>
      ) : null}

      {data && !data.configured ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-4 text-[12.5px] leading-5 text-amber-200/90">
          Add <code className="font-mono">BUCKETLINE_API_KEY</code> to the Cognix server environment to enable automatic managed bucket provisioning and the visual file explorer.
        </div>
      ) : null}

      {data?.configured && buckets.length === 0 && !loading ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center">
          <HardDrive className="mx-auto size-6 text-white/40" aria-hidden="true" />
          <h3 className="mt-3 text-[14px] font-semibold text-white">Provision your first storage bucket</h3>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-5 text-white/50">
            Creates an isolated S3-compatible bucket, mints bucket-scoped credentials, and syncs{" "}
            <code className="font-mono text-white/75">S3_*</code> variables into your app automatically.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={async () => {
                const res = await runAction("provision-private", { action: "provision", accessMode: "private" }, "Private storage bucket provisioned.");
                if (res?.bucket?.name) {
                  setSelectedBucket(res.bucket.name);
                  await refresh(res.bucket.name, "");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85 disabled:opacity-50 [@media(pointer:coarse)]:h-11"
            >
              {busyAction === "provision-private" ? <PixelLoader className="text-black" /> : <Lock className="size-3.5" aria-hidden="true" />}
              Provision private bucket
            </button>
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={async () => {
                const res = await runAction("provision-public", { action: "provision", accessMode: "public" }, "Public CDN bucket provisioned.");
                if (res?.bucket?.name) {
                  setSelectedBucket(res.bucket.name);
                  await refresh(res.bucket.name, "");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-4 text-[13px] font-medium text-white/85 hover:bg-white/[0.06] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11"
            >
              {busyAction === "provision-public" ? <PixelLoader /> : <Globe2 className="size-3.5" aria-hidden="true" />}
              Provision public CDN bucket
            </button>
          </div>
        </div>
      ) : null}

      {buckets.length > 0 ? (
        <>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[12px] font-medium text-white/65">
                  Bucket
                  <select
                    value={currentBucket?.name ?? ""}
                    onChange={(e) => {
                      setSelectedBucket(e.target.value);
                      setPrefix("");
                    }}
                    className="ml-2 h-8 rounded-lg border border-white/[0.12] bg-[#101010] px-2.5 font-mono text-[12px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
                  >
                    {buckets.map((bucket) => (
                      <option key={bucket.name} value={bucket.name}>
                        {bucket.name} ({bucket.accessMode})
                      </option>
                    ))}
                  </select>
                </label>

                {currentBucket ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      currentBucket.accessMode === "public"
                        ? "bg-sky-400/15 text-sky-200"
                        : "bg-white/[0.08] text-white/75",
                    )}
                  >
                    {currentBucket.accessMode === "public" ? (
                      <Globe2 className="size-3" aria-hidden="true" />
                    ) : (
                      <Lock className="size-3" aria-hidden="true" />
                    )}
                    {currentBucket.accessMode === "public" ? "Public CDN" : "Private · 24h signed"}
                  </span>
                ) : null}

                {currentBucket && activeBucketName === currentBucket.name ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    <Check className="size-3" aria-hidden="true" /> Active in S3_BUCKET
                  </span>
                ) : currentBucket ? (
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={async () => {
                      const ok = await runAction("use", { action: "use_bucket", bucket: currentBucket.name }, `Set ${currentBucket.name} as active S3_BUCKET.`);
                      if (ok) await refresh(currentBucket.name, prefix);
                    }}
                    className="inline-flex h-7 items-center rounded-md border border-white/15 px-2.5 text-[11.5px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-10"
                  >
                    Set as active S3_BUCKET
                  </button>
                ) : null}
              </div>

              {currentBucket ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={async () => {
                      if (!window.confirm(`Mint fresh S3 credentials for ${currentBucket.name} and update project secrets?`)) return;
                      await runAction("rotate", { action: "rotate_credentials", bucket: currentBucket.name }, "Minted fresh S3 credentials.");
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                  >
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    Rotate S3 keys
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={async () => {
                      const confirmed = window.confirm(
                        `Delete bucket "${currentBucket.name}" and all files inside it? Its S3 credentials and share links will be revoked immediately.`,
                      );
                      if (!confirmed) return;
                      const deleted = await runAction(
                        "delete-bucket",
                        { action: "delete_bucket", bucket: currentBucket.name, force: true },
                        `Deleted ${currentBucket.name}.`,
                      );
                      if (deleted) {
                        setSelectedBucket("");
                        setPrefix("");
                        await refresh("", "");
                      }
                    }}
                    aria-label={`Delete bucket ${currentBucket.name}`}
                    title="Delete bucket"
                    className="grid size-8 place-items-center rounded-lg border border-white/10 text-red-300/80 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40 [@media(pointer:coarse)]:size-11"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>

            {currentBucket ? (
              <div className="grid gap-2 text-[11.5px] sm:grid-cols-2">
                <div className="rounded-md border border-white/[0.06] bg-[#101010] px-2.5 py-2">
                  <span className="text-white/40">S3 Gateway (path-style)</span>
                  <p className="mt-0.5 truncate font-mono text-white/75">{currentBucket.s3Endpoint}</p>
                </div>
                <div className="rounded-md border border-white/[0.06] bg-[#101010] px-2.5 py-2">
                  <span className="text-white/40">CDN Endpoint</span>
                  <p className="mt-0.5 truncate font-mono text-white/75">{currentBucket.cdnEndpoint}/</p>
                </div>
              </div>
            ) : null}

            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newBucketSuffix.trim() || busyAction) return;
                const created = await runAction(
                  "create-bucket",
                  {
                    action: "create_bucket",
                    suffix: newBucketSuffix.trim(),
                    accessMode: newBucketMode,
                    makeActive: true,
                  },
                  "Storage bucket created and synced to S3_* secrets.",
                );
                if (created?.bucket?.name) {
                  setNewBucketSuffix("");
                  setSelectedBucket(created.bucket.name);
                  setPrefix("");
                  await refresh(created.bucket.name, "");
                }
              }}
              className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3"
            >
              <input
                type="text"
                value={newBucketSuffix}
                onChange={(e) => setNewBucketSuffix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="New bucket suffix (e.g. avatars, public-media)"
                maxLength={40}
                aria-label="New bucket name suffix"
                className="h-8 min-w-44 flex-1 rounded-lg border border-white/[0.12] bg-[#101010] px-2.5 font-mono text-[12px] text-white outline-none placeholder:font-sans placeholder:text-white/35 focus:border-white/35 [@media(pointer:coarse)]:h-11"
              />
              <select
                value={newBucketMode}
                onChange={(e) => setNewBucketMode(e.target.value as BucketAccessMode)}
                aria-label="New bucket access mode"
                className="h-8 rounded-lg border border-white/[0.12] bg-[#101010] px-2.5 text-[12px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
              >
                <option value="private">Private</option>
                <option value="public">Public CDN</option>
              </select>
              <button
                type="submit"
                disabled={!newBucketSuffix.trim() || Boolean(busyAction)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 disabled:opacity-40 [@media(pointer:coarse)]:h-11"
              >
                {busyAction === "create-bucket" ? <PixelLoader className="text-black" /> : <Plus className="size-3.5" aria-hidden="true" />}
                Add bucket
              </button>
            </form>
          </div>

          {currentBucket ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
              }}
              className={cn(
                "rounded-lg border bg-white/[0.02] p-4 transition-colors",
                isDragging ? "border-white/40 bg-white/[0.05]" : "border-white/10",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <nav aria-label="Bucket folder path" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[12px]">
                  <button
                    type="button"
                    onClick={() => setPrefix("")}
                    className={cn("rounded px-1.5 py-0.5 hover:bg-white/[0.07]", !prefix ? "font-semibold text-white" : "text-white/60")}
                  >
                    {currentBucket.name}
                  </button>
                  {pathSegments.map((seg, idx) => {
                    const targetPrefix = `${pathSegments.slice(0, idx + 1).join("/")}/`;
                    const isLast = idx === pathSegments.length - 1;
                    return (
                      <span key={targetPrefix} className="flex items-center gap-1">
                        <span className="text-white/30">/</span>
                        <button
                          type="button"
                          onClick={() => setPrefix(targetPrefix)}
                          className={cn("rounded px-1.5 py-0.5 hover:bg-white/[0.07]", isLast ? "font-semibold text-white" : "text-white/60")}
                        >
                          {seg}
                        </button>
                      </span>
                    );
                  })}
                </nav>

                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files?.length) void uploadFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowFolderInput((v) => !v)}
                    disabled={Boolean(busyAction)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11"
                  >
                    <FolderPlus className="size-3.5" aria-hidden="true" />
                    Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={Boolean(busyAction)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                  >
                    {busyAction === "upload" ? <PixelLoader className="text-black" /> : <Upload className="size-3.5" aria-hidden="true" />}
                    {busyAction === "upload" ? "Uploading…" : "Upload"}
                  </button>
                </div>
              </div>

              {showFolderInput ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const trimmed = newFolderName.trim().replace(/^\/+|\/+$/g, "");
                    if (!trimmed) return;
                    const folderPath = prefix ? `${prefix}${trimmed}` : trimmed;
                    const ok = await runAction(
                      "create-folder",
                      { action: "create_folder", bucket: currentBucket.name, folderPath },
                      `Created folder ${trimmed}/`,
                    );
                    if (ok) {
                      setNewFolderName("");
                      setShowFolderInput(false);
                      await refresh(currentBucket.name, prefix);
                    }
                  }}
                  className="mt-3 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name (e.g. avatars)"
                    aria-label="New folder name"
                    className="h-8 flex-1 rounded-lg border border-white/[0.12] bg-[#101010] px-2.5 text-[12px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
                  />
                  <button
                    type="submit"
                    disabled={!newFolderName.trim() || Boolean(busyAction)}
                    className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                  >
                    Create
                  </button>
                </form>
              ) : null}

              <div className="mt-3">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-white/50">
                    <PixelLoader /> <span>Listing objects…</span>
                  </div>
                ) : (data?.folders.length ?? 0) === 0 && (data?.objects.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 py-10 text-center">
                    <Upload className="mx-auto size-5 text-white/30" aria-hidden="true" />
                    <p className="mt-2 text-[13px] font-medium text-white/75">No files in this path yet</p>
                    <p className="mt-1 text-[12px] text-white/45">
                      Drop files here or select Upload (up to 50 MB per object).
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/[0.06]">
                    {(data?.folders ?? []).map((folderPrefix) => {
                      const folderLabel = prefix && folderPrefix.startsWith(prefix)
                        ? folderPrefix.slice(prefix.length)
                        : folderPrefix;
                      return (
                        <li key={folderPrefix} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                          <button
                            type="button"
                            onClick={() => setPrefix(folderPrefix)}
                            className="flex min-w-0 items-center gap-2 font-mono text-white/85 hover:text-white"
                          >
                            <Folder className="size-4 shrink-0 text-amber-300/80" aria-hidden="true" />
                            <span className="truncate">{folderLabel}</span>
                          </button>
                          <span className="text-[11px] text-white/35">Folder</span>
                        </li>
                      );
                    })}

                    {(data?.objects ?? []).map((obj) => (
                      <li key={obj.key} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileIcon className="size-4 shrink-0 text-white/45" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[12px] text-white/85" title={obj.key}>
                              {obj.name}
                            </p>
                            <p className="text-[11px] tabular-nums text-white/40">
                              {formatBytes(obj.size)}
                              {obj.lastModified ? ` · ${formatRelativeDate(obj.lastModified)}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void copyShareOrCdnLink(obj)}
                            disabled={Boolean(busyAction)}
                            aria-label={currentBucket.accessMode === "public" ? `Copy CDN URL for ${obj.name}` : `Copy 24h signed link for ${obj.name}`}
                            title={currentBucket.accessMode === "public" ? "Copy public CDN URL" : "Copy 24-hour signed link"}
                            className="grid size-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openObjectInNewTab(obj)}
                            disabled={Boolean(busyAction)}
                            aria-label={`Open ${obj.name}`}
                            title="Open file"
                            className="grid size-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
                          >
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Delete "${obj.key}" from ${currentBucket.name}?`)) return;
                              const ok = await runAction(
                                `del:${obj.key}`,
                                { action: "delete_object", bucket: currentBucket.name, key: obj.key },
                                `Deleted ${obj.name}.`,
                              );
                              if (ok) await refresh(currentBucket.name, prefix);
                            }}
                            disabled={Boolean(busyAction)}
                            aria-label={`Delete ${obj.name}`}
                            title="Delete file"
                            className="grid size-8 place-items-center rounded-md text-red-300/70 hover:bg-red-500/10 hover:text-red-200 [@media(pointer:coarse)]:size-11"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <h3 className="text-[13px] font-medium text-white">Ask Cognix to integrate Storage</h3>
        <p className="mt-1 text-[12px] text-white/45">
          Pick a workflow to insert into the chat composer.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CLOUD_FEATURES.storage.examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onAskAgent(example)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 text-[12px] text-white/75 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11"
            >
              <Sparkles className="size-3 text-white/45" aria-hidden="true" />
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
