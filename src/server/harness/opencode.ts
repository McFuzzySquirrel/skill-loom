import { randomUUID } from 'node:crypto';
import { CHAIN_SESSION_MODES, type ChainSessionMode } from '../chains/model.js';
import type { HarnessId } from '../config/schema.js';
import {
  assertStepInvocation,
  assertSupportedSessionMode,
  HarnessInvocationError,
  isChainSessionMode,
  resolveHarnessExecutable,
  type ForkMechanism,
  type HarnessAdapter,
  type HarnessAdapterOptions,
  type HarnessCommand,
  type ResolvedExecutable,
  type StepInvocation,
} from './types.js';

/**
 * OpenCode 2.2.5 adapter.
 *
 * Capabilities verified against the installed CLI on 2026-11-04:
 * - Interactive entry: `opencode [--session id] [--prompt text] <directory>`.
 * - Headless entry: `opencode run [--fork] [--session id] <message>`; the run
 *   subcommand exposes `--fork` while the interactive entry does not.
 * - Machine state: `OSC 7501;state=working|idle|clear`.
 * - Skills: filesystem discovery of project/personal `.agents/skills`,
 *   legacy project `.opencode/skills`, and OpenCode personal skill packages.
 *
 * This module only describes commands and capabilities. It never spawns a
 * process, runs a preflight check, or reads a credential file.
 */

export const OPENCODE_HARNESS = 'opencode' satisfies HarnessId;
export const OPENCODE_DISPLAY_NAME = 'OpenCode';
export const OPENCODE_EXECUTABLE_NAME = 'opencode';
export const OPENCODE_INSTALL_HINT =
  'Install OpenCode 2.2.5 (https://opencode.ai) and ensure "opencode" is on PATH, or set harnessCommands.opencode in the Skill Loom config.';

/** OpenCode rejects any session id that does not start with `ses`. */
export const OPENCODE_SESSION_ID_PREFIX = 'ses_';
export const OPENCODE_SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]+$/;

/** Create an OpenCode session id for a brand-new session. */
export function createOpenCodeSessionId(): string {
  return `${OPENCODE_SESSION_ID_PREFIX}${randomUUID().replaceAll('-', '')}`;
}

/** OpenCode can honor all three chain session modes. */
export const OPENCODE_SUPPORTED_SESSION_MODES: readonly ChainSessionMode[] = Object.freeze([
  ...CHAIN_SESSION_MODES,
]);

/**
 * Native fork is exposed only by `opencode run`. The interactive entry has no
 * fork flag, so a supervised fork must use a deterministic handoff note.
 */
export const OPENCODE_FORK_MECHANISMS = Object.freeze({
  interactive: 'handoff' as const,
  headless: 'native' as const,
});

const DISCOVERY = Object.freeze({
  strategy: 'filesystem' as const,
  roots: Object.freeze([
    Object.freeze({ source: 'project' as const, location: '<project>/.agents/skills' }),
    Object.freeze({ source: 'project' as const, location: '<project>/.opencode/skills' }),
    Object.freeze({ source: 'personal' as const, location: '~/.agents/skills' }),
    Object.freeze({ source: 'personal' as const, location: '~/.config/opencode/skills' }),
    Object.freeze({
      source: 'loom-extra' as const,
      location: '<loom-config>/extraSkillDirectories',
    }),
  ]),
  command: null,
});

const TRUST = Object.freeze({
  behavior: 'none' as const,
  configPath: null,
  trustedFoldersKey: null,
});

/**
 * Create the OpenCode adapter.
 *
 * `executableOverride` mirrors `harnessCommands.opencode`; when present it is
 * authoritative and is never silently replaced by a PATH lookup of the default
 * executable.
 */
