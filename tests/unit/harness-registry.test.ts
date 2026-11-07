import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAIN_SESSION_MODES,
  type ChainSessionMode,
} from '../../src/server/chains/model.js';
import { HARNESS_IDS } from '../../src/server/config/schema.js';
import {
  createHarnessAdapter,
  createHarnessRegistry,
} from '../../src/server/harness/registry.js';
import {
  COPILOT_AUTOMATIC_PERMISSIONS,
  createCopilotAdapter,
} from '../../src/server/harness/copilot.js';
import { createOpenCodeAdapter } from '../../src/server/harness/opencode.js';
import {
  HARNESS_ERROR_CODES,
  HarnessError,
  type HarnessCommand,
  type StepInvocation,
} from '../../src/server/harness/types.js';

const SESSION_ID = 'ses_01hzy0example';
const COPILOT_SESSION_ID = '7e1d3c7a-4b1e-4f45-9d2f-6b2a0c9d8e11';
const PROMPT = 'Plan "alpha" & beta\nSecond line with spaces.';

let root: string;
let project: string;
let binA: string;
let binB: string;
let opencodePath: string;
let copilotPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-harness-'));
  project = join(root, 'project');
  binA = join(root, 'bin-a');
  binB = join(root, 'bin-b');
  await mkdir(project, { recursive: true });
  await mkdir(binA, { recursive: true });
  await mkdir(binB, { recursive: true });
  opencodePath = await writeExecutable(binA, 'opencode');
  copilotPath = await writeExecutable(binA, 'copilot');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeExecutable(
  directory: string,
  name: string,
  mode = 0o755,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, name);
  await writeFile(target, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(target, mode);
  return target;
}

function pathValue(...directories: string[]): string {
  return directories.join(delimiter);
}

function invocation(overrides: Partial<StepInvocation> = {}): StepInvocation {
  return {
    prompt: PROMPT,
    sessionId: SESSION_ID,
    projectPath: project,
    sessionMode: 'shared',
    ...overrides,
  };
}

function expectHarnessError(
  run: () => unknown,
  code: string,
): HarnessError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    const harnessError = error as HarnessError;
    expect(harnessError.code).toBe(code);
    return harnessError;
  }
  throw new Error(`Expected a ${code} harness error.`);
}

function resolvedRegistry(commands: { opencode?: string; copilot?: string } = {}) {
  return createHarnessRegistry({
    commands,
    pathEnv: pathValue(binA, binB),
    cwd: root,
  });
}

