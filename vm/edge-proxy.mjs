#!/usr/bin/env node
/**
 * Self-hosted Cognix Daytona custom preview & custom-domain edge proxy (Node 22+, zero npm dependencies).
 * Reference: https://www.daytona.io/docs/en/custom-preview-proxy/
 *
 * Sits behind Caddy (TLS termination + wildcard DNS-01 + On-Demand TLS) and forwards:
 *   - `preview-<projectId>.<COGNIX_APPS_DOMAIN>` -> Daytona port 3000 (live dev preview + HMR WebSockets)
 *   - `<slug>.<COGNIX_APPS_DOMAIN>`              -> Daytona port 3001 (published production build)
 *   - `<customer-custom-domain>`                 -> Daytona port 3001 (published production build)
 *   - `/.well-known/cognix-domain-check`         -> Cognix builder app (ownership + TLS serving probe)
 *
 * Environment:
 *   EDGE_LISTEN_HOST    default: 127.0.0.1
 *   EDGE_LISTEN_PORT    default: 3006
 *   COGNIX_INTERNAL_URL default: http://127.0.0.1:3005  (where Cognix Next.js listens locally)
 *   COGNIX_PUBLIC_ORIGIN e.g. https://curatorsite.in    (used for badge asset/remix links)
 *   COGNIX_EDGE_SECRET  shared secret matching Cognix's COGNIX_EDGE_SECRET
 */

import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";

const LISTEN_HOST = process.env.EDGE_LISTEN_HOST?.trim() || "127.0.0.1";
const LISTEN_PORT = Number(process.env.EDGE_LISTEN_PORT || 3006);
const COGNIX_INTERNAL_URL = process.env.COGNIX_INTERNAL_URL?.trim() || "http://127.0.0.1:3005";
const COGNIX_PUBLIC_ORIGIN = process.env.COGNIX_PUBLIC_ORIGIN?.trim() || COGNIX_INTERNAL_URL;
const COGNIX_EDGE_SECRET = process.env.COGNIX_EDGE_SECRET?.trim() || "";

if (!COGNIX_EDGE_SECRET) {
  console.error("[cognix-edge] Fatal: COGNIX_EDGE_SECRET must be set.");
  process.exit(1);
}

const RESOLVE_PATH = "/api/edge/resolve";
const ANALYTICS_PATH = "/api/edge/analytics";
const PROBE_PATH = "/.well-known/cognix-domain-check";
const HEALTH_PATH = "/_cognix-edge/healthz";
const MAX_CACHED_HOSTS = 2000;
const DEFAULT_RETRY_SECONDS = 4;

/** @type {Array<{ projectId: string, hostname: string, path: string, referrer: string | null, userAgent: string | null, clientIp: string | null, statusCode: number, timestamp: string }>} */
const pendingAnalytics = [];

function queuePageviewAnalytics(projectId, hostname, req, statusCode) {
  if (!projectId || req.method !== "GET" || statusCode >= 400) return;
  const rawPath = safeTargetPath(req.url).split("?")[0] || "/";
  if (/^(?:\/_next\/|\/__cognix|\/\.well-known\/|\/favicon|\/robots\.txt$|\/sitemap\.xml$)/i.test(rawPath)) return;
  if (pendingAnalytics.length >= 500) return;
  const xff = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const referrer = typeof req.headers.referer === "string" ? req.headers.referer.slice(0, 1000) : null;
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null;
  pendingAnalytics.push({
    projectId,
    hostname,
    path: rawPath.slice(0, 400),
    referrer,
    userAgent,
    clientIp: xff || null,
    statusCode,
    timestamp: new Date().toISOString(),
  });
}

setInterval(() => {
  if (!pendingAnalytics.length) return;
  const batch = pendingAnalytics.splice(0, 100);
  fetch(new URL(ANALYTICS_PATH, COGNIX_INTERNAL_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cognix-edge-secret": COGNIX_EDGE_SECRET,
    },
    body: JSON.stringify({ events: batch }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}, 5_000).unref();

const INTERNAL_HEADERS = new Set([
  "x-cognix-edge-host",
  "x-cognix-edge-secret",
  "x-cognix-domain-host",
  "x-cognix-domain-path",
]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
]);

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });

