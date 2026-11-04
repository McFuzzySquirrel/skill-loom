/**
 * Typed WebSocket protocol for the server-owned PTY transport.
 *
 * The browser never sends a command, a path, or an executable. A runner owns
 * session creation on the server; the client only attaches to an existing
 * session id, writes terminal input, and requests a resize.
 */

/** Stable transport error codes carried in `error` messages and close reasons. */
export const TERMINAL_ERROR_CODES = {
  INVALID_MESSAGE: 'TERMINAL_INVALID_MESSAGE',
  INVALID_SPEC: 'TERMINAL_INVALID_SPEC',
  SPAWN_FAILED: 'TERMINAL_SPAWN_FAILED',
  NOT_FOUND: 'TERMINAL_NOT_FOUND',
  SUBSCRIBER_CONFLICT: 'TERMINAL_SUBSCRIBER_CONFLICT',
  NOT_RUNNING: 'TERMINAL_NOT_RUNNING',
  INTERNAL_ERROR: 'TERMINAL_INTERNAL_ERROR',
} as const;

export type TerminalErrorCode =
  (typeof TERMINAL_ERROR_CODES)[keyof typeof TERMINAL_ERROR_CODES];

/** Messages the server sends to the single terminal subscriber. */
export type TerminalServerMessage =
  | {
      type: 'ready';
      sessionId: string;
      pid: number;
      cols: number;
      rows: number;
    }
  | {
      type: 'output';
      /** Raw PTY text, rendered by xterm.js and never as HTML. */
      data: string;
    }
  | {
      type: 'exit';
      exitCode: number;
      signal?: number;
    }
  | {
      type: 'error';
      code: TerminalErrorCode;
      message: string;
    };

/** Messages the single terminal subscriber may send to the server. */
export type TerminalClientMessage =
  | {
      type: 'input';
      data: string;
    }
  | {
      type: 'resize';
      cols: number;
      rows: number;
    };
