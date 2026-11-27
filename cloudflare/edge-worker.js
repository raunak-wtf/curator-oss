/**
 * Cognix edge worker (Cloudflare Workers): a Daytona custom preview proxy for published apps.
 * https://www.daytona.io/docs/en/custom-preview-proxy/
 *
 * Customer domains CNAME to the Cognix zone (Cloudflare for SaaS), so this worker runs for them and Cloudflare
 * issues their certificates. For each customer hostname it asks Cognix (`/api/edge/resolve`) where the published
 * app runs, then forwards the request, WebSocket upgrades included, straight to the sandbox's Daytona preview URL
 * with the sandbox's preview token. Visitors stay on the customer domain: no iframe and no Daytona hostname.
 *
 * The Daytona API key never reaches the worker. Cognix hands out only the per-sandbox preview token, and only to
 * requests that carry COGNIX_EDGE_SECRET.
 *
 * When Cognix has no live publication for the hostname, or cannot be reached, the request goes to Cognix itself,
 * which renders its 404 page or the iframe fallback. The domain verification probe always goes to Cognix.
 *
 * Environment:
 *   COGNIX_ORIGIN       e.g. https://curator.codes   (plain variable)
 *   COGNIX_EDGE_SECRET  same value as the Cognix server (secret: `wrangler secret put COGNIX_EDGE_SECRET`)
 */

const RESOLVE_PATH = "/api/edge/resolve";
const PROBE_PATH = "/.well-known/cognix-domain-check";
const MAX_CACHED_HOSTS = 1000;
const RESTARTING_RETRY_SECONDS = 5;
// Headers only Cognix may set. A visitor sending them must not influence routing or reach the app with them.
const INTERNAL_HEADERS = ["x-cognix-edge-host", "x-cognix-edge-secret", "x-cognix-domain-host", "x-cognix-domain-path"];
// Daytona control headers come only from Cognix's resolve answer, never from the visitor.
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

/** Drops a target after the upstream failed, so the next resolve asks Cognix to re-check and restart the app. */
function markStale(hostname) {
  targets.delete(hostname);
  if (staleHosts.size >= MAX_CACHED_HOSTS) staleHosts.delete(staleHosts.values().next().value);
  staleHosts.add(hostname);
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
    const value = { kind: "proxy", upstream: payload.upstream, headers: payload.headers, badge: payload.badge ?? null };
    remember(hostname, value, Number(payload.cacheSeconds) || 60);
    return value;
  }
  if (response.status === 404) {
    const value = { kind: "missing" };
    remember(hostname, value, Number(payload.cacheSeconds) || 15);
    return value;
  }
  if (response.status === 503) return { kind: "restarting" };
  // Anything else (bad secret, Cognix error): let Cognix serve the request itself.
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

/** Builds `<base origin><incoming path>` without letting a path like `//other.host/` change the host. */
function sameOriginTarget(base, incoming) {
  const target = new URL(base);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  return target;
}

function withoutInternalHeaders(source) {
  const headers = new Headers(source);
  for (const name of INTERNAL_HEADERS) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith(DAYTONA_HEADER_PREFIX)) headers.delete(name);
  }
  return headers;
}

/** Keeps redirects on the customer domain instead of bouncing visitors to the host that answered. */
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
  headers.delete("cookie"); // the builder's session cookies never belong on a customer domain

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
main > div { width: min(420px, 100%); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: #151515; padding: 24px; box-sizing: border-box; }
h1 { margin: 0; font-size: 16px; font-weight: 600; }
p { margin: 8px 0 16px; color: rgba(255,255,255,.6); font-size: 12px; }
a { display: inline-flex; min-height: 34px; align-items: center; border-radius: 7px; background: #6c58f5; padding: 0 12px; color: white; font-size: 12px; text-decoration: none; }
a:focus-visible { outline: 2px solid #a99bff; outline-offset: 2px; }
@media (pointer: coarse) { a { min-height: 44px; } }`;

function restartingPage(incoming) {
  const retryHref = escapeHtml(`${incoming.pathname}${incoming.search}`);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RESTARTING_RETRY_SECONDS}"><meta name="robots" content="noindex">
<title>This app is restarting</title><style>${PAGE_STYLE}</style></head>
<body><main><div><h1>This app is restarting</h1>
<p>Its saved production release is starting up. This page reloads on its own in a few seconds.</p>
<a href="${retryHref}">Try again</a></div></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(RESTARTING_RETRY_SECONDS),
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
  const headers = withoutInternalHeaders(request.headers);
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
    return restartingPage(incoming);
  }

  if (isWebSocket || response.status === 101) return response;
  // Daytona answers 502/504 when nothing listens on the production port, for example after a sandbox restart.
  if ((response.status === 502 || response.status === 504) && ["GET", "HEAD"].includes(request.method)) {
    await response.body?.cancel();
    markStale(incoming.hostname);
    return restartingPage(incoming);
  }
  return withBadge(keepRedirectOnDomain(response, upstream, incoming), target.badge, env);
}

const cognixEdge = {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = new URL(env.COGNIX_ORIGIN);

    // Requests for Cognix itself pass straight through, except wildcard `COGNIX_APPS_DOMAIN` subdomains.
    const appsDomain = (env.COGNIX_APPS_DOMAIN ?? "").trim().toLowerCase();
    const isAppsSubdomain = appsDomain && incoming.hostname.endsWith(`.${appsDomain}`);
    if (!isAppsSubdomain && (incoming.hostname === origin.hostname || incoming.hostname.endsWith(`.${origin.hostname}`))) {
      return fetch(request);
    }

    // Domain verification must prove that this hostname's traffic reaches Cognix.
    if (incoming.pathname === PROBE_PATH) return forwardToCognix(request, env, incoming);

    const target = await resolveTarget(incoming.hostname, env);
    if (target.kind === "proxy") return proxyToDaytona(request, env, incoming, target);
    if (target.kind === "restarting") return restartingPage(incoming);
    return forwardToCognix(request, env, incoming);
  },
};

export default cognixEdge;
