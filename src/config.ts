import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export type Config = {
  port: number;
  databaseUrl?: string;
  corsOrigin: string[];
  openAiApiKey?: string;
  embeddingModel: string;
  publicApiRateLimit: {
    max: number;
    windowMs: number;
  };
  publicApiStrictRateLimit: {
    max: number;
    windowMs: number;
  };
  trustProxy: boolean;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUBLIC_API_RATE_LIMIT_MAX = 120;
const DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_MAX = 20;

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174'
];

export function loadConfig(): Config {
  return {
    port: readPort(),
    databaseUrl: process.env.LUDORA_DATABASE_URL,
    corsOrigin: readCorsOrigins(),
    openAiApiKey: readOptionalEnv('OPENAI_API_KEY'),
    embeddingModel: readOptionalEnv('OPENAI_EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL,
    publicApiRateLimit: {
      windowMs: readPositiveIntegerEnv(
        'PUBLIC_API_RATE_LIMIT_WINDOW_MS',
        DEFAULT_PUBLIC_API_RATE_LIMIT_WINDOW_MS
      ),
      max: readPositiveIntegerEnv('PUBLIC_API_RATE_LIMIT_MAX', DEFAULT_PUBLIC_API_RATE_LIMIT_MAX)
    },
    publicApiStrictRateLimit: {
      windowMs: readPositiveIntegerEnv(
        'PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS',
        DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS
      ),
      max: readPositiveIntegerEnv('PUBLIC_API_STRICT_RATE_LIMIT_MAX', DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_MAX)
    },
    trustProxy: readBooleanEnv('TRUST_PROXY', false)
  };
}

function readPort(): number {
  const rawPort = process.env.PORT ?? '4000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return port;
}

function readCorsOrigins(): string[] {
  const rawOrigins = process.env.CORS_ORIGIN;
  if (!rawOrigins) {
    return DEFAULT_CORS_ORIGINS;
  }

  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? uniqueOrigins([...origins, ...DEFAULT_CORS_ORIGINS]) : DEFAULT_CORS_ORIGINS;
}

function uniqueOrigins(origins: string[]): string[] {
  return Array.from(new Set(origins));
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim();
  const value = rawValue ? Number(rawValue) : defaultValue;

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) {
    return defaultValue;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
