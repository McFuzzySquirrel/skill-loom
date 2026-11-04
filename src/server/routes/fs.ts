import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import {
  listDirectory,
  type DirectoryListing,
} from '../projects/browser.js';
import {
  FolderPathError,
  type FolderPathErrorCode,
} from '../projects/paths.js';

const MAX_PATH_LENGTH = 4_096;

const listQuerySchema = z.object({
  path: z.string().min(1).max(MAX_PATH_LENGTH),
});

/** Services used by the route; tests inject a fake browser where useful. */
export interface FsRouteOptions {
  /** Directory listing seam. Defaults to the real filesystem browser. */
  listDirectory?: (path: unknown) => Promise<DirectoryListing>;
}

/** HTTP status for each typed folder-browser failure. */
const STATUS_BY_CODE: Record<FolderPathErrorCode, number> = {
  PATH_REQUIRED: 422,
  PATH_NOT_ABSOLUTE: 422,
  PATH_INVALID: 422,
  PATH_NOT_FOUND: 404,
  PATH_NOT_DIRECTORY: 400,
  PATH_UNREADABLE: 403,
};

/**
 * `GET /api/fs?path=` — canonical directory listing for the folder browser.
 *
 * The route validates the query, delegates every filesystem operation to the
 * browser service, and maps typed failures onto the shared error envelope.
 * It never returns file contents and never accepts a client-supplied path for
 * anything other than this read-only listing.
 */
export const fsRoutes: FastifyPluginAsync<FsRouteOptions> = async (app, options) => {
  const list = options.listDirectory ?? listDirectory;

  app.get<{ Querystring: { path?: string } }>('/api/fs', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The folder browser request is not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ),
      );
    }

    try {
      const listing = await list(parsed.data.path);
      return reply.code(200).send(listing);
    } catch (error) {
      if (error instanceof FolderPathError) {
        return reply
          .code(STATUS_BY_CODE[error.code])
          .send(createApiErrorEnvelope(error.code, error.message, error.details));
      }
      throw error;
    }
  });
};

function toValidationIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): ApiValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}
