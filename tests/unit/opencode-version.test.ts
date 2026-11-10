import { describe, expect, it } from 'vitest';
import { supportsOpenCodeVersion } from '../../scripts/opencode-version.js';

describe('OpenCode minimum version', () => {
  it.each(['2.2.5', '2.2.6', '2.2.10', '2.10.0', '3.0.0', '2.2.5+build.1'])(
    'accepts stable version %s',
    (version) => expect(supportsOpenCodeVersion(version)).toBe(true),
  );
  it.each([null, '', '2.0.32', '2.2.4', '1.99.99', '2.2.5-rc.1', '3.0.0-beta.1', 'invalid'])(
    'rejects unsupported version %s',
    (version) => expect(supportsOpenCodeVersion(version)).toBe(false),
  );
});
