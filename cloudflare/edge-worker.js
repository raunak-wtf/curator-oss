/**
 * Cognix edge worker (Cloudflare Workers): Daytona custom preview & custom-domain proxy.
 * https://www.daytona.io/docs/en/custom-preview-proxy/
 *
 * Enforces full parity with `Infra/proxy/edge-proxy.mjs`:
 *   - `<adj>-<noun>-<hex8>.<COGNIX_APPS_DOMAIN>` -> Daytona port 3000 (access-controlled live dev preview + HMR WebSockets)
 *   - `<slug>.<COGNIX_APPS_DOMAIN>`              -> Daytona port 3001 (published production build)
 *   - `<customer-custom-domain>`                 -> Daytona port 3001 (published production build)
 *   - `/.well-known/cognix-domain-check`         -> Cognix builder app (ownership + TLS serving probe)
 *
 * Environment:
 *   COGNIX_ORIGIN       e.g. https://curator.codes   (plain variable)
 *   COGNIX_APPS_DOMAIN  e.g. curatorsite.in          (optional wildcard preview/published domain)
 *   COGNIX_EDGE_SECRET  same value as the Cognix server (secret: `wrangler secret put COGNIX_EDGE_SECRET`)
 */

const RESOLVE_PATH = "/api/edge/resolve";
const PROBE_PATH = "/.well-known/cognix-domain-check";
const PREVIEW_AUTH_CALLBACK_PATH = "/__cognix_preview_auth";
const PREVIEW_GRANT_COOKIE = "__cognix_preview_grant";
const MAX_CACHED_HOSTS = 1000;
const RESTARTING_RETRY_SECONDS = 5;
const INTERNAL_HEADERS = ["x-cognix-edge-host", "x-cognix-edge-secret", "x-cognix-domain-host", "x-cognix-domain-path"];
const DAYTONA_HEADER_PREFIX = "x-daytona-";

/** Per-isolate cache: hostname -> { expires, value }. */
const targets = new Map();
/** Hostnames whose upstream just failed; their next resolve asks Cognix to skip its own cache. */
const staleHosts = new Set();
/** In-flight resolves, so a burst of visitors to one domain costs one call to Cognix. */
const lookups = new Map();

function remember(hostname, value, seconds) {
  if (targets.size >= MAX_CACHED_HOSTS) targets.delete(targets.keys().next().value);
  targets.set(hostname, { value, expires: Date.now() + seconds * 1000 });
}

function markStale(hostname) {
  targets.delete(hostname);
  if (staleHosts.size >= MAX_CACHED_HOSTS) staleHosts.delete(staleHosts.values().next().value);
  staleHosts.add(hostname);
}

function safeTargetPath(rawPathAndSearch) {
  const raw = typeof rawPathAndSearch === "string" && rawPathAndSearch.startsWith("/") ? rawPathAndSearch : "/";
  if (raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const parsed = new URL(raw, "https://cognix.invalid");
    return parsed.origin === "https://cognix.invalid" ? `${parsed.pathname}${parsed.search}` : "/";
  } catch {
    return "/";
  }
}

function parseCookieHeader(rawCookie) {
  const out = {};
  if (!rawCookie) return out;
  for (const part of String(rawCookie).split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (name) out[name] = val;
  }
  return out;
}

