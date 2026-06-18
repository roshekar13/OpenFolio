import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Single backend root — all env files live here (Render Root Directory: backend). */
const backendRoot = path.resolve(__dirname, "..");

const ENV_FILES = [
  path.join(backendRoot, ".env"),
  path.join(backendRoot, "atlas-credentials.env"),
] as const;

/** Trim Render/dashboard values; treat blank or quoted-empty as unset. */
export function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let value = raw.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || undefined;
}

export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function applyEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Load .env and atlas-credentials.env from the backend root (never commit those files). */
export function loadServerEnv(): void {
  for (const file of ENV_FILES) {
    applyEnvFile(file);
  }
  const mongoUri =
    sanitizeEnvValue(process.env.OPENFOLIO_MONGO_URI) ??
    sanitizeEnvValue(process.env.MONGODB_URI) ??
    sanitizeEnvValue(process.env.MONGO_URI);
  if (mongoUri) {
    process.env.OPENFOLIO_MONGO_URI = mongoUri;
  }
}

export function resolveMongoUri(): string | undefined {
  loadServerEnv();
  return sanitizeEnvValue(process.env.OPENFOLIO_MONGO_URI);
}

export function resolveMongoUriOrDefault(): string {
  return resolveMongoUri() ?? "mongodb://localhost:27017";
}

export function resolveMongoDbName(): string {
  loadServerEnv();
  return sanitizeEnvValue(process.env.OPENFOLIO_MONGO_DB) ?? "openfolio";
}

export function assertProductionMongoConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error(
      "Missing MongoDB URI in production. Set MONGO_URI (or OPENFOLIO_MONGO_URI) on Render to your Atlas connection string."
    );
  }
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error(
      "MongoDB URI must start with mongodb:// or mongodb+srv://. Copy the full Atlas connection string (no surrounding quotes)."
    );
  }
}

export function resolveBackendRoot(): string {
  return backendRoot;
}
