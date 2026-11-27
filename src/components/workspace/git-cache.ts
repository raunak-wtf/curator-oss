"use client";

import { useSyncExternalStore } from "react";
import type { GitSyncStatus, ProjectRepositoryView, RepositoryCache, RepositoryCommit } from "@/lib/types";

/**
 * Git details last fetched for each project, kept in memory and in localStorage.
 * Git Control renders these instantly, then only asks GitHub again when they are out of date.
 * The server keeps the same data in project_repositories, so other browsers start from it too.
 */

/** How long a GitHub sync check or commit list stays current before Cognix fetches it again. */
export const GIT_CACHE_TTL_MS = 5 * 60_000;

export type GitHubStatus = {
  configured: boolean;
  connection: { login: string; avatarUrl: string | null; connectedAt: string } | null;
  repository: ProjectRepositoryView | null;
  commitIdentity?: "bot" | "user";
  botName?: string | null;
  cache?: RepositoryCache | null;
};

export type GitCacheEntry = {
  status?: GitHubStatus;
  sync?: GitSyncStatus | null;
  commits?: RepositoryCommit[] | null;
  /** Server time the commits were fetched; null once a push or pull made them out of date. */
  commitsFetchedAt?: string | null;
};

const STORAGE_PREFIX = "cognix:git:";
const entries = new Map<string, GitCacheEntry>();
const listeners = new Set<() => void>();

function load(projectId: string): GitCacheEntry | undefined {
  if (entries.has(projectId)) return entries.get(projectId);
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    const parsed = raw ? (JSON.parse(raw) as GitCacheEntry) : undefined;
    entries.set(projectId, parsed ?? {});
    return entries.get(projectId);
  } catch {
    entries.set(projectId, {});
    return entries.get(projectId);
  }
}

export function readGitCache(projectId: string): GitCacheEntry | undefined {
  return load(projectId);
}

export function writeGitCache(projectId: string, patch: GitCacheEntry) {
  const next = { ...load(projectId), ...patch };
  entries.set(projectId, next);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the in-memory copy still works for this session.
  }
  for (const listener of listeners) listener();
}

export function clearGitCache(projectId: string) {
  entries.set(projectId, {});
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + projectId);
  } catch {
    // Ignore blocked storage.
  }
  for (const listener of listeners) listener();
}

/** Takes whatever the server saved that is newer than the local copy. */
export function mergeServerCache(projectId: string, server: RepositoryCache | null | undefined) {
  if (!server) return;
  const local = load(projectId) ?? {};
  const patch: GitCacheEntry = {};
  if (server.sync && (!local.sync || server.sync.checkedAt > local.sync.checkedAt)) patch.sync = server.sync;
  if (server.commitsFetchedAt === null) {
    // A push or pull happened since the commits were fetched. Keep showing them, but fetch again.
    if (local.commitsFetchedAt !== null) patch.commitsFetchedAt = null;
    if (!local.commits && server.commits) patch.commits = server.commits;
  } else if (server.commits && (!local.commitsFetchedAt || server.commitsFetchedAt > local.commitsFetchedAt)) {
    patch.commits = server.commits;
    patch.commitsFetchedAt = server.commitsFetchedAt;
  }
  if (Object.keys(patch).length) writeGitCache(projectId, patch);
}

export function isFresh(iso: string | null | undefined) {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && Date.now() - time < GIT_CACHE_TTL_MS;
}

const inFlight = new Map<string, Promise<Response>>();

/** Shares one request between callers that ask for the same URL at the same time (remounts, Strict Mode). */
export function fetchShared(url: string): Promise<Response> {
  const running = inFlight.get(url);
  if (running) return running.then((response) => response.clone());
  const request = fetch(url, { cache: "no-store" }).finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request.then((response) => response.clone());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGitCache(projectId: string): GitCacheEntry | undefined {
  return useSyncExternalStore(
    subscribe,
    () => load(projectId),
    () => undefined,
  );
}
