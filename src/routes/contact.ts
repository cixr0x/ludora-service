import { Router } from 'express';

import type { Database } from '../db.js';

type ContactRequestBody = {
  email?: unknown;
  message?: unknown;
  name?: unknown;
};

type InsertedContactSubmission = {
  id?: unknown;
};

export function createContactRouter(database: Database): Router {
  const router = Router();

  router.post('/contact', async (request, response, next) => {
    try {
      const submission = contactSubmissionFromBody(request.body as ContactRequestBody);
      const result = await database.query(contactSubmissionInsertSql, [
        submission.name,
        submission.email,
        submission.message
      ]);
      const row = result.rows[0] as InsertedContactSubmission | undefined;

      response.status(201).json({ data: { id: row?.id } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const contactSubmissionInsertSql = `
  insert into contact_form_submissions (name, email, message)
  values ($1, $2, $3)
  returning id
`;

function contactSubmissionFromBody(body: ContactRequestBody) {
  const name = textField(body.name);
  const email = textField(body.email);
  const message = textField(body.message);

  if (!name || !validEmail(email) || !message) {
    throw httpError(400, 'name, a valid email, and message are required');
  }

  return { email, message, name };
}

function textField(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}