/** @type {Map<string, { expires: number, value: any }>} */
const targets = new Map();
/** @type {Set<string>} */
const staleHosts = new Set();
/** @type {Map<string, Promise<any>>} */
const lookups = new Map();

function normalizeHostname(raw) {
  if (!raw) return "";
  const first = String(raw).split(",")[0].trim().toLowerCase().replace(/\.$/, "");
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}

function incomingHost(req) {
  return normalizeHostname(req.headers["x-forwarded-host"] || req.headers.host || "");
}

function incomingProto(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim().toLowerCase();
  return proto === "http" ? "http" : "https";
}

function remember(hostname, value, seconds) {
  if (targets.size >= MAX_CACHED_HOSTS) {
    const oldest = targets.keys().next().value;
    if (oldest) targets.delete(oldest);
  }
  targets.set(hostname, { value, expires: Date.now() + seconds * 1000 });
}

function markStale(hostname) {
  targets.delete(hostname);
  if (staleHosts.size >= MAX_CACHED_HOSTS) {
    const oldest = staleHosts.values().next().value;
    if (oldest) staleHosts.delete(oldest);
  }
  staleHosts.add(hostname);
}

async function fetchTarget(hostname) {
  const url = new URL(RESOLVE_PATH, COGNIX_INTERNAL_URL);
  url.searchParams.set("host", hostname);
  if (staleHosts.delete(hostname)) url.searchParams.set("fresh", "1");

  const response = await fetch(url, {
    headers: {
      "x-cognix-edge-secret": COGNIX_EDGE_SECRET,
      accept: "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
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
    };
    remember(hostname, value, Number(payload.cacheSeconds) || 60);
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
      retryAfter: Number(payload.retryAfter) || DEFAULT_RETRY_SECONDS,
    };
  }
  return { kind: "fallback" };
}

async function resolveTarget(hostname) {
  const cached = targets.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.value;
  targets.delete(hostname);

  let lookup = lookups.get(hostname);
  if (!lookup) {
    lookup = fetchTarget(hostname)
      .catch(() => ({ kind: "fallback" }))
      .finally(() => lookups.delete(hostname));
    lookups.set(hostname, lookup);
  }
  return lookup;
}

