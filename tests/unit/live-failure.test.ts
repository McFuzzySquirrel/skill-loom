import { describe, expect, it } from 'vitest';
import { classifyFailure } from '../../scripts/live-failure.js';

describe('live harness failure classification', () => {
  it('identifies DNS and network errors even when the CLI suggests logging in', () => {
    expect(classifyFailure('dns error: failed to lookup address information: ENOTFOUND\nRun copilot login'))
      .toBe('network');
    for (const error of ['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'Could not resolve host']) {
      expect(classifyFailure(error)).toBe('network');
    }
  });

  it('preserves authentication, trust, quota, and generic command classifications', () => {
    expect(classifyFailure('not authenticated')).toBe('auth');
    expect(classifyFailure('untrusted folder')).toBe('trust');
    expect(classifyFailure('rate limit reached')).toBe('limit');
    expect(classifyFailure('unsupported flag')).toBe('command');
  });
});