describe('harness capability descriptors', () => {
  it('registers exactly the two v1 harnesses in stable order', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });

    expect(HARNESS_IDS).toEqual(['opencode', 'copilot']);
    expect(registry.list()).toHaveLength(2);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['opencode', 'copilot']);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(registry.has('opencode')).toBe(true);
    expect(registry.has('copilot')).toBe(true);
    expect(registry.has('codex')).toBe(false);
  });

  it('exposes every required capability field on both adapters', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });

    for (const adapter of registry.list()) {
      expect(adapter.id).toMatch(/^(opencode|copilot)$/);
      expect(adapter.displayName.trim()).not.toBe('');
      expect(adapter.executableName.trim()).not.toBe('');
      expect(adapter.executableResolution).toBe('config-then-path');
      expect(adapter.installHint.trim()).not.toBe('');
      expect(adapter.discovery.strategy).toMatch(/^(filesystem|cli-json)$/);
      expect(adapter.supportedSessionModes.length).toBeGreaterThan(0);
      expect(typeof adapter.nativeAgentSelection.interactive).toBe('boolean');
      expect(typeof adapter.nativeAgentSelection.headless).toBe('boolean');
      expect(typeof adapter.nativeFork).toBe('boolean');
      expect(adapter.forkMechanisms.interactive).toMatch(/^(none|native|handoff)$/);
      expect(adapter.forkMechanisms.headless).toMatch(/^(none|native|handoff)$/);
      expect(adapter.trust.behavior).toMatch(/^(none|folder-dialog)$/);
      expect(adapter.automaticAdvancement).toMatch(/^(osc-working-idle|process-exit)$/);
      expect(adapter.supervisedAdvancement).toBe('user-only');
      expect(Array.isArray(adapter.automaticPermissions)).toBe(true);
      expect(typeof adapter.requiresAutomaticPermissionOptIn).toBe('boolean');
      expect(Object.isFrozen(adapter)).toBe(true);
      expect(Object.isFrozen(adapter.supportedSessionModes)).toBe(true);
      expect(Object.isFrozen(adapter.automaticPermissions)).toBe(true);
    }
  });

  it('describes OpenCode sessions, fork surfaces, discovery, trust, and advancement', () => {
    const opencode = createOpenCodeAdapter();

    expect(opencode.id).toBe('opencode');
    expect(opencode.displayName).toBe('OpenCode');
    expect(opencode.executableName).toBe('opencode');
    expect(opencode.supportedSessionModes).toEqual(CHAIN_SESSION_MODES);
    expect(opencode.nativeAgentSelection).toEqual({ interactive: false, headless: true });
    expect(opencode.nativeFork).toBe(true);
    expect(opencode.forkMechanisms).toEqual({
      interactive: 'handoff',
      headless: 'native',
    });
    expect(opencode.trust).toEqual({
      behavior: 'none',
      configPath: null,
      trustedFoldersKey: null,
    });
    expect(opencode.automaticAdvancement).toBe('osc-working-idle');
    expect(opencode.automaticPermissions).toEqual([]);
    expect(opencode.requiresAutomaticPermissionOptIn).toBe(false);
    expect(opencode.permissionOptInField).toBeNull();
    expect(opencode.buildTrustCommand).toBeUndefined();

    expect(opencode.discovery.strategy).toBe('filesystem');
    expect(opencode.discovery.command).toBeNull();
    expect(opencode.discovery.roots.map((rootEntry) => rootEntry.source)).toEqual([
      'project',
      'project',
      'personal',
      'loom-extra',
    ]);
    expect(opencode.discovery.roots.map((rootEntry) => rootEntry.location)).toEqual([
      '<project>/.agents/skills',
      '<project>/.opencode/skills',
      '~/.config/opencode/skills',
      '<loom-config>/extraSkillDirectories',
    ]);
  });

  it('describes Copilot sessions, handoff forks, discovery, trust, permissions, and advancement', () => {
    const copilot = createCopilotAdapter();

    expect(copilot.id).toBe('copilot');
    expect(copilot.displayName).toBe('GitHub Copilot');
    expect(copilot.executableName).toBe('copilot');
    expect(copilot.supportedSessionModes).toEqual(CHAIN_SESSION_MODES);
    expect(copilot.nativeAgentSelection).toEqual({ interactive: true, headless: true });
    expect(copilot.nativeFork).toBe(false);
    expect(copilot.forkMechanisms).toEqual({
      interactive: 'handoff',
      headless: 'handoff',
    });
    expect(copilot.trust).toEqual({
      behavior: 'folder-dialog',
      configPath: '~/.copilot/config.json',
      trustedFoldersKey: 'trustedFolders',
    });
    expect(copilot.automaticAdvancement).toBe('process-exit');
    expect(copilot.automaticPermissions).toEqual([
      '--allow-all-paths',
      '--allow-all-tools',
    ]);
    expect(copilot.automaticPermissions).toEqual(COPILOT_AUTOMATIC_PERMISSIONS);
    expect(copilot.requiresAutomaticPermissionOptIn).toBe(true);
    expect(copilot.permissionOptInField).toBe('automaticPermissionOptIn');
    expect(typeof copilot.buildTrustCommand).toBe('function');

    expect(copilot.discovery.strategy).toBe('cli-json');
    expect(copilot.discovery.roots).toEqual([]);
    expect(copilot.discovery.command).toEqual({
      args: ['skill', 'list', '--json'],
    });
  });

  it('throws a typed error for an unknown harness instead of inventing one', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });
    const error = expectHarnessError(
      () => registry.get('codex'),
      HARNESS_ERROR_CODES.UNSUPPORTED,
    );

    expect(error.details['harness']).toBe('codex');
    expect(error.details['supported']).toEqual(['opencode', 'copilot']);
    expectHarnessError(
      () => createHarnessAdapter('gemini'),
      HARNESS_ERROR_CODES.UNSUPPORTED,
    );
  });
});