function safeTargetPath(rawUrl) {
  const raw = typeof rawUrl === "string" && rawUrl.startsWith("/") ? rawUrl : "/";
  // Prevent scheme-relative `//evil.com` open redirects when joined onto an upstream origin.
  const collapsed = raw.startsWith("//") ? `/${raw.replace(/^\/+/, "")}` : raw;
  try {
    const parsed = new URL(collapsed, "http://cognix.invalid");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function sanitizeVisitorHeaders(rawHeaders, options = { keepUpgrade: false, stripCookie: false }) {
  /** @type {Record<string, string | string[]>} */
  const clean = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === "host") continue;
    if (INTERNAL_HEADERS.has(lower)) continue;
    if (lower.startsWith("x-daytona-")) continue;
    if (!options.keepUpgrade && HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (options.stripCookie && lower === "cookie") continue;
    clean[lower] = value;
  }
  return clean;
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
p { margin: 8px 0 16px; color: rgba(255,255,255,.6); font-size: 12px; font-variant-numeric: tabular-nums; }
a { display: inline-flex; min-height: 34px; align-items: center; border-radius: 7px; background: #6c58f5; padding: 0 12px; color: white; font-size: 12px; text-decoration: none; }
a:focus-visible { outline: 2px solid #a99bff; outline-offset: 2px; }
@media (pointer: coarse) { a { min-height: 44px; } }`;

function writeRestartingPage(res, reqUrl, isPreview = false, retrySeconds = DEFAULT_RETRY_SECONDS) {
  const retryHref = escapeHtml(safeTargetPath(reqUrl));
  const heading = isPreview ? "This preview is starting" : "This app is restarting";
  const detail = isPreview
    ? "Waking the sandbox and starting the development server. This page reloads automatically…"
    : "Its saved production release is starting up. This page reloads automatically…";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${retrySeconds}"><meta name="robots" content="noindex">
<title>${heading}</title><style>${PAGE_STYLE}</style></head>
<body><main><div><h1>${heading}</h1>
<p>${detail}</p>
<a href="${retryHref}">Try again</a></div></main></body></html>`;
  res.writeHead(503, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(retrySeconds),
    "content-length": String(Buffer.byteLength(html)),
  });
  res.end(html);
}

function badgeMarkup(badge) {
  const href = escapeHtml(new URL(badge.href, COGNIX_PUBLIC_ORIGIN).toString());
  const logo = escapeHtml(new URL("/cognix-logo-192.png", COGNIX_PUBLIC_ORIGIN).toString());
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

function rewriteRedirectLocation(locationHeader, upstreamUrl, visitorProto, visitorHost) {
  if (!locationHeader) return locationHeader;
  const value = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
  try {
    const resolved = new URL(value, upstreamUrl);
    if (resolved.hostname !== upstreamUrl.hostname) return locationHeader;
    resolved.protocol = `${visitorProto}:`;
    resolved.host = visitorHost;
    return resolved.toString();
  } catch {
    return locationHeader;
  }
}

function copyResponseHeaders(upstreamHeaders, upstreamUrl, visitorProto, visitorHost) {
  /** @type {Record<string, string | string[]>} */
  const out = {};
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "location") {
      out[lower] = rewriteRedirectLocation(value, upstreamUrl, visitorProto, visitorHost);
      continue;
    }
    out[lower] = value;
  }
  return out;
}

function maybeDecodeBody(buffer, encoding) {
  const normalized = String(encoding || "").trim().toLowerCase();
  if (!normalized || normalized === "identity") return buffer;
  if (normalized === "gzip" || normalized === "x-gzip") return zlib.gunzipSync(buffer);
  if (normalized === "deflate") return zlib.inflateSync(buffer);
  if (normalized === "br") return zlib.brotliDecompressSync(buffer);
  return null;
}

const MAX_BUFFERABLE_BODY_BYTES = 1024 * 1024; // 1 MiB (covers JSON auth, forms, Server Actions)

function canBufferRequestForWakeRetry(req, onBadGatewayRetry) {
  if (!onBadGatewayRetry) return false;
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/octet-stream")) {
    return false;
  }
  const rawLen = req.headers["content-length"];
  if (rawLen !== undefined) {
    const parsed = Number(rawLen);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_BUFFERABLE_BODY_BYTES;
  }
  return (
    contentType.startsWith("application/json") ||
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("text/plain")
  );
}

function collectRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload exceeds retry buffer"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendProxyAttempt(req, res, upstreamBase, extraHeaders, options, bufferedBody, allowWakeRetry) {
  const upstreamUrl = new URL(safeTargetPath(req.url), upstreamBase);
  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? https : http;
  const agent = isHttps ? httpsAgent : httpAgent;

  const headers = sanitizeVisitorHeaders(req.headers, {
    keepUpgrade: false,
    stripCookie: Boolean(options.stripCookie),
  });
  headers.host = upstreamUrl.host;
  if (bufferedBody) {
    headers["content-length"] = String(bufferedBody.length);
  }
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers[name.toLowerCase()] = value;
  }

  const retryAfterWake = async () => {
    markStale(options.visitorHost);
    const refreshed = await resolveTarget(options.visitorHost).catch(() => null);
    if (refreshed && refreshed.kind === "proxy") {
      sendProxyAttempt(req, res, refreshed.upstream, refreshed.headers, options, bufferedBody, false);
      return;
    }
    const reqPath = safeTargetPath(req.url);
    if (reqPath.startsWith("/api/")) {
      const body = JSON.stringify({
        error: "The preview server is waking up. Please submit again in a moment.",
      });
      res.writeHead(502, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(Buffer.byteLength(body)),
      });
      res.end(body);
      return;
    }
    writeRestartingPage(res, req.url, options.isPreview);
  };

  const proxyReq = transport.request(
    upstreamUrl,
    {
      method: req.method,
      headers,
      agent,
      timeout: 120_000,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;
      if (options.onBadGatewayRetry && (status === 502 || status === 504)) {
        markStale(options.visitorHost);
        if (req.method === "GET" || req.method === "HEAD") {
          proxyRes.resume();
          resolveTarget(options.visitorHost).catch(() => undefined);
          writeRestartingPage(res, req.url, options.isPreview);
          return;
        }
        if (allowWakeRetry && bufferedBody !== null) {
          proxyRes.resume();
          retryAfterWake().catch(() => undefined);
          return;
        }
        resolveTarget(options.visitorHost).catch(() => undefined);
        const reqPath = safeTargetPath(req.url);
        if (reqPath.startsWith("/api/")) {
          proxyRes.resume();
          const body = JSON.stringify({
            error: "The preview server was waking up or restarting. Please submit again in a moment.",
          });
          res.writeHead(502, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "content-length": String(Buffer.byteLength(body)),
          });
          res.end(body);
          return;
        }
      }

      const contentType = String(proxyRes.headers["content-type"] || "").toLowerCase();
      if (!options.isPreview && options.projectId && contentType.includes("text/html")) {
        queuePageviewAnalytics(options.projectId, options.visitorHost, req, status);
      }
      const shouldInjectBadge =
        Boolean(options.badge) &&
        status === 200 &&
        req.method === "GET" &&
        contentType.includes("text/html");

      const outHeaders = copyResponseHeaders(
        proxyRes.headersDistinct || proxyRes.headers,
        upstreamUrl,
        options.visitorProto,
        options.visitorHost,
      );

      if (!shouldInjectBadge) {
        res.writeHead(status, outHeaders);
        proxyRes.pipe(res);
        return;
      }

      /** @type {Buffer[]} */
      const chunks = [];
      let total = 0;
      const maxHtmlBytes = 5 * 1024 * 1024;
      proxyRes.on("data", (chunk) => {
        total += chunk.length;
        if (total <= maxHtmlBytes) chunks.push(chunk);
      });
      proxyRes.on("end", () => {
        const rawBuffer = Buffer.concat(chunks);
        if (total > maxHtmlBytes) {
          res.writeHead(status, outHeaders);
          res.end(rawBuffer);
          return;
        }
        const encodingHeader = Array.isArray(proxyRes.headers["content-encoding"])
          ? proxyRes.headers["content-encoding"][0]
          : proxyRes.headers["content-encoding"];
        let decoded = null;
        try {
          decoded = maybeDecodeBody(rawBuffer, encodingHeader);
        } catch {
          decoded = null;
        }
        if (!decoded) {
          res.writeHead(status, outHeaders);
          res.end(rawBuffer);
          return;
        }
        const htmlText = decoded.toString("utf8");
        const injection = badgeMarkup(options.badge);
        const updated = htmlText.includes("</body>")
          ? htmlText.replace("</body>", `${injection}</body>`)
          : `${htmlText}${injection}`;
        const bodyBuf = Buffer.from(updated, "utf8");
        delete outHeaders["content-encoding"];
        outHeaders["content-length"] = String(bodyBuf.length);
        res.writeHead(status, outHeaders);
        res.end(bodyBuf);
      });
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy(new Error("Upstream timeout"));
  });

  proxyReq.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (options.onBadGatewayRetry) {
      if (allowWakeRetry && bufferedBody !== null) {
        retryAfterWake().catch(() => undefined);
        return;
      }
      markStale(options.visitorHost);
      resolveTarget(options.visitorHost).catch(() => undefined);
      writeRestartingPage(res, req.url, options.isPreview);
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Cognix origin is temporarily unreachable. Try again in a moment.");
  });

  if (bufferedBody !== null) {
    proxyReq.end(bufferedBody);
  } else {
    req.pipe(proxyReq);
  }
}

function forwardHttpRequest(req, res, upstreamBase, extraHeaders, options) {
  if (canBufferRequestForWakeRetry(req, options.onBadGatewayRetry)) {
    collectRequestBody(req, MAX_BUFFERABLE_BODY_BYTES)
      .then((bufferedBody) => {
        sendProxyAttempt(req, res, upstreamBase, extraHeaders, options, bufferedBody, true);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(413, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "Request body exceeded the expected size." }));
        }
      });
    return;
  }
  sendProxyAttempt(req, res, upstreamBase, extraHeaders, options, null, false);
}

