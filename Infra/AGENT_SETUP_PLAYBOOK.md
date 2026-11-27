# Autonomous AI Agent Infrastructure Playbook

This playbook is written for an AI coding or DevOps agent tasked with deploying **Cognix (Curator)**, its **Daytona Custom Preview Proxy**, **Cloudflare DNS**, **Wildcard Preview/Publish Subdomains**, and **On-Demand TLS Custom Domains** on a Linux VM.

---

## 0. Non-Negotiable Safety & Secret Rules

1. **Never print or log secrets:** Never run `cat .env*`, `printenv`, or echo API keys, passwords, or service-account JSON to stdout/logs. Write secrets directly to `0600`-permissioned files on disk.
2. **Preserve existing DNS records & services:**
   - Before modifying Cloudflare DNS, list existing records and **only** upsert `@`, `www` (on Builder domain) and `@`, `*`, `edge` (on Apps domain). Never delete unrelated records (e.g. `waitlist.*`, `idx.*`, `MX`, `TXT` SPF/DKIM).
   - Before binding ports `80` / `443`, run `ss -tulpn | grep -E ':80 |:443 '` to detect whether **Coolify / Traefik (`coolify-proxy`)**, Nginx, or Caddy is already running. If Traefik owns `:80`/`:443`, use the **Behind-Traefik** topology (`Infra/caddy/Caddyfile.behind-traefik` + `Infra/traefik/cognix-dynamic.yaml`) instead of stopping the user's existing proxy!
3. **Never copy host secrets into Daytona sandboxes:** `DAYTONA_API_KEY`, `NEON_API_KEY`, `COGNIX_EDGE_SECRET`, `COGNIX_SECRETS_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` belong strictly on the VM host.

---

## 1. Required Inputs Checklist

Collect or verify these values before starting:

- **VM SSH access:** `VM_HOST` (public IPv4), `VM_PORT`, `VM_USER`, SSH key or password.
- **Domains:**
  - `COGNIX_BUILDER_DOMAIN` (e.g. `curator.codes`) — serves Cognix UI & API.
  - `COGNIX_APPS_DOMAIN` (e.g. `curatorsite.in`) — serves `<random>.curatorsite.in` previews (`:3000`), `<slug>.curatorsite.in` published apps (`:3001`), and `edge.curatorsite.in` CNAME target; root redirects `308` to `https://<COGNIX_BUILDER_DOMAIN>`.
- **Cloudflare credentials:**
  - `CLOUDFLARE_API_TOKEN` with `Zone -> DNS -> Edit` on both zones.
  - `BUILDER_ZONE_ID` and `APPS_ZONE_ID` (discoverable via `GET https://api.cloudflare.com/client/v4/zones?name=<domain>`).
- **Cognix application env:** `DATABASE_URL`, `NEON_API_KEY` (optional, for managed Cognix Cloud Neon provisioning), `AUTH0_*`, `DAYTONA_API_KEY`, `OPENAI_*`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_STORAGE_BUCKET`, GCS service-account JSON.
- **Generated random secrets (if not already provided):**
  - `COGNIX_EDGE_SECRET` → `openssl rand -hex 32`
  - `COGNIX_SECRETS_KEY` → `openssl rand -base64 32`

---

## 2. Phase-by-Phase Execution Plan

### Phase 1 — Preflight Inspection on the VM

Run over SSH:

```bash
uname -a
node -v || true
ss -tulpn | grep -E ':80\b|:443\b|:3005\b|:3006\b|:8088\b|:8443\b' || true
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || true
```

- **Decision gate:**
  - If `coolify-proxy` (Traefik) owns `:80` and `:443`: select **Behind-Traefik mode** (`CADDY_HTTP_PORT=8088`, `CADDY_HTTPS_PORT=8443`, `CADDY_BIND="127.0.0.1 10.0.0.1"` — verify Docker host bridge IP via `ip -4 addr show docker0` or `docker network inspect coolify`).
  - If `:80` and `:443` are free: select **Standalone mode** (`CADDY_HTTP_PORT=80`, `CADDY_HTTPS_PORT=443`, `CADDY_BIND="0.0.0.0"`).
- Ensure Node.js `>= 22` is installed (install via NodeSource `setup_22.x` if missing).

---

### Phase 2 — Idempotent Cloudflare DNS Configuration

Run [`Infra/scripts/setup-cloudflare-dns.mjs`](./scripts/setup-cloudflare-dns.mjs) locally or on the VM:

```bash
CLOUDFLARE_API_TOKEN="..." \
BUILDER_ZONE_ID="..." \
BUILDER_DOMAIN="curator.codes" \
APPS_ZONE_ID="..." \
APPS_DOMAIN="curatorsite.in" \
VM_IPV4="<VM_PUBLIC_IPV4>" \
node Infra/scripts/setup-cloudflare-dns.mjs
```

Verify DNS propagation before requesting certificates:

```bash
dig +short A curator.codes @1.1.1.1
dig +short A curatorsite.in @1.1.1.1
dig +short A edge.curatorsite.in @1.1.1.1
dig +short A random-check.curatorsite.in @1.1.1.1
```

All four must return `<VM_PUBLIC_IPV4>` (not Cloudflare proxy IPs—`proxied` must be `false`).

---

### Phase 3 — Build Custom Caddy with `caddy-dns/cloudflare`

```bash
if ! /usr/local/bin/caddy list-modules 2>/dev/null | grep -q 'dns.providers.cloudflare'; then
  apt-get update && apt-get install -y curl git ca-certificates golang-go
  # If distro golang is < 1.22, install official Go tarball to /usr/local/go first
  GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  /usr/local/bin/xcaddy build --with github.com/caddy-dns/cloudflare --output /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
  setcap cap_net_bind_service=+ep /usr/local/bin/caddy
