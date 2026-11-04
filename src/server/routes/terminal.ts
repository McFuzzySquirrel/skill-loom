import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  TERMINAL_ERROR_CODES,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from '../../shared/terminal.js';
import {
  TerminalSubscriberConflictError,
  TerminalTransportError,
  type TerminalAttachment,
  type TerminalManager,
  type TerminalSubscriber,
} from '../terminal/pty.js';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_DIMENSION = 1_000;
const WS_OPEN = 1;

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('input'),
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(1).max(MAX_DIMENSION),
    rows: z.number().int().min(1).max(MAX_DIMENSION),
  }),
]);

/** The minimal WebSocket surface the route needs, kept structural for testing. */
interface TerminalSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export interface TerminalRouteOptions {
  terminalManager: TerminalManager;
}

interface TerminalRouteParams {
  sessionId: string;
}

/**
 * `WS /api/terminal/:sessionId` — attach to a server-created PTY.
 *
 * The client cannot create a process, choose an executable, or supply a path.
 * It may only write terminal input and request a resize for an existing session.
 */
export const terminalRoutes: FastifyPluginAsync<TerminalRouteOptions> = async (app, options) => {
  app.get<{ Params: TerminalRouteParams }>(
    '/api/terminal/:sessionId',
    { websocket: true },
    (rawSocket, request) => {
      const socket = rawSocket as unknown as TerminalSocket;
      const subscriber = createSocketSubscriber(socket);

      let attachment: TerminalAttachment;
      try {
        attachment = options.terminalManager.attach(request.params.sessionId, subscriber);
      } catch (error) {
        sendAttachmentFailure(app, socket, subscriber, request.params.sessionId, error);
        return;
      }

      let finalized = false;
      const finalize = (): void => {
        if (finalized) {
          return;
        }
        finalized = true;
        attachment.detach({ terminate: true });
      };

      socket.on('close', finalize);
      socket.on('error', finalize);

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          sendProtocolError(subscriber, 'Terminal messages must be JSON text frames.');
          return;
        }

        const text = typeof data === 'string' ? data : rawDataToText(data);
        if (text === null) {
          sendProtocolError(subscriber, 'Terminal messages must be JSON text frames.');
          return;
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(text) as unknown;
        } catch {
          sendProtocolError(subscriber, 'Terminal message is not valid JSON.');
          return;
        }

        const parsed = clientMessageSchema.safeParse(decoded);
        if (!parsed.success) {
          sendProtocolError(subscriber, 'Terminal message does not match the transport protocol.');
          return;
        }

        if (
          parsed.data.type === 'input' &&
          Buffer.byteLength(parsed.data.data, 'utf8') > MAX_INPUT_BYTES
        ) {
          sendProtocolError(subscriber, 'Terminal input is too large.');
          return;
        }

        try {
          handleClientMessage(attachment, parsed.data);
        } catch {
          subscriber.send({
            type: 'error',
            code: TERMINAL_ERROR_CODES.NOT_RUNNING,
            message: 'The terminal process is no longer running.',
          });
        }
      });
    },
  );
};

function handleClientMessage(attachment: TerminalAttachment, message: TerminalClientMessage): void {
  if (message.type === 'input') {
    if (message.data !== '') {
      attachment.session.write(message.data);
    }
    return;
  }

  attachment.session.resize(message.cols, message.rows);
}

function createSocketSubscriber(socket: TerminalSocket): TerminalSubscriber {
  return {
    send(message: TerminalServerMessage): void {
      if (socket.readyState !== WS_OPEN) {
        return;
      }
      socket.send(JSON.stringify(message));
    },
    close(code = 1000, reason = ''): void {
      if (socket.readyState !== WS_OPEN) {
        return;
      }
      socket.close(code, reason);
    },
  };
}

function sendProtocolError(subscriber: TerminalSubscriber, message: string): void {
  subscriber.send({
    type: 'error',
    code: TERMINAL_ERROR_CODES.INVALID_MESSAGE,
    message,
  });
}

function sendAttachmentFailure(
  app: { log: { warn: (details: Record<string, unknown>, message: string) => void } },
  socket: TerminalSocket,
  subscriber: TerminalSubscriber,
  sessionId: string,
  error: unknown,
): void {
  if (error instanceof TerminalSubscriberConflictError) {
    subscriber.send({
      type: 'error',
      code: TERMINAL_ERROR_CODES.SUBSCRIBER_CONFLICT,
      message: error.message,
    });
    subscriber.close(1008, TERMINAL_ERROR_CODES.SUBSCRIBER_CONFLICT);
    return;
  }

  if (error instanceof TerminalTransportError && error.code === 'TERMINAL_NOT_FOUND') {
    subscriber.send({
      type: 'error',
      code: TERMINAL_ERROR_CODES.NOT_FOUND,
      message: error.message,
    });
    subscriber.close(1008, TERMINAL_ERROR_CODES.NOT_FOUND);
    return;
  }

  app.log.warn({ err: error, sessionId }, 'Terminal attach failed');
  subscriber.send({
    type: 'error',
    code: TERMINAL_ERROR_CODES.INTERNAL_ERROR,
    message: 'The terminal session could not be attached.',
  });
  subscriber.close(1011, TERMINAL_ERROR_CODES.INTERNAL_ERROR);
}

function rawDataToText(data: unknown): string | null {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return null;
}
