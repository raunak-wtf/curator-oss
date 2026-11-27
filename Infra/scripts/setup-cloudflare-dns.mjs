#!/usr/bin/env node
/**
 * Safe, idempotent Cloudflare DNS configurator for Cognix two-domain setup.
 * Only upserts `@` and `www` on BUILDER_DOMAIN, and `@`, `*`, and `edge` on APPS_DOMAIN.
 * Leaves all other existing DNS records (MX, TXT, waitlist.*, idx.*, etc.) untouched.
 */

const required = (name) => {
  const val = process.env[name]?.trim();
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
};

const token = required("CLOUDFLARE_API_TOKEN");
const builderZoneId = required("BUILDER_ZONE_ID");
const builderDomain = required("BUILDER_DOMAIN").toLowerCase();
const appsZoneId = required("APPS_ZONE_ID");
const appsDomain = required("APPS_DOMAIN").toLowerCase();
const vmIpv4 = required("VM_IPV4");

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Cloudflare API ${path} failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result;
}

async function upsertRecord(zoneId, desired) {
  const existing = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(desired.name)}`);
  const sameType = existing.find((rec) => rec.type === desired.type);
  const conflicting = existing.filter(
    (rec) => (rec.type === "A" || rec.type === "AAAA" || rec.type === "CNAME") && rec.id !== sameType?.id,
  );
  for (const conflict of conflicting) {
    await cf(`/zones/${zoneId}/dns_records/${conflict.id}`, { method: "DELETE" });
    console.log(`Removed conflicting ${conflict.type} on ${conflict.name}`);
  }

  const body = JSON.stringify({
    type: desired.type,
    name: desired.name,
    content: desired.content,
    ttl: 1,
    proxied: false,
    comment: desired.comment,
  });

  if (sameType) {
    await cf(`/zones/${zoneId}/dns_records/${sameType.id}`, { method: "PUT", body });
    console.log(`Updated ${desired.type} ${desired.name} -> ${desired.content} (DNS only)`);
  } else {
    await cf(`/zones/${zoneId}/dns_records`, { method: "POST", body });
    console.log(`Created ${desired.type} ${desired.name} -> ${desired.content} (DNS only)`);
  }
}

await upsertRecord(builderZoneId, {
  type: "A",
  name: builderDomain,
  content: vmIpv4,
  comment: "Cognix builder root",
});
await upsertRecord(builderZoneId, {
  type: "CNAME",
  name: `www.${builderDomain}`,
  content: builderDomain,
  comment: "Cognix builder www redirect",
});

await upsertRecord(appsZoneId, {
  type: "A",
  name: appsDomain,
  content: vmIpv4,
  comment: "Cognix apps root -> 308 to builder",
});
await upsertRecord(appsZoneId, {
  type: "A",
  name: `*.${appsDomain}`,
  content: vmIpv4,
  comment: "Cognix wildcard previews & published apps",
});
await upsertRecord(appsZoneId, {
  type: "A",
  name: `edge.${appsDomain}`,
  content: vmIpv4,
  comment: "Cognix custom-domain CNAME target",
});

console.log("Cloudflare DNS setup complete.");