fi
/usr/local/bin/caddy version
/usr/local/bin/caddy list-modules | grep dns.providers.cloudflare
```

---

### Phase 4 — Sync Application, Write Secrets (`0600`), Migrate & Build

1. Sync repository to `/opt/cognix/app` (excluding `node_modules`, `.next`, `.git`, `.env*`).
2. Write `/opt/cognix/gcs-service-account.json` (`chmod 600`) and `/opt/cognix/app/.env.production` (`chmod 600`).
   Ensure these exact routing variables are present in `/opt/cognix/app/.env.production`:
   ```dotenv
   APP_BASE_URL=https://curator.codes
   COGNIX_APP_HOSTS=curator.codes,www.curator.codes
   COGNIX_APPS_DOMAIN=curatorsite.in
   COGNIX_DOMAIN_CNAME_TARGET=edge.curatorsite.in
   COGNIX_DOMAIN_IPV4=<VM_PUBLIC_IPV4>
   COGNIX_EDGE_SECRET=<SHARED_64_HEX_SECRET>
   COGNIX_PUBLISHED_AUTOSTOP_MINUTES=15
   ```
3. Install, migrate, and build:
   ```bash
   cd /opt/cognix/app
   npm ci
   npx drizzle-kit push
   npm run build
   ```

---

### Phase 5 — Configure Edge Proxy, Caddy, Traefik (if applicable), and Systemd

1. Create `/etc/cognix/infra.env` (`chmod 600`) from `Infra/env/cognix-infra.env.example` with matching `COGNIX_EDGE_SECRET` and `CLOUDFLARE_API_TOKEN`.
2. Copy proxy & Caddyfile:
   ```bash
   mkdir -p /etc/cognix /var/lib/caddy
   cp /opt/cognix/app/Infra/proxy/edge-proxy.mjs /opt/cognix/edge-proxy.mjs
   ```
   - **Standalone:** `cp /opt/cognix/app/Infra/caddy/Caddyfile.standalone /etc/cognix/Caddyfile`
   - **Behind Coolify Traefik:**
     ```bash
     cp /opt/cognix/app/Infra/caddy/Caddyfile.behind-traefik /etc/cognix/Caddyfile
     cp /opt/cognix/app/Infra/traefik/cognix-dynamic.yaml /data/coolify/proxy/dynamic/cognix.yaml
     ```
     *(Verify the Docker gateway IP inside `cognix-dynamic.yaml` matches `docker network inspect coolify -f '{{(index .IPAM.Config 0).Gateway}}'`, typically `10.0.0.1`.)*
3. Validate Caddyfile syntax:
   ```bash
   set -a && . /etc/cognix/infra.env && set +a
   /usr/local/bin/caddy validate --config /etc/cognix/Caddyfile --adapter caddyfile
   ```
4. Install & start `systemd` services:
   ```bash
   cp /opt/cognix/app/Infra/systemd/cognix-*.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now cognix-app.service cognix-edge.service cognix-caddy.service
   ```

---

### Phase 6 — Mandatory Automated Verification Gate

Run [`Infra/scripts/verify-infra.sh`](./scripts/verify-infra.sh):

```bash
set -a && . /etc/cognix/infra.env && set +a
bash /opt/cognix/app/Infra/scripts/verify-infra.sh
```

Do not declare deployment complete until **all** assertions pass:
1. `cognix-app.service`, `cognix-edge.service`, and `cognix-caddy.service` are `active`.
2. `GET http://127.0.0.1:3005/api/health` returns `{"ok":true,...}`.
3. `GET http://127.0.0.1:3006/_cognix-edge/healthz` returns `ok`.
4. `GET /api/edge/allow-domain` returns `200` for `COGNIX_BUILDER_DOMAIN` and `*.COGNIX_APPS_DOMAIN`, and `404` for unknown domains.
5. `curl -sSI https://<COGNIX_BUILDER_DOMAIN>` returns `200` with valid TLS and **no** `:8443` in `alt-svc`.
6. `curl -sSI https://<COGNIX_APPS_DOMAIN>` and `https://www.<COGNIX_APPS_DOMAIN>` return `308` with `location: https://<COGNIX_BUILDER_DOMAIN>`.
7. `curl -sSI https://nonexistent-slug.<COGNIX_APPS_DOMAIN>` terminates wildcard TLS cleanly and returns Cognix's `404` page (`HTTP 404`, not `502` or TLS handshake failure).

---

### Phase 7 — Handoff & Credential Rotation Notice

After all checks pass:
1. Delete any temporary SSH helper scripts or local scratch files used during provisioning.
2. Remind the human operator to rotate any temporary SSH password or broad Cloudflare API token that was shared for setup, leaving only a scoped `Zone -> DNS -> Edit` token in `/etc/cognix/infra.env`.
