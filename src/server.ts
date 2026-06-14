import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createOpenAIEmbeddingClient } from './embeddings.js';

const config = loadConfig();

if (!config.databaseUrl) {
  throw new Error('LUDORA_DATABASE_URL is required');
}

const database = createDatabase(config.databaseUrl);
const embeddingClient = config.openAiApiKey
  ? createOpenAIEmbeddingClient({
      apiKey: config.openAiApiKey,
      model: config.embeddingModel
    })
  : undefined;
const app = createApp({
  database,
  corsOrigin: config.corsOrigin,
  embeddingClient,
  embeddingModel: config.embeddingModel
});

const server = app.listen(config.port, () => {
  console.log(`ludora-service listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    void database.close?.();
    process.exit(0);
  });
});
