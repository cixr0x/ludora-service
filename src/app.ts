import cors from 'cors';
import express, { Router, type ErrorRequestHandler, type Express } from 'express';

import type { Database } from './db.js';
import type { EmbeddingClient } from './embeddings.js';
import { createCatalogRouter } from './routes/catalog.js';
import { createHealthRouter } from './routes/health.js';

type HttpError = Error & {
  status?: number;
  type?: string;
};

type CreateAppOptions = {
  database: Database;
  corsOrigin?: string | string[];
  embeddingClient?: EmbeddingClient;
  embeddingModel?: string;
};

export function createApp({ database, corsOrigin, embeddingClient, embeddingModel }: CreateAppOptions): Express {
  const app = express();
  const api = Router();

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  api.use(createHealthRouter());
  api.use(createCatalogRouter(database, { embeddingClient, embeddingModel }));
  app.use('/api', api);
  app.use(jsonErrorHandler);

  return app;
}

const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (isJsonParseError(error)) {
    response.status(400).json({
      error: {
        message: 'Invalid JSON body'
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  const httpError = error as HttpError;
  const status = typeof httpError.status === 'number' ? httpError.status : 500;

  response.status(status).json({
    error: {
      message
    }
  });
};

function isJsonParseError(error: unknown): error is HttpError {
  const httpError = error as HttpError;
  return error instanceof SyntaxError && httpError.status === 400 && httpError.type === 'entity.parse.failed';
}
