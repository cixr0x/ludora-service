import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

const tooManyRequestsResponse = {
  error: {
    message: 'Too many requests'
  }
};

type RateLimiterFactoryOptions = RateLimitOptions & {
  skip?: Options['skip'];
};

export function createPublicApiRateLimiter(options: RateLimitOptions): RequestHandler {
  return createJsonRateLimiter({
    ...options,
    skip: (request) => request.path === '/health'
  });
}

export function createStrictPublicApiRateLimiter(options: RateLimitOptions): RequestHandler {
  return createJsonRateLimiter(options);
}

function createJsonRateLimiter(options: RateLimiterFactoryOptions): RequestHandler {
  return rateLimit({
    legacyHeaders: false,
    limit: options.max,
    skip: options.skip,
    standardHeaders: 'draft-8',
    windowMs: options.windowMs,
    handler: (_request, response) => {
      response.status(429).json(tooManyRequestsResponse);
    }
  });
}
