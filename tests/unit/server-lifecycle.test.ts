import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ServerLifecycle } from '../../src/server/lifecycle.js';
import { installShutdownHandlers } from '../../src/server/index.js';

describe('ServerLifecycle', () => {
  it('shares one shutdown promise between repeated callers', async () => {
    const lifecycle = new ServerLifecycle();
    const finish = vi.fn(async () => undefined);
    lifecycle.setShutdownHandler(finish);

    const first = lifecycle.stop();
    const second = lifecycle.stop();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe('stopped');
  });

  it('waits for the accepted shutdown response before closing', async () => {
    const lifecycle = new ServerLifecycle();
    let releaseResponse: () => void = () => undefined;
    const responseFlushed = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const finish = vi.fn(async () => undefined);
    lifecycle.setShutdownHandler(finish);
    expect(lifecycle.beginShutdown()).toBe(true);
    lifecycle.deferShutdownUntil(responseFlushed);

    const stopping = lifecycle.stop();
    await Promise.resolve();
    expect(finish).not.toHaveBeenCalled();

    releaseResponse();
    await stopping;
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('passes the shutdown mode to the single cleanup handler', async () => {
    const lifecycle = new ServerLifecycle();
    const finish = vi.fn(async () => undefined);
    lifecycle.setShutdownHandler(finish);

    await lifecycle.stop('non-interactive');

    expect(finish).toHaveBeenCalledWith('non-interactive');
  });

  it('does not prompt on SIGTERM', () => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    installShutdownHandlers(closeable(close), { signals });

    signals.emit('SIGTERM');

    expect(close).toHaveBeenCalledWith('non-interactive');
  });

  it('allows an interactive cleanup decision on SIGINT', () => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    installShutdownHandlers(closeable(close), { signals });

    signals.emit('SIGINT');

    expect(close).toHaveBeenCalledWith('interactive');
  });
});

function closeable(close: (mode: 'interactive' | 'non-interactive') => Promise<void>) {
  return { close };
}
