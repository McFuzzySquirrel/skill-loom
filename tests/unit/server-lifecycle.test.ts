import { describe, expect, it, vi } from 'vitest';
import { ServerLifecycle } from '../../src/server/lifecycle.js';

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
});
