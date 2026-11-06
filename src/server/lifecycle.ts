import { randomBytes } from 'node:crypto';

export type ServerLifecycleState = 'running' | 'stopping' | 'stopped' | 'failed';

/** One server instance's explicit, idempotent shutdown contract. */
export class ServerLifecycle {
  readonly token = randomBytes(32).toString('base64url');
  private stateValue: ServerLifecycleState = 'running';
  private shutdownHandler: (() => Promise<void>) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private responseBarrier: Promise<void> = Promise.resolve();

  get state(): ServerLifecycleState {
    return this.stateValue;
  }

  setShutdownHandler(handler: () => Promise<void>): void {
    if (this.shutdownHandler !== null) {
      throw new Error('The server shutdown handler is already configured.');
    }
    this.shutdownHandler = handler;
  }

  beginShutdown(): boolean {
    if (this.stateValue !== 'running') {
      return false;
    }
    this.stateValue = 'stopping';
    return true;
  }

  deferShutdownUntil(responseFlushed: Promise<void>): void {
    if (this.stateValue !== 'stopping' || this.shutdownPromise !== null) {
      throw new Error('A response barrier can only be set before shutdown starts.');
    }
    this.responseBarrier = responseFlushed;
  }

  cancelUnflushedShutdown(): void {
    if (this.stateValue === 'stopping' && this.shutdownPromise === null) {
      this.stateValue = 'running';
      this.responseBarrier = Promise.resolve();
    }
  }

  stop(): Promise<void> {
    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }
    if (this.stateValue === 'stopped') {
      return Promise.resolve();
    }
    if (this.shutdownHandler === null) {
      return Promise.reject(new Error('The server shutdown handler is not configured.'));
    }

    this.stateValue = 'stopping';
    this.shutdownPromise = this.responseBarrier.then(() => this.shutdownHandler?.()).then(
      () => {
        this.stateValue = 'stopped';
      },
      (error: unknown) => {
        this.stateValue = 'failed';
        throw error;
      },
    );
    return this.shutdownPromise;
  }
}
