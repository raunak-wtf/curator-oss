import { isAgentConfigured } from "@/lib/ai/runner";
import { isAuthConfigured } from "@/lib/auth0";
import { isBucketlineConfigured } from "@/lib/cloud/bucketline";
import { isNeonApiConfigured } from "@/lib/cloud/neon";
import { isDaytonaConfigured } from "@/lib/daytona";
import { getPerformanceArchitectureMetadata } from "@/lib/feature-flags";
import { isStorageConfigured } from "@/lib/storage";
import { isDatabaseConfigured } from "@/lib/store";

export async function GET() {
  return Response.json({
    ok: true,
    architecture: getPerformanceArchitectureMetadata(),
    services: {
      auth0: isAuthConfigured,
      database: isDatabaseConfigured,
      sandbox: isDaytonaConfigured,
      model: isAgentConfigured,
      storage: isStorageConfigured,
      cloudDatabase: isNeonApiConfigured(),
      cloudStorage: isBucketlineConfigured(),
    },
  });
}
