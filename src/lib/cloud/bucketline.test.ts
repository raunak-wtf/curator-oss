import { describe, expect, it } from "vitest";
import {
  assertProjectOwnsBucket,
  buildPublicCdnUrl,
  createPresignedStorageUrl,
  formatProjectBucketName,
  getBucketlineBaseUrl,
  normalizeObjectKey,
  projectBucketPrefix,
  projectOwnsBucket,
  rewriteLegacyBucketlineUrl,
  scrubStorageSecrets,
} from "./bucketline";

describe("Bucketline Cognix Cloud Storage helpers", () => {
  const projectA = "4be40d88-e149-4ffb-9b68-e9c7fb1e5014";
  const projectB = "99999999-1111-2222-3333-444444444444";

  it("enforces deterministic per-project bucket prefix isolation", () => {
    expect(projectBucketPrefix(projectA)).toBe("cx-4be40d88-");
    expect(formatProjectBucketName(projectA, "Avatars & Photos!!")).toBe("cx-4be40d88-avatars-photos");
    expect(projectOwnsBucket(projectA, "cx-4be40d88-storage")).toBe(true);
    expect(projectOwnsBucket(projectB, "cx-4be40d88-storage")).toBe(false);
    expect(() => assertProjectOwnsBucket(projectB, "cx-4be40d88-storage")).toThrow(/does not belong/);
  });

  it("rejects path traversal in object keys and formats public CDN URLs", () => {
    expect(normalizeObjectKey("/users/u1/avatar photo.png")).toBe("users/u1/avatar photo.png");
    expect(() => normalizeObjectKey("../secrets.txt")).toThrow(/Invalid object key/);

    const cdnUrl = buildPublicCdnUrl(
      "https://cloud.curator.codes/api/public/cdn/9f8c1a2b3d4e5f60a7b8c9d0e1f2a3b4/cx-4be40d88-media/",
      "avatars/user 1.png",
    );
    expect(cdnUrl).toBe(
      "https://cloud.curator.codes/api/public/cdn/9f8c1a2b3d4e5f60a7b8c9d0e1f2a3b4/cx-4be40d88-media/avatars/user%201.png",
    );
  });

  it("generates RFC-compliant SigV4 presigned GET and PUT URLs and scrubs management keys", () => {
    const presigned = createPresignedStorageUrl(
      {
        bucket: "cx-4be40d88-storage",
        accessKeyId: "AKIAEXAMPLEKEY123456",
        secretAccessKey: "secret-example-key-value",
        s3Endpoint: "https://cloud.curator.codes/api/public/s3",
        s3Region: "auto",
      },
      { method: "GET", key: "docs/invoice.pdf", expiresInSeconds: 3600 },
    );

    expect(presigned.url).toContain(
      "https://cloud.curator.codes/api/public/s3/cx-4be40d88-storage/docs/invoice.pdf?",
    );
    expect(presigned.url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(presigned.url).toContain("X-Amz-Expires=3600");
    expect(presigned.url).toContain("X-Amz-SignedHeaders=host");
    expect(presigned.url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);

    expect(scrubStorageSecrets("Error with key bk_AbCdEfGhIjKlMnOpQrStUvWxYz1234")).toBe(
      "Error with key bk_[REDACTED]",
    );
  });

  it("defaults to https://cloud.curator.codes and rewrites legacy cloudnest-cdn-vault URLs", () => {
    expect(getBucketlineBaseUrl()).toBe("https://cloud.curator.codes");
    expect(rewriteLegacyBucketlineUrl("https://cloudnest-cdn-vault.lovable.app/api/public/s3")).toBe(
      "https://cloud.curator.codes/api/public/s3",
    );
    expect(
      rewriteLegacyBucketlineUrl(
        "https://cloudnest-cdn-vault.lovable.app/api/public/cdn/ns1/cx-4be40d88-media",
      ),
    ).toBe("https://cloud.curator.codes/api/public/cdn/ns1/cx-4be40d88-media");
  });
});