export function createOpenCodeAdapter(options: HarnessAdapterOptions = {}): HarnessAdapter {
  const resolveExecutable = (): ResolvedExecutable =>
    resolveHarnessExecutable(
      {
        harness: OPENCODE_HARNESS,
        executableName: OPENCODE_EXECUTABLE_NAME,
        installHint: OPENCODE_INSTALL_HINT,
        override: options.executableOverride,
      },
      options,
    );

  const adapter: HarnessAdapter = {
    id: OPENCODE_HARNESS,
    displayName: OPENCODE_DISPLAY_NAME,
    executableName: OPENCODE_EXECUTABLE_NAME,
    executableResolution: 'config-then-path',
    installHint: OPENCODE_INSTALL_HINT,
    discovery: DISCOVERY,
    supportedSessionModes: OPENCODE_SUPPORTED_SESSION_MODES,
    nativeAgentSelection: Object.freeze({ interactive: false, headless: true }),
    nativeFork: true,
    forkMechanisms: OPENCODE_FORK_MECHANISMS,
    trust: TRUST,
    automaticAdvancement: 'osc-working-idle',
    supervisedAdvancement: 'user-only',
    // Interactive OpenCode exposes no visible skill(name) line equivalent.
    skillObservation: 'unobservable',
    automaticPermissions: Object.freeze([]),
    requiresAutomaticPermissionOptIn: false,
    permissionOptInField: null,

    resolveExecutable,

    createSessionId(): string {
      return createOpenCodeSessionId();
    },

    isSessionId(value: string): boolean {
      return OPENCODE_SESSION_ID_PATTERN.test(value);
    },

    supportsSessionMode(mode: string): mode is ChainSessionMode {
      return isChainSessionMode(mode) && OPENCODE_SUPPORTED_SESSION_MODES.includes(mode);
    },

    assertSessionMode(mode: string): ChainSessionMode {
      return assertSupportedSessionMode(
        OPENCODE_HARNESS,
        OPENCODE_SUPPORTED_SESSION_MODES,
        mode,
      );
    },

    buildInteractiveCommand(invocation: StepInvocation): HarnessCommand {
      const sessionMode = assertStepInvocation(OPENCODE_HARNESS, invocation);
      if (invocation.agentName !== undefined) {
        throw new HarnessInvocationError(
          OPENCODE_HARNESS,
          'agentName',
          'OpenCode does not expose a verified native-agent selector on its interactive command surface.',
        );
      }
      assertSupportedSessionMode(
        OPENCODE_HARNESS,
        OPENCODE_SUPPORTED_SESSION_MODES,
        sessionMode,
      );

      const { executable } = resolveExecutable();
      const forkMechanism: ForkMechanism = sessionMode === 'fork' ? 'handoff' : 'none';

      return {
        harness: OPENCODE_HARNESS,
        executable,
        args: [
          '--session',
          invocation.sessionId,
          '--prompt',
          invocation.prompt,
          invocation.projectPath,
        ],
        cwd: invocation.projectPath,
        sessionMode,
        forkMechanism,
      };
    },

    buildHeadlessCommand(invocation: StepInvocation): HarnessCommand {
      const sessionMode = assertStepInvocation(OPENCODE_HARNESS, invocation);
      assertSupportedSessionMode(
        OPENCODE_HARNESS,
        OPENCODE_SUPPORTED_SESSION_MODES,
        sessionMode,
      );

      const { executable } = resolveExecutable();
      const args = ['run'];
      if (invocation.agentName !== undefined) {
        args.push('--agent', invocation.agentName);
      }
      let forkMechanism: ForkMechanism = 'none';

      if (sessionMode === 'fork') {
        if (
          invocation.forkFromSessionId !== undefined &&
          invocation.forkFromSessionId.trim() !== ''
        ) {
          // Native fork: `run` forks the parent session before continuing.
          args.push('--fork', '--session', invocation.forkFromSessionId);
          forkMechanism = 'native';
        } else {
          // First step of a fork chain: there is no parent to fork from.
          args.push('--session', invocation.sessionId);
          forkMechanism = 'handoff';
        }
      } else {
        args.push('--session', invocation.sessionId);
      }

      // `opencode run` takes the prompt as a positional message, not through
      // the interactive entry's `--prompt` flag.
      args.push(invocation.prompt);

      return {
        harness: OPENCODE_HARNESS,
        executable,
        args,
        cwd: invocation.projectPath,
        sessionMode,
        forkMechanism,
      };
    },
  };

  return Object.freeze(adapter);
}
