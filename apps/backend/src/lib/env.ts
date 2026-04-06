import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.optional(),
  SUPABASE_URL: z.string().trim().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  ALLOWED_ORIGINS: z.string().trim().optional()
});

export interface BackendEnv {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  geminiApiKey: string;
  allowedOrigins: string[];
}

let cachedEnv: BackendEnv | undefined;

function splitAllowedOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function assertRequiredInProduction(env: BackendEnv): void {
  if (!env.isProduction) {
    return;
  }

  const missing: string[] = [];
  if (!env.supabaseUrl) {
    missing.push("SUPABASE_URL");
  }
  if (!env.supabaseServiceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!env.geminiApiKey) {
    missing.push("GEMINI_API_KEY");
  }
  if (!env.allowedOrigins.length) {
    missing.push("ALLOWED_ORIGINS");
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables in production: ${missing.join(", ")}`);
  }
}

export function getEnv(): BackendEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.parse(process.env);
  const nodeEnv = nodeEnvSchema.parse(parsed.NODE_ENV);
  const allowedOrigins = splitAllowedOrigins(parsed.ALLOWED_ORIGINS ?? "");

  const env: BackendEnv = {
    nodeEnv,
    isProduction: nodeEnv === "production",
    supabaseUrl: parsed.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY ?? "",
    geminiApiKey: parsed.GEMINI_API_KEY ?? "",
    allowedOrigins
  };

  assertRequiredInProduction(env);
  cachedEnv = Object.freeze(env);
  return cachedEnv;
}

export function resetEnvForTests(): void {
  cachedEnv = undefined;
}
