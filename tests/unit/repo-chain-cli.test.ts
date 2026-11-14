import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/server/cli.js';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function commandStreams(input = '') {
  let stdout = '';
  let stderr = '';
  return {
    stdin: Readable.from([input]),
    stdout: { write: (value: string) => { stdout += value; return true; }, isTTY: false },
    stderr: { write: (value: string) => { stderr += value; return true; } },
    output: () => stdout,
    errors: () => stderr,
  };
}

describe('repository chain CLI', () => {
  it('creates, reads, validates, and copies a tracked repo chain without starting the service', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-repo-chain-cli-'));
    const draft = {
      name: 'Repo review',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review the changes.' }],
      inputs: [],
    };
    const createStreams = commandStreams(JSON.stringify({ draft }));
    expect(await runCli(
      ['chain', 'repo', 'create', '--repo', root],
      { ...createStreams, env: {} },
    )).toBe(0);
    expect(createStreams.errors()).toBe('');
    const created = JSON.parse(createStreams.output()) as { result: { chain: { id: string } } };
    const chainId = created.result.chain.id;
    expect(await readFile(join(root, 'chains', `${chainId}.json`), 'utf8')).toContain('"version": 3');

    const showStreams = commandStreams();
    expect(await runCli(
      ['chain', 'repo', 'show', '--repo', root, '--id', chainId],
      { ...showStreams, env: {} },
    )).toBe(0);
    expect(JSON.parse(showStreams.output())).toMatchObject({
      ok: true,
      result: { chain: { id: chainId, name: 'Repo review' }, publication: null },
    });

    const validateStreams = commandStreams();
    expect(await runCli(
      ['chain', 'repo', 'validate', '--repo', root, '--id', chainId],
      { ...validateStreams, env: {} },
    )).toBe(0);
    expect(JSON.parse(validateStreams.output())).toMatchObject({
      ok: true,
      result: { valid: true, chain: { id: chainId } },
    });

    const copyStreams = commandStreams();
    expect(await runCli(
      ['chain', 'repo', 'copy', '--repo', root, '--id', chainId],
      { ...copyStreams, env: {} },
    )).toBe(0);
    expect(JSON.parse(copyStreams.output())).toMatchObject({
      ok: true,
      result: { chain: { name: 'Repo review copy' }, publication: null },
    });
    const listStreams = commandStreams();
    expect(await runCli(['chain', 'repo', 'list', '--repo', root], { ...listStreams, env: {} })).toBe(0);
    expect(JSON.parse(listStreams.output())).toMatchObject({
      ok: true,
      result: { chains: expect.arrayContaining([
        expect.objectContaining({ id: chainId }),
        expect.objectContaining({ name: 'Repo review copy' }),
      ]) },
    });
  });
});
