import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';
import { createApiErrorEnvelope } from '../../shared/api.js';

const archiveName = 'loom-run-bundle.zip';
const routeDirectory = dirname(fileURLToPath(import.meta.url));

async function findArchive(): Promise<Buffer | null> {
  const candidates = [
    resolve(routeDirectory, '../../../skills', archiveName),
    resolve(routeDirectory, '../../../dist/skills', archiveName),
  ];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) return null;
      return await readFile(candidate);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

export const portableSkillRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/portable-skill', async (request, reply) => {
    try {
      const archive = await findArchive();
      if (archive === null) {
        return reply.code(503).send(createApiErrorEnvelope(
          'PORTABLE_SKILL_UNAVAILABLE',
          'The standalone runner skill is not built. Run npm run build:portable-skill and retry.',
        ));
      }
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${archiveName}"`)
        .header('Cache-Control', 'no-store')
        .send(archive);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read the portable skill archive.');
      return reply.code(500).send(createApiErrorEnvelope(
        'PORTABLE_SKILL_UNAVAILABLE',
        'The standalone runner skill could not be read.',
      ));
    }
  });
};
