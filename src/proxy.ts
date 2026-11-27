import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  DOMAIN_HOST_HEADER,
  DOMAIN_PATH_HEADER,
  DOMAIN_PROBE_PATH,
  EDGE_SECRET_HEADER,
  domainProbeBody,
  hostnameFromHeader,
  isAppHostname,
  isCustomDomainRoutingEnabled,
  parseAppsHostname,
  trustedEdgeHostname,
} from "@/lib/domains";

function requestHostname(request: NextRequest) {
  return (
    // Customer domains proxied by the Cognix edge worker arrive on the app host with the real hostname attached.
    trustedEdgeHostname(request.headers) ||
    hostnameFromHeader(request.headers.get("x-forwarded-host")) ||
    hostnameFromHeader(request.headers.get("host")) ||
    hostnameFromHeader(request.nextUrl.host)
  );
}

export async function proxy(request: NextRequest) {
  const hostname = requestHostname(request);

  // Lets domain verification confirm that a hostname's traffic actually reaches this server.
  if (request.nextUrl.pathname === DOMAIN_PROBE_PATH) {
    return new NextResponse(domainProbeBody(hostname), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // Wildcard apps subdomains (`<name>.curatorsite.in` or `<random-slug>.curatorsite.in`) never expose the builder UI.
  const appsMatch = parseAppsHostname(hostname);
  if (appsMatch) {
    if (appsMatch.kind === "root") {
      const builderOrigin = process.env.APP_BASE_URL?.trim() || "https://curator.codes";
      return NextResponse.redirect(builderOrigin, 308);
    }
    const url = request.nextUrl.clone();
    const headers = new Headers(request.headers);
    headers.delete(EDGE_SECRET_HEADER);
    if (appsMatch.kind === "published") {
      const suffix = request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname;
      url.pathname = `/publish/${encodeURIComponent(appsMatch.slug)}${suffix}`;
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") url.protocol = "http:";
      return NextResponse.rewrite(url, { request: { headers } });
    }
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // A request that arrives on an attached customer domain only ever serves that published app,
  // never the builder, its API, or an Auth0 session.
  if (isCustomDomainRoutingEnabled() && !isAppHostname(hostname)) {
    const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = `/domain/${encodeURIComponent(hostname)}`;
    url.search = "";
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") url.protocol = "http:";
    const headers = new Headers(request.headers);
    // The secret must never reach the published-app page or any downstream code.
    headers.delete(EDGE_SECRET_HEADER);
    headers.set(DOMAIN_HOST_HEADER, hostname);
    // Deep links such as /pricing?plan=pro open the same page inside the published app.
    headers.set(DOMAIN_PATH_HEADER, requestedPath);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // `/domain/*` is internal: it only renders through the rewrite above, never by direct request
  // on the builder host, where a client could otherwise spoof the routing headers.
  if (request.nextUrl.pathname.startsWith("/domain/")) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (!auth0) return NextResponse.next();
  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|sw\\.js).*)"],
};
