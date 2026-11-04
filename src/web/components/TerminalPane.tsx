import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalServerMessage } from '../../shared/terminal';

/**
 * Embedded xterm.js pane for the server-owned trust PTY.
 *
 * The terminal is created once per session and disposed on unmount. Only raw
 * PTY text is written to xterm; server output is never interpreted as HTML.
 * Screen-reader mode is enabled, and Escape deliberately leaves the terminal
 * so a keyboard user is never stranded inside it.
 */

export interface TerminalPaneProps {
  /** Server-created PTY session id. */
  sessionId: string;
  /** WebSocket path published by the trust start response. */
  terminalPath: string;
  /** Accessible name for the terminal region. */
  label: string;
  /** Called when Escape leaves the terminal. */
  onExitFocus?: () => void;
}

const WS_OPEN = 1;

export function TerminalPane({
  sessionId,
  terminalPath,
  label,
  onExitFocus,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
      theme: {
        background: '#05080c',
        foreground: '#eef3f8',
        cursor: '#8be9a8',
        selectionBackground: '#2b4a36',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(container);

    const fit = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // A hidden or zero-sized container cannot be measured yet.
      }
    };

    let disposed = false;
    let socket: WebSocket | null = null;

    const send = (message: unknown): void => {
      if (socket !== null && socket.readyState === WS_OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    // Deferring the connection by one task prevents React StrictMode's
    // development mount/unmount pair from opening two subscriptions.
    const connectTimer = window.setTimeout(() => {
      if (disposed) {
        return;
      }

      const url = new URL(terminalPath, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url.toString());

      socket.addEventListener('open', () => {
        if (disposed) {
          return;
        }
        fit();
        send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      });

      socket.addEventListener('message', (event) => {
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
          terminal.write(
            `\r\n[trust session ended with exit code ${String(message.exitCode)}]\r\n`,
          );
          return;
        }
        if (message.type === 'error') {
          terminal.write(`\r\n[terminal error: ${message.message}]\r\n`);
        }
      });

      socket.addEventListener('close', () => {
        if (!disposed) {
          terminal.write('\r\n[trust terminal disconnected]\r\n');
        }
      });
    }, 0);

    const dataDisposable = terminal.onData((data) => {
      send({ type: 'input', data });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      send({ type: 'resize', cols, rows });
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      terminal.blur();
      onExitFocusRef.current?.();
    };
    container.addEventListener('keydown', handleKeyDown, true);

    const resizeObserver = new ResizeObserver(() => {
      fit();
    });
    resizeObserver.observe(container);
    fit();

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      resizeObserver.disconnect();
      container.removeEventListener('keydown', handleKeyDown, true);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      socket?.close();
      socket = null;
      terminal.dispose();
    };
  }, [sessionId, terminalPath]);

  return (
    <div className="terminal-pane" data-testid="trust-terminal" data-session-id={sessionId}>
      <div
        className="terminal-pane__screen"
        ref={containerRef}
        role="group"
        aria-label={label}
        data-testid="trust-terminal-screen"
      />
      <p className="field__hint">
        Screen-reader mode is on. Press Escape to leave the terminal and return to Verify trust.
        Output is rendered by xterm.js only and is never inserted as HTML.
      </p>
    </div>
  );
}
