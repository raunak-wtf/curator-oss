import type { ScaffoldFile, ScaffoldProfile } from "./types";

export const SCAFFOLD_TEMPLATE_VERSION = "1.1.0";

export const SCAFFOLD_PROFILE_ORDER: readonly ScaffoldProfile[] = [
  "base",
  "database",
  "auth",
  "storage",
  "email",
] as const;

export type ProfileOverlayDefinition = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  files: ScaffoldFile[];
};

const BASE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const BASE_NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "better-auth", "drizzle-orm", "@aws-sdk/client-s3", "resend"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
`;

const BASE_POSTCSS_CONFIG = `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;

const BASE_GLOBALS_CSS = `@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
  --muted: #66666f;
  --surface: #fafafa;
  --surface-raised: #ffffff;
  --surface-subtle: #f4f4f5;
  --border: #e4e4e7;
  --border-strong: #c9c9cf;
  --primary: #2457d6;
  --primary-foreground: #ffffff;
  --ring: #2457d6;
  --success: #15803d;
  --warning: #a16207;
  --danger: #b91c1c;
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;
  --shadow-raised: 0 1px 2px rgb(0 0 0 / 0.05), 0 10px 30px rgb(0 0 0 / 0.04);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0b;
    --foreground: #f4f4f5;
    --muted: #a1a1aa;
    --surface: #111113;
    --surface-raised: #18181b;
    --surface-subtle: #202024;
    --border: rgb(255 255 255 / 0.12);
    --border-strong: rgb(255 255 255 / 0.22);
    --primary: #7aa2ff;
    --primary-foreground: #08132f;
    --ring: #9bb7ff;
    --success: #4ade80;
    --warning: #facc15;
    --danger: #fb7185;
    --shadow-raised: 0 1px 2px rgb(0 0 0 / 0.3), 0 16px 40px rgb(0 0 0 / 0.22);
  }
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
}

@layer base {
  :where(a, button, input, textarea, select, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }

  button:not(:disabled),
  [role="button"]:not([aria-disabled="true"]) {
    cursor: pointer;
  }
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.text-balance {
  text-wrap: balance;
}

@media (pointer: coarse) {
  :where(button, [role="button"], input, select, textarea) {
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const BASE_CN_TS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const BASE_BUTTON_TSX = `import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95",
  secondary: "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--surface-subtle)]",
  quiet: "bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-subtle)]",
  danger: "bg-[var(--danger)] text-white hover:brightness-95",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-11 px-5 text-sm",
  icon: "size-10 p-0",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-[background-color,color,border-color,opacity,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
`;

const BASE_FIELD_TSX = `import { cloneElement, type InputHTMLAttributes, type ReactElement } from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  className?: string;
}) {
  const descriptionId = hint || error ? htmlFor + "-description" : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {cloneElement(children, {
        id: children.props.id || htmlFor,
        "aria-describedby": children.props["aria-describedby"] || descriptionId,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })}
      {error || hint ? (
        <p id={descriptionId} className={cn("text-xs leading-relaxed", error ? "text-[var(--danger)]" : "text-[var(--muted)]")}>
          {error || hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
`;

const BASE_SKELETON_TSX = `import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-subtle)] motion-reduce:animate-none", className)}
    />
  );
}
`;

const BASE_EMPTY_STATE_TSX = `import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mx-auto flex max-w-md flex-col items-center py-16 text-center", className)}>
      {icon ? <div className="mb-4 text-[var(--muted)]" aria-hidden="true">{icon}</div> : null}
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
`;

const BASE_LAYOUT_TSX = `import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "App Workspace",
  description: "Full-stack Next.js application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={\`\${geistSans.variable} \${geistMono.variable}\`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
`;

const BASE_PAGE_TSX = `export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col items-start justify-center gap-4 px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--muted)]">
        Workspace Ready
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Your application preview is online
      </h1>
      <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">
        Building the requested screens, data models, and interactive flows now…
      </p>
    </main>
  );
}
`;

const BASE_LOADING_TSX = `export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6" role="status" aria-live="polite">
      <p className="text-sm text-[var(--muted)]">Loading application…</p>
    </div>
  );
}
`;

const BASE_ERROR_TSX = `"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex min-h-10 items-center rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)]"
      >
        Try again
      </button>
    </main>
  );
}
`;

const BASE_NOT_FOUND_TSX = `import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6 py-16">
      <p className="font-mono text-xs tabular-nums text-[var(--muted)]">404</p>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        The page you requested does not exist or may have moved.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium"
      >
        Return home
      </Link>
    </main>
  );
}
`;

const BASE_HEALTH_ROUTE = `export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, timestamp: new Date().toISOString() });
}
`;

const DB_CLIENT_TS = `import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured. Enable the database in Cloud settings.");
}

const globalForDb = globalThis as unknown as { __appPgPool?: Pool };

export const pool =
  globalForDb.__appPgPool ??
  new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });

pool.on("error", (err) => {
  console.error("[db] Unexpected PostgreSQL pool error:", err.message);
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__appPgPool = pool;
}

export const db = drizzle(pool, { schema });
`;

const DB_DRIZZLE_CONFIG_TS = `import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
`;

export const DATABASE_ONLY_SCHEMA_TS = `import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appItems = pgTable("app_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
`;

export const DATABASE_WITH_AUTH_SCHEMA_TS = `import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
`;

const AUTH_SERVER_TS = `import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./schema";

const isHostedHttps =
  process.env.NODE_ENV === "production" ||
  process.env.COGNIX_HOSTED_PREVIEW === "1" ||
  process.env.CI === "1";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
  },
  trustedOrigins: (request) => {
    const origins = new Set<string>(["http://localhost:3000"]);
    if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
    const originHeader = request?.headers.get("origin");
    if (originHeader) origins.add(originHeader);
    const forwardedHost = request?.headers.get("x-forwarded-host") || request?.headers.get("host");
    if (forwardedHost) {
      const proto = request?.headers.get("x-forwarded-proto") || (isHostedHttps ? "https" : "http");
      origins.add(\`\${proto}://\${forwardedHost}\`);
    }
    return [...origins];
  },
  advanced: isHostedHttps
    ? {
        useSecureCookies: true,
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
          partitioned: true,
        },
      }
    : undefined,
  plugins: [nextCookies()],
});
`;

const AUTH_CLIENT_TS = `"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : (process.env.BETTER_AUTH_URL || "http://localhost:3000"),
});
`;

const AUTH_ROUTE_TS = `import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
`;

const AUTH_SIGN_IN_PAGE = `"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message || "Unable to sign in. Check your email and password.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error while signing in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Enter your email and password to continue.</p>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--muted)]">
        Need an account?{" "}
        <Link href="/sign-up" className="underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
`;

const AUTH_SIGN_UP_PAGE = `"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (result.error) {
        setError(result.error.message || "Unable to create your account. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error while creating your account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Start using your workspace in seconds.</p>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span>Name</span>
          <input
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
`;

const STORAGE_LIB_TS = `import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION || "auto";
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const s3 =
  bucket && endpoint && accessKeyId && secretAccessKey
    ? new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        credentials: { accessKeyId, secretAccessKey },
      })
    : null;

export function buildSafeObjectKey(ownerPrefix: string, fileName: string) {
  const safeName =
    fileName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file";
  return \`\${ownerPrefix.replace(/^\\/+|\\/+$/g, "")}/\${crypto.randomUUID()}-\${safeName}\`;
}

export function getAppFileUrl(key: string, options?: { download?: boolean; fileName?: string }) {
  const cleanKey = key.replace(/^\\/+/, "");
  const base = \`/api/storage/file/\${cleanKey.split("/").map(encodeURIComponent).join("/")}\`;
  if (!options?.download) return base;
  const params = new URLSearchParams({ download: "1" });
  if (options.fileName) params.set("name", options.fileName);
  return \`\${base}?\${params.toString()}\`;
}

export async function uploadObject(input: { key: string; body: Buffer | Uint8Array; contentType: string }) {
  if (!s3 || !bucket) {
    throw new Error("Object storage is not configured.");
  }
  if (input.body.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 50 MB upload limit.");
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType || "application/octet-stream",
    }),
  );
  return { key: input.key, size: input.body.byteLength };
}

export async function getStoredObject(key: string) {
  if (!s3 || !bucket) {
    throw new Error("Object storage is not configured.");
  }
  return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key.replace(/^\\/+/, "") }));
}

export async function deleteStoredObject(key: string) {
  if (!s3 || !bucket || !key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key.replace(/^\\/+/, "") }));
}
`;

const STORAGE_UPLOAD_ROUTE = `import { buildSafeObjectKey, getAppFileUrl, MAX_UPLOAD_BYTES, uploadObject } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Select a file to upload." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "Files must be 50 MB or smaller." }, { status: 400 });
    }
    const key = buildSafeObjectKey("uploads", file.name);
    await uploadObject({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
    });
    return Response.json({
      key,
      url: getAppFileUrl(key),
      size: file.size,
      contentType: file.type || "application/octet-stream",
      name: file.name,
    });
  } catch (error) {
    console.error("[storage/upload]", error);
    return Response.json({ error: "Could not upload file. Please try again." }, { status: 500 });
  }
}
`;

const STORAGE_FILE_ROUTE = `import { getStoredObject } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key } = await context.params;
    const objectKey = key.map(decodeURIComponent).join("/");
    if (!objectKey || objectKey.includes("..")) {
      return Response.json({ error: "Invalid file path." }, { status: 400 });
    }
    const result = await getStoredObject(objectKey);
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      return Response.json({ error: "File not found." }, { status: 404 });
    }
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "1";
    const fileName = (url.searchParams.get("name") || objectKey.split("/").pop() || "file").replace(/["\\r\\n]/g, "_");
    const contentType = result.ContentType || "application/octet-stream";
    const forceAttachment = download || /svg|html|xml/i.test(contentType);

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
        ...(forceAttachment ? { "Content-Disposition": \`attachment; filename="\${fileName}"\` } : {}),
      },
    });
  } catch (error) {
    console.error("[storage/file]", error);
    return Response.json({ error: "Could not load file." }, { status: 404 });
  }
}
`;

const EMAIL_LIB_TS = `import "server-only";
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
const resend = apiKey ? new Resend(apiKey) : null;

export const isEmailConfigured = Boolean(resend && from);

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}) {
  if (!resend || !from) {
    return { skipped: true as const };
  }
  const result = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? \`<p>\${escapeHtml(input.text)}</p>\`,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  return { skipped: false as const, id: result.data?.id ?? null };
}
`;

export const PROFILE_OVERLAYS: Record<ScaffoldProfile, ProfileOverlayDefinition> = {
  base: {
    dependencies: {
      clsx: "2.1.1",
      "lucide-react": "0.511.0",
      next: "15.5.4",
      react: "19.1.0",
      "react-dom": "19.1.0",
      "server-only": "0.0.1",
      "tailwind-merge": "3.3.0",
      zod: "3.25.76",
    },
    devDependencies: {
      "@tailwindcss/postcss": "4.1.11",
      "@types/node": "22.15.30",
      "@types/react": "19.1.8",
      "@types/react-dom": "19.1.6",
      tailwindcss: "4.1.11",
      typescript: "5.8.3",
    },
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      typecheck: "tsc --noEmit",
    },
    files: [
      { path: "tsconfig.json", content: BASE_TSCONFIG },
      { path: "next.config.ts", content: BASE_NEXT_CONFIG },
      { path: "postcss.config.mjs", content: BASE_POSTCSS_CONFIG },
      { path: "src/app/globals.css", content: BASE_GLOBALS_CSS },
      { path: "src/app/layout.tsx", content: BASE_LAYOUT_TSX },
      { path: "src/app/page.tsx", content: BASE_PAGE_TSX },
      { path: "src/app/loading.tsx", content: BASE_LOADING_TSX },
      { path: "src/app/error.tsx", content: BASE_ERROR_TSX },
      { path: "src/app/not-found.tsx", content: BASE_NOT_FOUND_TSX },
      { path: "src/app/api/health/route.ts", content: BASE_HEALTH_ROUTE },
      { path: "src/lib/cn.ts", content: BASE_CN_TS },
      { path: "src/components/ui/button.tsx", content: BASE_BUTTON_TSX },
      { path: "src/components/ui/field.tsx", content: BASE_FIELD_TSX },
      { path: "src/components/ui/skeleton.tsx", content: BASE_SKELETON_TSX },
      { path: "src/components/ui/empty-state.tsx", content: BASE_EMPTY_STATE_TSX },
    ],
  },
  database: {
    dependencies: {
      "drizzle-orm": "0.44.2",
      pg: "8.16.3",
    },
    devDependencies: {
      "@types/pg": "8.15.4",
      "drizzle-kit": "0.31.4",
    },
    scripts: {
      "db:generate": "drizzle-kit generate",
      "db:push": "drizzle-kit push --force",
    },
    files: [
      { path: "src/lib/db.ts", content: DB_CLIENT_TS },
      { path: "src/lib/schema.ts", content: DATABASE_ONLY_SCHEMA_TS },
      { path: "drizzle.config.ts", content: DB_DRIZZLE_CONFIG_TS },
    ],
  },
  auth: {
    dependencies: {
      "better-auth": "1.3.7",
    },
    devDependencies: {},
    scripts: {},
    files: [
      { path: "src/lib/auth.ts", content: AUTH_SERVER_TS },
      { path: "src/lib/auth-client.ts", content: AUTH_CLIENT_TS },
      { path: "src/app/api/auth/[...all]/route.ts", content: AUTH_ROUTE_TS },
      { path: "src/app/sign-in/page.tsx", content: AUTH_SIGN_IN_PAGE },
      { path: "src/app/sign-up/page.tsx", content: AUTH_SIGN_UP_PAGE },
    ],
  },
  storage: {
    dependencies: {
      "@aws-sdk/client-s3": "3.840.0",
    },
    devDependencies: {},
    scripts: {},
    files: [
      { path: "src/lib/storage.ts", content: STORAGE_LIB_TS },
      { path: "src/app/api/storage/upload/route.ts", content: STORAGE_UPLOAD_ROUTE },
      { path: "src/app/api/storage/file/[...key]/route.ts", content: STORAGE_FILE_ROUTE },
    ],
  },
  email: {
    dependencies: {
      resend: "4.6.0",
    },
    devDependencies: {},
    scripts: {},
    files: [{ path: "src/lib/email.ts", content: EMAIL_LIB_TS }],
  },
};