describe('executable resolution', () => {
  it('resolves the default command from the first executable PATH entry', () => {
    const registry = resolvedRegistry();
    const resolved = registry.resolveExecutable('opencode');

    expect(resolved.executable).toBe(opencodePath);
    expect(resolved.source).toBe('path');
    expect(resolved.configuredOverride).toBeNull();
    expect(isAbsolute(resolved.executable)).toBe(true);
  });

  it('reads PATH from the injected environment seam', async () => {
    const fromEnvironment = await writeExecutable(binB, 'opencode');
    const registry = createHarnessRegistry({
      env: { PATH: binB },
      cwd: root,
    });

    expect(registry.resolveExecutable('opencode').executable).toBe(fromEnvironment);
  });

  it('does not mix an injected environment with the real process PATH', () => {
    const registry = createHarnessRegistry({ env: {}, cwd: root });
    const error = expectHarnessError(
      () => registry.resolveExecutable('opencode'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('NOT_ON_PATH');
    expect(error.details['attempted']).toEqual([]);
  });

  it('prefers the first PATH entry when several directories contain the command', async () => {
    const second = await writeExecutable(binB, 'opencode');
    const registry = resolvedRegistry();

    expect(second).not.toBe(opencodePath);
    expect(registry.resolveExecutable('opencode').executable).toBe(opencodePath);
  });

  it('skips non-executable files and directories that share the command name', async () => {
    const nonExecutableRoot = join(root, 'bin-non-exec');
    const directoryRoot = join(root, 'bin-directory');
    await writeExecutable(nonExecutableRoot, 'opencode', 0o644);
    await mkdir(join(directoryRoot, 'opencode'), { recursive: true });
    await chmod(join(directoryRoot, 'opencode'), 0o755);

    const registry = createHarnessRegistry({
      pathEnv: pathValue(nonExecutableRoot, directoryRoot, binA),
      cwd: root,
    });

    expect(registry.resolveExecutable('opencode').executable).toBe(opencodePath);
  });

  it('honours an absolute config override before PATH', async () => {
    const override = await writeExecutable(join(root, 'custom-bin'), 'opencode-custom');
    const registry = resolvedRegistry({ opencode: override });
    const resolved = registry.resolveExecutable('opencode');

    expect(resolved.executable).toBe(override);
    expect(resolved.source).toBe('config');
    expect(resolved.configuredOverride).toBe(override);
    expect(resolved.executable).not.toBe(opencodePath);
  });

  it('honours a bare config override by finding that command on PATH', async () => {
    const override = await writeExecutable(binB, 'opencode-custom');
    const registry = createHarnessRegistry({
      commands: { opencode: 'opencode-custom' },
      pathEnv: pathValue(binA, binB),
      cwd: root,
    });
    const resolved = registry.resolveExecutable('opencode');

    expect(resolved.executable).toBe(override);
    expect(resolved.source).toBe('config');
    expect(resolved.configuredOverride).toBe('opencode-custom');
  });

  it('does not fall back to PATH when a configured absolute override is missing', () => {
    const registry = resolvedRegistry({
      opencode: join(root, 'missing-bin', 'opencode'),
    });
    const error = expectHarnessError(
      () => registry.resolveExecutable('opencode'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('OVERRIDE_NOT_EXECUTABLE');
    expect(error.details['override']).toBe(join(root, 'missing-bin', 'opencode'));
    expect(error.details['attempted']).toEqual([join(root, 'missing-bin', 'opencode')]);
    expect(error.details['installHint']).toBeTypeOf('string');
  });

  it('does not fall back to the default executable when a bare override is missing', () => {
    const registry = createHarnessRegistry({
      commands: { opencode: 'opencode-not-installed' },
      pathEnv: pathValue(binA, binB),
      cwd: root,
    });
    const error = expectHarnessError(
      () => registry.resolveExecutable('opencode'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('OVERRIDE_NOT_FOUND');
    expect(error.details['attempted']).toEqual([
      join(binA, 'opencode-not-installed'),
      join(binB, 'opencode-not-installed'),
    ]);
  });

  it('rejects a relative path override instead of guessing at a base directory', () => {
    const registry = resolvedRegistry({ opencode: './opencode' });
    const error = expectHarnessError(
      () => registry.resolveExecutable('opencode'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('OVERRIDE_NOT_ABSOLUTE');
  });

  it('rejects a configured override with a NUL character', () => {
    const registry = resolvedRegistry({ opencode: '/tmp/open\0code' });
    const error = expectHarnessError(
      () => registry.resolveExecutable('opencode'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('OVERRIDE_INVALID');
  });

  it('reports a missing executable with the install hint and no shell fallback', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });
    const error = expectHarnessError(
      () => registry.resolveExecutable('copilot'),
      HARNESS_ERROR_CODES.UNAVAILABLE,
    );

    expect(error.details['reason']).toBe('NOT_ON_PATH');
    expect(error.details['executableName']).toBe('copilot');
    expect(error.details['attempted']).toEqual([]);
    expect(error.details['installHint']).toContain('@github/copilot');
    expect(error.message).toContain('copilot');
  });

  it('uses an injected executable probe and keeps every candidate absolute', () => {
    const candidates: string[] = [];
    const expected = join(binB, 'opencode');
    const registry = createHarnessRegistry({
      pathEnv: pathValue(binA, binB),
      cwd: root,
      isExecutable: (candidate) => {
        candidates.push(candidate);
        return candidate === expected;
      },
    });
    const resolved = registry.resolveExecutable('opencode');

    expect(resolved.executable).toBe(expected);
    expect(candidates).toEqual([join(binA, 'opencode'), expected]);
    expect(candidates.every((candidate) => isAbsolute(candidate))).toBe(true);
  });

  it('skips empty PATH segments instead of resolving from the current directory', () => {
    const candidates: string[] = [];
    const registry = createHarnessRegistry({
      pathEnv: `${delimiter}${binA}${delimiter}`,
      cwd: root,
      isExecutable: (candidate) => {
        candidates.push(candidate);
        return true;
      },
    });

    expect(registry.resolveExecutable('opencode').executable).toBe(
      join(binA, 'opencode'),
    );
    expect(candidates).toEqual([join(binA, 'opencode')]);
  });

  it('resolves commands from PATH entries that contain spaces', async () => {
    const spaced = join(root, 'bin with spaces');
    const executable = await writeExecutable(spaced, 'opencode');
    const registry = createHarnessRegistry({
      pathEnv: pathValue(spaced),
      cwd: root,
    });

    expect(registry.resolveExecutable('opencode').executable).toBe(executable);
  });
});

describe('session mode support', () => {
  it('accepts every chain session mode for both adapters', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });

    for (const harness of HARNESS_IDS) {
      for (const mode of CHAIN_SESSION_MODES) {
        expect(registry.supportsSessionMode(harness, mode)).toBe(true);
        expect(registry.assertSessionMode(harness, mode)).toBe(mode);
      }
    }
  });

  it('detects an unsupported mode before a run starts', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });

    for (const harness of HARNESS_IDS) {
      expect(registry.supportsSessionMode(harness, 'resume')).toBe(false);
      expect(registry.supportsSessionMode(harness, '')).toBe(false);
      expect(registry.supportsSessionMode(harness, 'Fork')).toBe(false);

      const error = expectHarnessError(
        () => registry.assertSessionMode(harness, 'resume'),
        HARNESS_ERROR_CODES.SESSION_MODE_UNSUPPORTED,
      );
      expect(error.details['sessionMode']).toBe('resume');
      expect(error.details['supported']).toEqual([
        'shared',
        'fresh',
        'fork',
      ]);
    }
  });

  it('rejects an unsupported mode inside a command builder', () => {
    const registry = resolvedRegistry();
    const badMode = invocation({
      sessionMode: 'resume' as ChainSessionMode,
    });

    expectHarnessError(
      () => registry.buildInteractiveCommand('opencode', badMode),
      HARNESS_ERROR_CODES.SESSION_MODE_UNSUPPORTED,
    );
    expectHarnessError(
      () => registry.buildHeadlessCommand('copilot', badMode),
      HARNESS_ERROR_CODES.SESSION_MODE_UNSUPPORTED,
    );
  });
});

describe('command builders', () => {
  it('builds an OpenCode interactive command as an executable plus arguments', () => {
    const registry = resolvedRegistry();
    const command = registry.buildInteractiveCommand('opencode', invocation());

    expect(command.executable).toBe(opencodePath);
    expect(command.cwd).toBe(project);
    expect(command.sessionMode).toBe('shared');
    expect(command.forkMechanism).toBe('none');
    expect(command.args).toEqual([
      '--session',
      SESSION_ID,
      '--prompt',
      PROMPT,
      project,
    ]);
    expect(command.args.filter((argument) => argument === PROMPT)).toHaveLength(1);
    expect(command.args).not.toContain('--fork');
  });

  it('uses a handoff for an OpenCode interactive fork and never passes --fork', () => {
    const registry = resolvedRegistry();
    const command = registry.buildInteractiveCommand(
      'opencode',
      invocation({ sessionMode: 'fork', sessionId: 'ses_fork_target' }),
    );

    expect(command.forkMechanism).toBe('handoff');
    expect(command.args).toEqual([
      '--session',
      'ses_fork_target',
      '--prompt',
      PROMPT,
      project,
    ]);
    expect(command.args).not.toContain('--fork');
  });

  it('builds an OpenCode headless run with the shared session and positional prompt', () => {
    const registry = resolvedRegistry();
    const command = registry.buildHeadlessCommand('opencode', invocation());

    expect(command.executable).toBe(opencodePath);
    expect(command.cwd).toBe(project);
    expect(command.args).toEqual(['run', '--session', SESSION_ID, PROMPT]);
    expect(command.args).not.toContain('--prompt');
  });

  it('selects OpenCode native agents only on the documented headless surface', () => {
    const registry = resolvedRegistry();
    const command = registry.buildHeadlessCommand(
      'opencode',
      invocation({ agentName: 'team/reviewer' }),
    );

    expect(command.args).toEqual([
      'run',
      '--agent',
      'team/reviewer',
      '--session',
      SESSION_ID,
      PROMPT,
    ]);
    expectHarnessError(
      () => registry.buildInteractiveCommand('opencode', invocation({ agentName: 'team/reviewer' })),
      HARNESS_ERROR_CODES.INVOCATION_INVALID,
    );
  });

  it('uses native OpenCode run --fork when a parent session is available', () => {
    const registry = resolvedRegistry();
    const command = registry.buildHeadlessCommand(
      'opencode',
      invocation({
        sessionMode: 'fork',
        sessionId: 'ses_new',
        forkFromSessionId: 'ses_parent',
      }),
    );

    expect(command.forkMechanism).toBe('native');
    expect(command.args).toEqual([
      'run',
      '--fork',
      '--session',
      'ses_parent',
      PROMPT,
    ]);
  });

  it('uses a handoff for the first step of an OpenCode fork chain', () => {
    const registry = resolvedRegistry();
    const command = registry.buildHeadlessCommand(
      'opencode',
      invocation({ sessionMode: 'fork', sessionId: 'ses_first' }),
    );

    expect(command.forkMechanism).toBe('handoff');
    expect(command.args).toEqual(['run', '--session', 'ses_first', PROMPT]);
    expect(command.args).not.toContain('--fork');
  });

  it('builds a Copilot interactive command with the session id and project', () => {
    const registry = resolvedRegistry();
    const command = registry.buildInteractiveCommand(
      'copilot',
      invocation({ sessionId: COPILOT_SESSION_ID }),
    );

    expect(command.executable).toBe(copilotPath);
    expect(command.cwd).toBe(project);
    expect(command.forkMechanism).toBe('none');
    expect(command.args).toEqual([
      '-i',
      PROMPT,
      '--session-id',
      COPILOT_SESSION_ID,
      '-C',
      project,
    ]);
    expect(command.args).not.toContain('--allow-all-paths');
    expect(command.args).not.toContain('--allow-all-tools');
    expect(command.args).not.toContain('--trust-folder');
  });

  it('passes the selected native agent to both Copilot command surfaces', () => {
    const registry = resolvedRegistry();
    const interactive = registry.buildInteractiveCommand(
      'copilot',
      invocation({ sessionId: COPILOT_SESSION_ID, agentName: 'reviewer' }),
    );
    const headless = registry.buildHeadlessCommand(
      'copilot',
      invocation({
        sessionId: COPILOT_SESSION_ID,
        automaticPermissionOptIn: true,
        agentName: 'reviewer',
      }),
    );

    expect(interactive.args).toContain('--agent');
    expect(interactive.args[interactive.args.indexOf('--agent') + 1]).toBe('reviewer');
    expect(headless.args).toContain('--agent');
    expect(headless.args[headless.args.indexOf('--agent') + 1]).toBe('reviewer');
  });

  it('labels a Copilot fork as handoff on both surfaces', () => {
    const registry = resolvedRegistry();
    const interactive = registry.buildInteractiveCommand(
      'copilot',
      invocation({
        sessionMode: 'fork',
        sessionId: COPILOT_SESSION_ID,
      }),
    );
    const headless = registry.buildHeadlessCommand(
      'copilot',
      invocation({
        sessionMode: 'fork',
        sessionId: COPILOT_SESSION_ID,
        automaticPermissionOptIn: true,
      }),
    );

    expect(interactive.forkMechanism).toBe('handoff');
    expect(headless.forkMechanism).toBe('handoff');
    expect(interactive.args).not.toContain('--fork');
    expect(headless.args).not.toContain('--fork');
  });

  it('emits Copilot broad flags only after the per-chain opt-in', () => {
    const registry = resolvedRegistry();
    const command = registry.buildHeadlessCommand(
      'copilot',
      invocation({
        sessionId: COPILOT_SESSION_ID,
        automaticPermissionOptIn: true,
      }),
    );

    expect(command.args).toEqual([
      '-p',
      PROMPT,
      '--session-id',
      COPILOT_SESSION_ID,
      '--allow-all-paths',
      '--allow-all-tools',
      '-C',
      project,
    ]);
    expect(command.args).not.toContain('--trust-folder');
  });

  it('blocks a Copilot headless command without the opt-in and names the exact flags', () => {
    const registry = resolvedRegistry();

    for (const optIn of [undefined, false]) {
      const error = expectHarnessError(
        () =>
          registry.buildHeadlessCommand(
            'copilot',
            invocation({
              sessionId: COPILOT_SESSION_ID,
              ...(optIn === undefined ? {} : { automaticPermissionOptIn: optIn }),
            }),
          ),
        HARNESS_ERROR_CODES.PERMISSION_OPT_IN_REQUIRED,
      );

      expect(error.details['permissions']).toEqual([
        '--allow-all-paths',
        '--allow-all-tools',
      ]);
      expect(error.details['optInField']).toBe('automaticPermissionOptIn');
    }
  });

  it('keeps an interactive Copilot command usable without the broad opt-in', () => {
    const registry = resolvedRegistry();
    const command = registry.buildInteractiveCommand(
      'copilot',
      invocation({ sessionId: COPILOT_SESSION_ID }),
    );

    expect(command.args).toContain('-i');
    expect(command.args).not.toContain('--allow-all-paths');
    expect(command.args).not.toContain('--allow-all-tools');
  });

  it('passes a multiline prompt through as one argument on every surface', () => {
    const registry = resolvedRegistry();
    const commands: HarnessCommand[] = [
      registry.buildInteractiveCommand('opencode', invocation()),
      registry.buildHeadlessCommand('opencode', invocation()),
      registry.buildInteractiveCommand(
        'copilot',
        invocation({ sessionId: COPILOT_SESSION_ID }),
      ),
      registry.buildHeadlessCommand(
        'copilot',
        invocation({
          sessionId: COPILOT_SESSION_ID,
          automaticPermissionOptIn: true,
        }),
      ),
    ];

    for (const command of commands) {
      expect(command.args).toContain(PROMPT);
      expect(command.args.filter((argument) => argument === PROMPT)).toHaveLength(1);
      expect(command.args.every((argument) => typeof argument === 'string')).toBe(true);
    }
  });

  it('builds an unseeded Copilot trust session with no prompt or session id', () => {
    const registry = resolvedRegistry();
    const copilot = registry.get('copilot');
    expect(copilot.buildTrustCommand).toBeTypeOf('function');

    const command = copilot.buildTrustCommand?.({ projectPath: project });
    expect(command).toBeDefined();
    expect(command?.executable).toBe(copilotPath);
    expect(command?.cwd).toBe(project);
    expect(command?.args).toEqual(['-C', project]);
    expect(command?.args).not.toContain('-i');
    expect(command?.args).not.toContain('-p');
    expect(command?.args).not.toContain('--prompt');
    expect(command?.args).not.toContain('--session-id');
    expect(command?.args).not.toContain('--trust-folder');
    expect(command?.args.join(' ')).not.toContain(PROMPT);
  });

  it('rejects a relative trust-session directory', () => {
    const copilot = createCopilotAdapter();
    const error = expectHarnessError(
      () => copilot.buildTrustCommand?.({ projectPath: 'project' }),
      HARNESS_ERROR_CODES.INVOCATION_INVALID,
    );

    expect(error.details['field']).toBe('projectPath');
  });
});

describe('invocation validation', () => {
  it('rejects missing prompt, session, and absolute project values before resolution', () => {
    const registry = createHarnessRegistry({ pathEnv: '', cwd: root });
    const cases: Array<[Partial<StepInvocation>, string]> = [
      [{ prompt: '' }, 'prompt'],
      [{ prompt: '   ' }, 'prompt'],
      [{ prompt: `hello\0world` }, 'prompt'],
      [{ sessionId: '' }, 'sessionId'],
      [{ sessionId: `ses_\0bad` }, 'sessionId'],
      [{ projectPath: 'relative/project' }, 'projectPath'],
      [{ projectPath: `${project}\0` }, 'projectPath'],
      [{ forkFromSessionId: '' }, 'forkFromSessionId'],
      [
        { automaticPermissionOptIn: 'yes' as unknown as boolean },
        'automaticPermissionOptIn',
      ],
    ];

    for (const [overrides, field] of cases) {
      const error = expectHarnessError(
        () => registry.buildInteractiveCommand('opencode', invocation(overrides)),
        HARNESS_ERROR_CODES.INVOCATION_INVALID,
      );
      expect(error.details['field']).toBe(field);
    }
  });
});

describe('harness isolation', () => {
  it('does not bind a host or read server network settings while resolving commands', () => {
    const registry = resolvedRegistry();
    const previousHost = process.env.LOOM_HOST;
    const previousPort = process.env.LOOM_PORT;

    process.env.LOOM_HOST = '0.0.0.0';
    process.env.LOOM_PORT = '9999';
    try {
      expect(registry.resolveExecutable('opencode').executable).toBe(opencodePath);
    } finally {
      if (previousHost === undefined) {
        delete process.env.LOOM_HOST;
      } else {
        process.env.LOOM_HOST = previousHost;
      }
      if (previousPort === undefined) {
        delete process.env.LOOM_PORT;
      } else {
        process.env.LOOM_PORT = previousPort;
      }
    }

    for (const adapter of registry.list()) {
      expect(Object.keys(adapter)).not.toContain('host');
      expect(Object.keys(adapter)).not.toContain('port');
      expect(Object.keys(adapter)).not.toContain('bind');
      expect(Object.keys(adapter)).not.toContain('listen');
    }
  });

  it('contains no process spawning, shell lookup, preflight, or filesystem config read', async () => {
    const modules = ['types.ts', 'registry.ts', 'opencode.ts', 'copilot.ts'];

    for (const moduleName of modules) {
      const source = await readFile(
        join(process.cwd(), 'src/server/harness', moduleName),
        'utf8',
      );

      expect(source).not.toMatch(/from ['"]node:child_process['"]/);
      expect(source).not.toMatch(/\bexecSync\b|\bexecFile\b|\bspawnSync\b|\bspawn\(/);
      expect(source).not.toMatch(/\bexec\(/);
      expect(source).not.toMatch(/\breadFileSync\b|\breadFile\(/);
      expect(source).not.toMatch(/\b127\.0\.0\.1\b|\blisten\s*\(/);
    }
  });
});

describe('session id generation', () => {
  it('generates an OpenCode id with the required ses prefix and validates it', () => {
    const adapter = createOpenCodeAdapter();
    const sessionId = adapter.createSessionId();

    expect(sessionId).toMatch(/^ses_[A-Za-z0-9]+$/);
    expect(adapter.isSessionId(sessionId)).toBe(true);
    expect(adapter.isSessionId('3f2a1c0e-4b1e-4f45-9d2f-6b2a0c9d8e11')).toBe(false);
    expect(adapter.isSessionId('test-id')).toBe(false);
  });

  it('keeps Copilot session ids nonempty and reusable', () => {
    const adapter = createCopilotAdapter();
    const sessionId = adapter.createSessionId();

    expect(sessionId.trim()).not.toBe('');
    expect(adapter.isSessionId(sessionId)).toBe(true);
    expect(adapter.isSessionId('')).toBe(false);
  });
});
