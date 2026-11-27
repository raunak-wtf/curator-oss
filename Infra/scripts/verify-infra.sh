#!/usr/bin/env bash
set -euo pipefail

BUILDER_DOMAIN="${COGNIX_BUILDER_DOMAIN:?Set COGNIX_BUILDER_DOMAIN (e.g. curator.codes)}"
APPS_DOMAIN="${COGNIX_APPS_DOMAIN:?Set COGNIX_APPS_DOMAIN (e.g. curatorsite.in)}"
EDGE_SECRET="${COGNIX_EDGE_SECRET:?Set COGNIX_EDGE_SECRET}"
INTERNAL_URL="${COGNIX_INTERNAL_URL:-http://127.0.0.1:3005}"
EDGE_URL="${COGNIX_EDGE_PROXY_URL:-http://127.0.0.1:3006}"

echo "==> 1. Checking systemd services..."
for svc in cognix-app.service cognix-edge.service cognix-caddy.service; do
  status="$(systemctl is-active "$svc")"
  echo "    $svc: $status"
  [[ "$status" == "active" ]]
done

echo "==> 2. Checking internal health endpoints..."
curl -fsS "${INTERNAL_URL}/api/health" | grep -q '"ok":true'
echo "    cognix-app /api/health OK"
curl -fsS "${EDGE_URL}/_cognix-edge/healthz" | grep -q '^ok$'
echo "    cognix-edge /_cognix-edge/healthz OK"

echo "==> 3. Checking Caddy On-Demand TLS allow-domain gate..."
code_allowed="$(curl -sS -o /dev/null -w '%{http_code}' "${INTERNAL_URL}/api/edge/allow-domain?secret=${EDGE_SECRET}&domain=${BUILDER_DOMAIN}")"
code_wildcard="$(curl -sS -o /dev/null -w '%{http_code}' "${INTERNAL_URL}/api/edge/allow-domain?secret=${EDGE_SECRET}&domain=amber-orbit-12345678.${APPS_DOMAIN}")"
code_denied="$(curl -sS -o /dev/null -w '%{http_code}' "${INTERNAL_URL}/api/edge/allow-domain?secret=${EDGE_SECRET}&domain=unregistered-domain-check.example")"
echo "    allow-domain(${BUILDER_DOMAIN}) = ${code_allowed} (expected 200)"
echo "    allow-domain(*.${APPS_DOMAIN}) = ${code_wildcard} (expected 200)"
echo "    allow-domain(unregistered)     = ${code_denied} (expected 404)"
[[ "$code_allowed" == "200" && "$code_wildcard" == "200" && "$code_denied" == "404" ]]

echo "==> 4. Checking public HTTPS on https://${BUILDER_DOMAIN}..."
builder_headers="$(curl -sSI --max-time 20 "https://${BUILDER_DOMAIN}")"
echo "$builder_headers" | head -n 5
if echo "$builder_headers" | grep -qi ':8443'; then
  echo "ERROR: Internal port :8443 leaked in response headers!" >&2
  exit 1
fi

echo "==> 5. Checking 308 root & www redirects on ${APPS_DOMAIN}..."
root_loc="$(curl -sSI --max-time 20 "https://${APPS_DOMAIN}" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
www_loc="$(curl -sSI --max-time 20 "https://www.${APPS_DOMAIN}" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
echo "    https://${APPS_DOMAIN} -> ${root_loc}"
echo "    https://www.${APPS_DOMAIN} -> ${www_loc}"
[[ "$root_loc" == "https://${BUILDER_DOMAIN}"* && "$www_loc" == "https://${BUILDER_DOMAIN}"* ]]

echo "==> 6. Checking wildcard TLS + 404 routing on https://nonexistent-check.${APPS_DOMAIN}..."
wild_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://nonexistent-check.${APPS_DOMAIN}")"
echo "    wildcard nonexistent app HTTP status = ${wild_code} (expected 404)"
[[ "$wild_code" == "404" ]]

echo "All Cognix infrastructure checks passed!"
