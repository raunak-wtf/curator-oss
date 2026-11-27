import {
  hostnameFromHeader,
  isAppHostname,
  isIpAddress,
  isTrustedEdgeQueryOrHeader,
  parseAppsHostname,
} from "@/lib/domains";
import { hasRegisteredDomain } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" };

/**
 * Caddy On-Demand TLS `ask` endpoint.
 * Approves certificate issuance (`200`) only for Cognix's own hostnames, `COGNIX_APPS_DOMAIN` subdomains,
 * or customer domains explicitly attached to a Cognix project in the database.
 * Random scanners and unattached domains get `404` so Let's Encrypt rate limits are never wasted.
 */
export async function GET(request: Request) {
  if (!isTrustedEdgeQueryOrHeader(request)) {
    return new Response("forbidden", { status: 403, headers: noStore });
  }

  const hostname = hostnameFromHeader(new URL(request.url).searchParams.get("domain"));
  if (!hostname || isIpAddress(hostname)) {
    return new Response("invalid domain", { status: 400, headers: noStore });
  }

  if (isAppHostname(hostname) || Boolean(parseAppsHostname(hostname))) {
    return new Response("ok", { status: 200, headers: noStore });
  }

  if (await hasRegisteredDomain(hostname)) {
    return new Response("ok", { status: 200, headers: noStore });
  }

  return new Response("denied", { status: 404, headers: noStore });
}
