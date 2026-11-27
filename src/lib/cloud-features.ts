/**
 * Cognix Cloud features and the environment variables a generated app reads for each one.
 * The UI shows which are set, and the agent's internal guides write code against the same names.
 */
export type CloudFeature = "database" | "storage" | "auth" | "email";

export const CLOUD_FEATURE_ORDER: CloudFeature[] = ["database", "storage", "email", "auth"];

export const CLOUD_FEATURES: Record<
  CloudFeature,
  { label: string; title: string; description: string; env: string[]; examples: string[] }
> = {
  database: {
    label: "Database",
    title: "Store your app's data",
    description: "A Postgres database for records like users, posts, and orders.",
    env: ["DATABASE_URL"],
    examples: ["Save tasks to a database so they persist", "Add a database table for customer orders"],
  },
  storage: {
    label: "Storage",
    title: "Store files and images",
    description: "Buckets for uploads such as avatars, photos, and documents.",
    env: ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    examples: ["Let users upload a profile photo", "Add a private bucket for invoice PDFs"],
  },
  email: {
    label: "Emails",
    title: "Send emails from your app",
    description: "Receipts, verification codes, and notifications sent from your own domain.",
    env: ["RESEND_API_KEY", "EMAIL_FROM"],
    examples: ["Email a receipt after checkout", "Send a weekly summary email"],
  },
  auth: {
    label: "Authentication",
    title: "Let people sign in",
    description: "Email and password accounts with verification and password reset, powered by Better Auth.",
    env: ["BETTER_AUTH_SECRET", "DATABASE_URL"],
    examples: ["Add sign-up and sign-in with email", "Protect the dashboard so only signed-in users see it"],
  },
};

export function isCloudFeature(value: unknown): value is CloudFeature {
  return typeof value === "string" && value in CLOUD_FEATURES;
}