function stripPreviewGrantCookie(rawCookie) {
  if (!rawCookie) return null;
  const kept = String(rawCookie)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${PREVIEW_GRANT_COOKIE}=`));
  return kept.length ? kept.join("; ") : null;
}

function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyPreviewGrantToken(token, expectedHost, secret) {
  if (!token || typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "cg1") return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = base64UrlToBytes(sig);
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`cg1.${body}`));
    if (!ok) return null;
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
    if (!decoded || typeof decoded.pid !== "string" || typeof decoded.host !== "string") return null;
    if (typeof decoded.exp !== "number" || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    if (expectedHost && decoded.host.toLowerCase() !== expectedHost.toLowerCase()) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function isPreviewRequestAuthorized(request, hostname, previewAccess, secret) {
  if (!previewAccess) return true;
  const nowMs = Date.now();
  const publicStillValid =
    Boolean(previewAccess.publicActive) &&
    (!previewAccess.publicExpiresAt || Date.parse(previewAccess.publicExpiresAt) > nowMs);

  if (publicStillValid && !previewAccess.hasPasscode) {
    return true;
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const grant = await verifyPreviewGrantToken(cookies[PREVIEW_GRANT_COOKIE], hostname, secret);
  if (!grant) return false;
  if (previewAccess.projectId && grant.pid !== previewAccess.projectId) return false;

  if (grant.role === "owner") return true;
  if (grant.role === "passcode") {
    return publicStillValid && grant.ver === previewAccess.accessVersion;
  }
  if (grant.role === "invited") {
    return previewAccess.mode !== "owner" && grant.ver === previewAccess.accessVersion;
  }
  return false;
}

function isBrowserNavigationRequest(request, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (/^(?:\/api\/|\/_next\/|\/favicon\.ico$|\/robots\.txt$|\/sitemap\.xml$)/i.test(pathname)) return false;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html") || accept.includes("*/*") || !accept;
}

function buildCuratorPreviewAuthUrl(origin, hostname, nextPath, options = {}) {
  const target = new URL("/preview-auth", origin);
  target.searchParams.set("host", hostname);
  if (options.key) target.searchParams.set("key", options.key);
  if (options.mode) target.searchParams.set("mode", options.mode);
  if (nextPath && nextPath !== "/") target.searchParams.set("next", nextPath);
  return target.toString();
}

async function fetchTarget(hostname, env) {
  const url = new URL(RESOLVE_PATH, env.COGNIX_ORIGIN);
  url.searchParams.set("host", hostname);
  if (staleHosts.delete(hostname)) url.searchParams.set("fresh", "1");
  const response = await fetch(url, {
    headers: { "x-cognix-edge-secret": env.COGNIX_EDGE_SECRET, accept: "application/json" },
    redirect: "manual",
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 200 && payload.upstream && payload.headers) {
    const value = {
      kind: "proxy",
      projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      upstream: payload.upstream,
      headers: payload.headers,
      badge: payload.badge ?? null,
      isPreview: payload.kind === "preview",
      previewAccess: payload.previewAccess ?? null,
    };
    remember(hostname, value, Number(payload.cacheSeconds) || 60);
    return value;
  }
  if (response.status === 423 && payload.kind === "preview_paused") {
    const value = {
      kind: "preview_paused",
      isPreview: true,
      projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      title: typeof payload.title === "string" ? payload.title : "Project preview",
      isPublished: Boolean(payload.isPublished),
      previewAccess: payload.previewAccess ?? null,
    };
    remember(hostname, value, Number(payload.cacheSeconds) || 5);
    return value;
  }
  if (response.status === 404) {
    const value = { kind: "missing" };
    remember(hostname, value, Number(payload.cacheSeconds) || 15);
    return value;
  }
  if (response.status === 503) {
    return {
      kind: "restarting",
      isPreview: payload.kind === "preview",
      projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      previewAccess: payload.previewAccess ?? null,
      retryAfter: Number(payload.retryAfter) || RESTARTING_RETRY_SECONDS,
    };
  }
  return { kind: "fallback" };
}

async function resolveTarget(hostname, env) {
  const cached = targets.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.value;
  targets.delete(hostname);

  let lookup = lookups.get(hostname);
  if (!lookup) {
    lookup = fetchTarget(hostname, env)
      .catch(() => ({ kind: "fallback" }))
      .finally(() => lookups.delete(hostname));
    lookups.set(hostname, lookup);
  }
  return lookup;
}

function sameOriginTarget(base, incoming) {
  const target = new URL(base);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  return target;
}

function withoutInternalHeaders(source, stripPreviewCookie = false) {
  const headers = new Headers(source);
  for (const name of INTERNAL_HEADERS) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith(DAYTONA_HEADER_PREFIX)) headers.delete(name);
  }
  if (stripPreviewCookie) {
    const filtered = stripPreviewGrantCookie(headers.get("cookie"));
    if (filtered) headers.set("cookie", filtered);
    else headers.delete("cookie");
  }
  return headers;
}

function keepRedirectOnDomain(response, answeredBy, incoming) {
  const location = response.headers.get("location");
  if (!location) return response;
  const resolved = new URL(location, answeredBy);
  if (resolved.hostname !== answeredBy.hostname) return response;
  resolved.protocol = incoming.protocol;
  resolved.host = incoming.host;
  const rewritten = new Response(response.body, response);
  rewritten.headers.set("location", resolved.toString());
  return rewritten;
}

async function forwardToCognix(request, env, incoming) {
  const origin = new URL(env.COGNIX_ORIGIN);
  const headers = withoutInternalHeaders(request.headers);
  headers.set("x-cognix-edge-host", incoming.hostname);
  headers.set("x-cognix-edge-secret", env.COGNIX_EDGE_SECRET);
  headers.delete("cookie");

  const response = await fetch(sameOriginTarget(origin, incoming), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
  return keepRedirectOnDomain(response, origin, incoming);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const PAGE_STYLE = `
:root { color-scheme: dark; }
body { margin: 0; display: grid; min-height: 100dvh; place-items: center; background: #090909; padding: 24px; box-sizing: border-box;
  color: white; text-align: center; font: 13px/1.5 Geist, system-ui, -apple-system, "Segoe UI", sans-serif; }
main > div { width: min(440px, 100%); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: #151515; padding: 24px; box-sizing: border-box; }
h1 { margin: 0; font-size: 16px; font-weight: 600; }
p { margin: 8px 0 16px; color: rgba(255,255,255,.6); font-size: 12px; font-variant-numeric: tabular-nums; }
a { display: inline-flex; min-height: 34px; align-items: center; border-radius: 7px; background: #6c58f5; padding: 0 14px; color: white; font-size: 12px; font-weight: 500; text-decoration: none; }
a:focus-visible { outline: 2px solid #a99bff; outline-offset: 2px; }
@media (pointer: coarse) { a { min-height: 44px; } }`;

function restartingPage(incoming, isPreview = false, retrySeconds = RESTARTING_RETRY_SECONDS) {
  const retryHref = escapeHtml(`${incoming.pathname}${incoming.search}`);
  const heading = isPreview ? "This preview is starting" : "This app is restarting";
  const detail = isPreview
    ? "Waking the workspace preview server. This page reloads automatically…"
    : "Its saved production release is starting up. This page reloads automatically…";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${retrySeconds}"><meta name="robots" content="noindex">
<title>${heading}</title><style>${PAGE_STYLE}</style></head>
<body><main><div><h1>${heading}</h1>
<p>${detail}</p>
<a href="${retryHref}">Try again</a></div></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(retrySeconds),
    },
  });
}

function previewPausedPage(target, env) {
  const projectHref = target.projectId
    ? escapeHtml(new URL(`/projects/${target.projectId}`, env.COGNIX_ORIGIN).toString())
    : escapeHtml(env.COGNIX_ORIGIN);
  const title = escapeHtml(target.title || "Preview paused");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Preview paused</title><style>${PAGE_STYLE}</style></head>
<body><main><div><h1>Preview is turned off</h1>
<p>Development previews automatically stop when Curator is closed. Open this project in Curator to resume the preview, or publish the app to keep it live 24/7.</p>
<a href="${projectHref}">Open in Curator</a></div></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function badgeHtml(badge, env) {
  const href = escapeHtml(new URL(badge.href, env.COGNIX_ORIGIN).toString());
  const logo = escapeHtml(new URL("/cognix-logo-192.png", env.COGNIX_ORIGIN).toString());
  return `<style>
.cognix-edge-badge { all: initial; position: fixed; right: max(10px, env(safe-area-inset-right)); bottom: max(10px, env(safe-area-inset-bottom));
  z-index: 2147483647; display: inline-flex; height: 24px; align-items: center; gap: 5px; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,.14); border-radius: 6px; background: rgba(20,20,20,.88); padding: 0 8px 0 6px;
  color: rgba(255,255,255,.88); font: 500 11px/1 Geist, system-ui, sans-serif; text-decoration: none; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.25); transition: background-color .15s ease, color .15s ease; }
.cognix-edge-badge:hover { background: rgba(10,10,10,.96); color: white; }
.cognix-edge-badge:focus-visible { outline: 2px solid #a99bff; outline-offset: 2px; }
.cognix-edge-badge img { all: initial; width: 12px; height: 12px; border-radius: 3px; }
@media (pointer: coarse) { .cognix-edge-badge { min-height: 32px; } }
@media (prefers-reduced-motion: reduce) { .cognix-edge-badge { transition: none; } }
</style><a class="cognix-edge-badge" href="${href}" target="_blank" rel="noopener" aria-label="Edit with Curator (opens in a new tab)"><img src="${logo}" alt="" width="12" height="12">Edit with Curator</a>`;
}

function withBadge(response, badge, env) {
  const type = response.headers.get("content-type") ?? "";
  if (!badge || response.status !== 200 || !type.includes("text/html")) return response;
  const html = badgeHtml(badge, env);
  return new HTMLRewriter()
    .on("body", {
      element(element) {
        element.append(html, { html: true });
      },
    })
    .transform(response);
}

async function proxyToDaytona(request, env, incoming, target) {
  const upstream = new URL(target.upstream);
  const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (isWebSocket && target.isPreview) {
    const wsOrigin = request.headers.get("origin");
    if (wsOrigin) {
      try {
        const originHost = new URL(wsOrigin).hostname.toLowerCase();
        const builderHost = new URL(env.COGNIX_ORIGIN).hostname.toLowerCase();
        if (originHost !== incoming.hostname.toLowerCase() && originHost !== builderHost) {
          return new Response("Forbidden WebSocket origin.", { status: 403 });
        }
      } catch {
        return new Response("Invalid WebSocket origin.", { status: 403 });
      }
    }
  }

  const headers = withoutInternalHeaders(request.headers, Boolean(target.isPreview));
  for (const [name, value] of Object.entries(target.headers)) headers.set(name, value);

  let response;
  try {
    response = await fetch(sameOriginTarget(upstream, incoming), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    markStale(incoming.hostname);
    return restartingPage(incoming, Boolean(target.isPreview));
  }

  if (isWebSocket || response.status === 101) return response;
  if (response.status === 502 || response.status === 504) {
    markStale(incoming.hostname);
    if (["GET", "HEAD"].includes(request.method)) {
      await response.body?.cancel();
      return restartingPage(incoming, Boolean(target.isPreview));
    }
  }
  return withBadge(keepRedirectOnDomain(response, upstream, incoming), target.badge, env);
}

const cognixEdge = {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = new URL(env.COGNIX_ORIGIN);
    const secret = (env.COGNIX_EDGE_SECRET ?? "").trim();

    const appsDomain = (env.COGNIX_APPS_DOMAIN ?? "").trim().toLowerCase();
    const isAppsSubdomain = appsDomain && incoming.hostname.endsWith(`.${appsDomain}`);
    if (!isAppsSubdomain && (incoming.hostname === origin.hostname || incoming.hostname.endsWith(`.${origin.hostname}`))) {
      return fetch(request);
    }

    if (incoming.pathname === PROBE_PATH) return forwardToCognix(request, env, incoming);

    // 1. Edge preview auth grant callback
    const isLegacyGrantCallback = incoming.pathname === PREVIEW_AUTH_CALLBACK_PATH && request.method === "GET";
    const queryGrantToken = request.method === "GET" ? incoming.searchParams.get(PREVIEW_GRANT_COOKIE) : null;
    if (isLegacyGrantCallback || queryGrantToken) {
      const grantToken = isLegacyGrantCallback
        ? incoming.searchParams.get("grant") || ""
        : queryGrantToken || "";
      let nextPath = "/";
      if (isLegacyGrantCallback) {
        nextPath = safeTargetPath(incoming.searchParams.get("next") || "/");
      } else {
        const cleaned = new URL(incoming.toString());
        cleaned.searchParams.delete(PREVIEW_GRANT_COOKIE);
        nextPath = safeTargetPath(`${cleaned.pathname}${cleaned.search}`);
      }
      const verified = await verifyPreviewGrantToken(grantToken, incoming.hostname, secret);
      if (!verified) {
        const authRedirect = buildCuratorPreviewAuthUrl(env.COGNIX_ORIGIN, incoming.hostname, nextPath);
        return new Response(null, { status: 302, headers: { location: authRedirect, "cache-control": "no-store" } });
      }
      markStale(incoming.hostname);
      const maxAge = Math.max(60, verified.exp - Math.floor(Date.now() / 1000));
      const secureAttrs = incoming.protocol === "https:" ? "; Secure; SameSite=None; Partitioned" : "; SameSite=Lax";
      return new Response(null, {
        status: 302,
        headers: {
          location: nextPath,
          "cache-control": "no-store",
          "set-cookie": `${PREVIEW_GRANT_COOKIE}=${grantToken}; HttpOnly; Path=/; Max-Age=${maxAge}${secureAttrs}`,
        },
      });
    }

    // 2. Private invite link entry (`/auth?key={sharing_key}`) on preview subdomains
    if (incoming.pathname === "/auth" && incoming.searchParams.get("key") && request.method === "GET") {
      const shareKey = incoming.searchParams.get("key") || "";
      const targetForAuth = await resolveTarget(incoming.hostname, env);
      if (targetForAuth.isPreview) {
        const authRedirect = buildCuratorPreviewAuthUrl(env.COGNIX_ORIGIN, incoming.hostname, "/", { key: shareKey });
        return new Response(null, { status: 302, headers: { location: authRedirect, "cache-control": "no-store" } });
      }
    }

    const target = await resolveTarget(incoming.hostname, env);

    // 3. Enforce preview access control on all preview requests (including paused previews & WebSockets)
    if (target.isPreview && target.previewAccess) {
      const authorized = await isPreviewRequestAuthorized(request, incoming.hostname, target.previewAccess, secret);
      if (!authorized) {
        if (isBrowserNavigationRequest(request, incoming.pathname)) {
          const modeHint =
            target.previewAccess.publicActive && target.previewAccess.hasPasscode ? "passcode" : undefined;
          const authRedirect = buildCuratorPreviewAuthUrl(
            env.COGNIX_ORIGIN,
            incoming.hostname,
            `${incoming.pathname}${incoming.search}`,
            { mode: modeHint },
          );
          return new Response(null, { status: 302, headers: { location: authRedirect, "cache-control": "no-store" } });
        }
        return Response.json(
          { error: "Authentication required to access this preview." },
          { status: 401, headers: { "cache-control": "no-store" } },
        );
      }
    }

    if (target.kind === "preview_paused") return previewPausedPage(target, env);
    if (target.kind === "proxy") return proxyToDaytona(request, env, incoming, target);
    if (target.kind === "restarting") return restartingPage(incoming, Boolean(target.isPreview), target.retryAfter);
    return forwardToCognix(request, env, incoming);
  },
};

export default cognixEdge;
