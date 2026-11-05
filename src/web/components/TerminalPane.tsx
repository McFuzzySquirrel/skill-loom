import { useEffect, useRef, type MouseEvent } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalServerMessage } from '../../shared/terminal';
import { useAppearance } from '../ThemeProvider';

/**
 * xterm.js pane for a server-owned PTY.
 *
 * The terminal is created once per session and disposed on unmount. Only raw
 * PTY text is written to xterm; server output is never interpreted as HTML.
 * Screen-reader mode, Unicode 11, fit, and web links are enabled. Escape
 * deliberately leaves the terminal so a keyboard user is never stranded, and
 * the Escape keystroke is not forwarded to the harness.
 */

export interface TerminalPaneProps {
  /** Server-created PTY session id. */
  sessionId: string;
  /** WebSocket path published by the server (trust or run terminal). */
  terminalPath: string;
  /** Accessible name for the terminal region. */
  label: string;
  /** Called when Escape leaves the terminal. */
  onExitFocus?: () => void;
  /** Root test id; defaults to the trust terminal's original id. */
  testId?: string;
  /** Screen test id; defaults to the trust terminal's original id. */
  screenTestId?: string;
  /** Hint shown below the terminal. */
  exitHint?: string;
  /** Extra class names on the root element. */
  className?: string;
  /** Reattach after a dropped socket (run terminals survive a reload). */
  reconnectOnClose?: boolean;
  /** Hide the long helper paragraphs on the dedicated terminal page. */
  dense?: boolean;
}

const WS_OPEN = 1;

const TERMINAL_THEMES: Record<'light' | 'dark', ITheme> = {
  dark: {
    background: '#05080c',
    foreground: '#eef3f8',
    cursor: '#8be9a8',
    selectionBackground: '#213f60',
    black: '#151b22',
    red: '#ff8a80',
    green: '#8be9a8',
    yellow: '#ffd166',
    blue: '#8fc7ff',
    magenta: '#d7a8ff',
    cyan: '#73e6df',
    white: '#dbe4ed',
    brightBlack: '#647384',
    brightRed: '#ffaaa3',
    brightGreen: '#b8f5c8',
    brightYellow: '#ffe09c',
    brightBlue: '#b4d9ff',
    brightMagenta: '#e6c8ff',
    brightCyan: '#a2f1ec',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#f7f9fb',
    foreground: '#15212d',
    cursor: '#16743f',
    selectionBackground: '#c7d9ec',
    black: '#15212d',
    red: '#a5251c',
    green: '#176a35',
    yellow: '#765300',
    blue: '#175995',
    magenta: '#76439a',
    cyan: '#0a6767',
    white: '#596675',
    brightBlack: '#526171',
    brightRed: '#7d1b14',
    brightGreen: '#0b4e25',
    brightYellow: '#583f00',
    brightBlue: '#104471',
    brightMagenta: '#5e307d',
    brightCyan: '#075252',
    brightWhite: '#3e4a57',
  },
};

export function TerminalPane({
  sessionId,
  terminalPath,
  label,
  onExitFocus,
  testId = 'trust-terminal',
  screenTestId = 'trust-terminal-screen',
  exitHint = 'Screen-reader mode is on. Press Escape to leave the terminal and return to Verify trust. Output is rendered by xterm.js only and is never inserted as HTML.',
  className,
  reconnectOnClose = false,
  dense = false,
}: TerminalPaneProps) {
  const { resolved } = useAppearance();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onExitFocusRef = useRef(onExitFocus);
  onExitFocusRef.current = onExitFocus;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      screenReaderMode: true,
      allowProposedApi: true,
      scrollback: 2_000,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: TERMINAL_THEMES[resolved],
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.loadAddon(new WebLinksAddon());
    terminal.unicode.activeVersion = '11';
    terminal.open(container);
    terminalRef.current = terminal;

    const fit = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // A hidden or zero-sized container cannot be measured yet.
      }
    };

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;
    let sessionEnded = false;

    const send = (message: unknown): void => {
      if (socket !== null && socket.readyState === WS_OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const openSocket = (): void => {
      if (disposed) {
        return;
      }

      const url = new URL(terminalPath, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(url.toString());
      socket = nextSocket;

      nextSocket.addEventListener('open', () => {
        if (disposed) {
          return;
        }
        reconnectAttempts = 0;
        fit();
        send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      });

      nextSocket.addEventListener('message', (event) => {
        if (disposed || typeof event.data !== 'string') {
          return;
        }
        let message: TerminalServerMessage;
        try {
          message = JSON.parse(event.data) as TerminalServerMessage;
        } catch {
          return;
        }

        if (message.type === 'output') {
          terminal.write(message.data);
          return;
        }
        if (message.type === 'exit') {
          sessionEnded = true;
          terminal.write(
            `\r\n[harness process ended with exit code ${String(message.exitCode)}]\r\n`,
          );
          return;
        }
        if (message.type === 'error') {
          terminal.write(`\r\n[terminal error: ${message.message}]\r\n`);
        }
      });

      nextSocket.addEventListener('close', () => {
        if (disposed) {
          return;
        }
        if (reconnectOnClose && !sessionEnded && reconnectAttempts < 8) {
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            openSocket();
          }, 400);
          return;
        }
        terminal.write('\r\n[terminal disconnected]\r\n');
      });
    };

    // Deferring the connection by one task prevents React StrictMode's
    // development mount/unmount pair from opening two subscriptions.
    const connectTimer = window.setTimeout(openSocket, 0);

    const dataDisposable = terminal.onData((data) => {
      send({ type: 'input', data });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      send({ type: 'resize', cols, rows });
    });

    // Returning false stops xterm from sending Escape to the harness while
    // still moving focus back to the control bar.
    const keyHandler = (event: KeyboardEvent): boolean => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        terminal.blur();
        onExitFocusRef.current?.();
        return false;
      }
      return true;
    };
    terminal.attachCustomKeyEventHandler(keyHandler);

    // Only re-fit when the observed size actually changes. Repeated no-op
    // notifications would otherwise re-send resize messages and, on a
    // content-sized container, feed xterm's row count back into its height.
    let lastWidth = 0;
    let lastHeight = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) {
        return;
      }
      if (rect.width === lastWidth && rect.height === lastHeight) {
        return;
      }
      lastWidth = rect.width;
      lastHeight = rect.height;
      fit();
    });
    resizeObserver.observe(container);
    fit();

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      socket?.close();
      socket = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [sessionId, terminalPath, reconnectOnClose]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal !== null) {
      terminal.options.theme = TERMINAL_THEMES[resolved];
    }
  }, [resolved]);

  const handleFocus = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    terminalRef.current?.focus();
  };

  return (
    <div
      className={`terminal-pane${className === undefined ? '' : ` ${className}`}`}
      data-testid={testId}
      data-session-id={sessionId}
    >
      <div className="terminal-pane__toolbar">
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={handleFocus}
          data-testid={`${testId}-focus`}
        >
          Focus terminal
        </button>
        {dense ? null : (
          <p className="field__hint terminal-pane__hint">
            Screen-reader mode, Unicode 11, fit, and web links are enabled. Escape leaves the
            terminal and returns focus to the run controls.
          </p>
        )}
      </div>
      <div className="terminal-pane__screen" ref={containerRef} role="group" aria-label={label} data-testid={screenTestId} />
      {dense ? null : <p className="field__hint">{exitHint}</p>}
    </div>
  );
}