const server = http.createServer(async (req, res) => {
  const pathOnly = safeTargetPath(req.url);
  if (pathOnly === HEALTH_PATH) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("ok");
    return;
  }

  const hostname = incomingHost(req);
  const proto = incomingProto(req);
  if (!hostname) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Missing Host header.");
    return;
  }

  if (pathOnly.startsWith(PROBE_PATH)) {
    forwardHttpRequest(
      req,
      res,
      COGNIX_INTERNAL_URL,
      {
        "x-cognix-edge-host": hostname,
        "x-cognix-edge-secret": COGNIX_EDGE_SECRET,
      },
      {
        stripCookie: true,
        onBadGatewayRetry: false,
        visitorHost: hostname,
        visitorProto: proto,
        isPreview: false,
        badge: null,
      },
    );
    return;
  }

  const target = await resolveTarget(hostname);

  if (target.kind === "proxy") {
    forwardHttpRequest(req, res, target.upstream, target.headers, {
      stripCookie: false,
      onBadGatewayRetry: true,
      visitorHost: hostname,
      visitorProto: proto,
      isPreview: Boolean(target.isPreview),
      projectId: target.projectId ?? null,
      badge: target.badge,
    });
    return;
  }

  if (target.kind === "restarting") {
    writeRestartingPage(res, req.url, Boolean(target.isPreview), target.retryAfter);
    return;
  }

  forwardHttpRequest(
    req,
    res,
    COGNIX_INTERNAL_URL,
    {
      "x-cognix-edge-host": hostname,
      "x-cognix-edge-secret": COGNIX_EDGE_SECRET,
    },
    {
      stripCookie: true,
      onBadGatewayRetry: false,
      visitorHost: hostname,
      visitorProto: proto,
      isPreview: false,
      badge: null,
    },
  );
});

server.on("upgrade", async (req, clientSocket, head) => {
  clientSocket.on("error", () => undefined);
  const hostname = incomingHost(req);
  if (!hostname) {
    clientSocket.destroy();
    return;
  }

  const target = await resolveTarget(hostname);
  if (target.kind !== "proxy") {
    clientSocket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const upstreamUrl = new URL(safeTargetPath(req.url), target.upstream);
  const isTls = upstreamUrl.protocol === "https:";
  const port = Number(upstreamUrl.port) || (isTls ? 443 : 80);

  const headers = sanitizeVisitorHeaders(req.headers, { keepUpgrade: true, stripCookie: false });
  headers.host = upstreamUrl.host;
  headers.connection = "Upgrade";
  headers.upgrade = req.headers.upgrade || "websocket";
  for (const [name, value] of Object.entries(target.headers)) {
    headers[name.toLowerCase()] = value;
  }

  const headerLines = [`${req.method || "GET"} ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/1.1`];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headerLines.push(`${name}: ${item}`);
    } else if (value !== undefined) {
      headerLines.push(`${name}: ${value}`);
    }
  }
  headerLines.push("", "");
  const handshake = Buffer.from(headerLines.join("\r\n"), "utf8");

  const upstreamSocket = isTls
    ? tls.connect({
        host: upstreamUrl.hostname,
        port,
        servername: upstreamUrl.hostname,
        ALPNProtocols: ["http/1.1"],
      })
    : net.connect({ host: upstreamUrl.hostname, port });

  upstreamSocket.setNoDelay(true);
  clientSocket.setNoDelay(true);

  upstreamSocket.on("connect", () => {
    if (!isTls) {
      upstreamSocket.write(handshake);
      if (head && head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    }
  });

  upstreamSocket.on("secureConnect", () => {
    upstreamSocket.write(handshake);
    if (head && head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on("error", () => {
    markStale(hostname);
    clientSocket.destroy();
  });

  clientSocket.on("close", () => {
    upstreamSocket.destroy();
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[cognix-edge] Listening on http://${LISTEN_HOST}:${LISTEN_PORT} -> Cognix ${COGNIX_INTERNAL_URL}`);
});
