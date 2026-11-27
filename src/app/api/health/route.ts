import { isAgentConfigured } from "@/lib/ai/runner";
import { isAuthConfigured } from "@/lib/auth0";
import { isBucketlineConfigured } from "@/lib/cloud/bucketline";
import { isNeonApiConfigured } from "@/lib/cloud/neon";
import { isDatabaseConfigured } from "@/lib/db";
import { isDaytonaConfigured } from "@/lib/daytona";
import { isStorageConfigured } from "@/lib/storage";

export async function GET() {
  return Response.json({
    ok: true,
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
