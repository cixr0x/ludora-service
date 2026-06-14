import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export type Config = {
  port: number;
  databaseUrl?: string;
  corsOrigin: string[];
  openAiApiKey?: string;
  embeddingModel: string;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

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
    embeddingModel: readOptionalEnv('OPENAI_EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL
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

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
