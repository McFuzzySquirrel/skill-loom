import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { createGlobalDraftService, DraftPayloadSchema } from '../chains/drafts.js';
import type { ChainDraft, ChainService } from '../chains/service.js';
import {
  CHAIN_ID_PATTERN,
} from '../chains/store.js';
import type { ConfigStore } from '../config/store.js';
import { chainListResponse, chainResponse, chainRevisionHeader, sendChainFailure } from './chains.js';

const draftPayloadSchema = DraftPayloadSchema;

export interface DraftRoutesOptions {
  configStore: ConfigStore;
  draftService?: ChainService;
  getDraftService?: () => ChainService;
}

interface DraftParams {
  draftId: string;
}

export const draftRoutes: FastifyPluginAsync<DraftRoutesOptions> = async (
  app,
  options,
) => {
  let service = options.draftService;
  const getConfigDirectory = () => options.configStore.getConfigDir();
  const getDraftService = () => {
    service ??= options.getDraftService?.() ?? createGlobalDraftService(getConfigDirectory());
    return service;
  };
  app.get('/api/drafts', async (_request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      const result = await getDraftService().list(configDirectory);
      return reply.code(200).send(chainListResponse(result));
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.get<{ Params: DraftParams }>('/api/drafts/:draftId', async (request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      const chain = await getDraftService().get(configDirectory, request.params.draftId);
      return reply.code(200).send(chainResponse(chain));
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.post('/api/drafts', async (request, reply) => {
    const parsed = draftPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The draft request is not valid.', parsed.error.issues);
    }

    try {
      const configDirectory = getConfigDirectory();
      const chain = await getDraftService().create(configDirectory, toDraft(parsed.data));
      return reply.code(201).send(chainResponse(chain));
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.put<{ Params: DraftParams }>('/api/drafts/:draftId', async (request, reply) => {
    if (!CHAIN_ID_PATTERN.test(request.params.draftId)) {
      return reply.code(422).send(
        createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The draft id is not valid.'),
      );
    }
    const parsed = draftPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The draft request is not valid.', parsed.error.issues);
    }

    try {
      const configDirectory = getConfigDirectory();
      const revision = chainRevisionHeader(request.headers);
      const chain = await getDraftService().update(
        configDirectory,
        request.params.draftId,
        toDraft(parsed.data),
        { expectedRevision: revision },
      );
      return reply.code(200).send(chainResponse(chain));
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });
};

function toDraft(body: z.infer<typeof draftPayloadSchema>): ChainDraft {
  return {
    name: body.name,
    harness: body.harness,
    sessionMode: body.sessionMode,
    steps: body.steps,
    inputs: body.inputs ?? [],
    automaticPermissionOptIn: body.automaticPermissionOptIn ?? false,
    ...(body.agent === undefined ? {} : { agent: body.agent }),
  };
}

function sendValidationFailure(
  reply: FastifyReply,
  message: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): FastifyReply {
  const validationIssues: ApiValidationIssue[] = issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  return reply.code(422).send(
    createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, message, {
      issues: validationIssues,
    }),
  );
}
