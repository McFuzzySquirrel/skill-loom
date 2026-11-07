import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { CHAIN_SESSION_MODES, type ChainSessionMode } from '../chains/model.js';
import type { HarnessId } from '../config/schema.js';
import {
  assertStepInvocation,
  assertSupportedSessionMode,
  isChainSessionMode,
  resolveHarnessExecutable,
  HarnessInvocationError,
  HarnessPermissionOptInError,
  type ForkMechanism,
  type HarnessAdapter,
  type HarnessAdapterOptions,
  type HarnessCommand,
  type HarnessTrustCommand,
  type ResolvedExecutable,
  type StepInvocation,
} from './types.js';

/**
 * GitHub Copilot CLI 1.0.105 adapter.
 *
 * Capabilities verified against the installed CLI on 2026-11-04:
 * - Interactive entry: `copilot -i <prompt> --session-id <id> -C <directory>`.
 * - Headless entry: `copilot -p <prompt> --session-id <id> -C <directory>`.
 * - Headless runs require `--allow-all-tools`; `--allow-all-paths` broadens
 *   filesystem access. Both are emitted only after the per-chain opt-in.
 * - Persistent folder trust is recorded under `trustedFolders` in
 *   `~/.copilot/config.json`; Skill Loom reads it and never writes it.
 * - The CLI exposes no fork flag, so fork is a deterministic handoff note.
 *
 * This module only describes commands and capabilities. It never spawns a
 * process, runs a preflight check, or reads a credential file.
 */

export const COPILOT_HARNESS = 'copilot' satisfies HarnessId;
export const COPILOT_DISPLAY_NAME = 'GitHub Copilot';
export const COPILOT_EXECUTABLE_NAME = 'copilot';
export const COPILOT_INSTALL_HINT =
  'Install GitHub Copilot CLI 1.0.105 with "npm install -g @github/copilot" and ensure "copilot" is on PATH, or set harnessCommands.copilot in the Skill Loom config.';

/** Copilot can honor shared and fresh sessions and a fork handoff. */
export const COPILOT_SUPPORTED_SESSION_MODES: readonly ChainSessionMode[] = Object.freeze([
  ...CHAIN_SESSION_MODES,
]);

/** Exact broad flags required for automatic Copilot steps. */
export const COPILOT_AUTOMATIC_PERMISSIONS: readonly string[] = Object.freeze([
  '--allow-all-paths',
  '--allow-all-tools',
]);

/**
 * Copilot has no native fork on either surface. `fork` chains start a new
 * session with a deterministic handoff note in the prompt.
 */
export const COPILOT_FORK_MECHANISMS = Object.freeze({
  interactive: 'handoff' as const,
  headless: 'handoff' as const,
});

/** Discovery runs `copilot skill list --json` in the project directory. */
export const COPILOT_DISCOVERY_ARGS: readonly string[] = Object.freeze([
  'skill',
  'list',
  '--json',
]);

const DISCOVERY = Object.freeze({
  strategy: 'cli-json' as const,
  roots: Object.freeze([]),
  command: Object.freeze({ args: COPILOT_DISCOVERY_ARGS }),
});

const TRUST = Object.freeze({
  behavior: 'folder-dialog' as const,
  configPath: '~/.copilot/config.json',
  trustedFoldersKey: 'trustedFolders',
});

/**
 * Create the Copilot adapter.
 *
 * `executableOverride` mirrors `harnessCommands.copilot`; a broken override is
 * a block rather than a silent fallback to the default executable.
 */
export function createCopilotAdapter(options: HarnessAdapterOptions = {}): HarnessAdapter {
  const resolveExecutable = (): ResolvedExecutable =>
    resolveHarnessExecutable(
      {
        harness: COPILOT_HARNESS,
        executableName: COPILOT_EXECUTABLE_NAME,
        installHint: COPILOT_INSTALL_HINT,
        override: options.executableOverride,
      },
      options,
    );

  const buildTrustCommand = (input: { projectPath: string }): HarnessTrustCommand => {
    if (
      typeof input.projectPath !== 'string' ||
      input.projectPath.trim() === '' ||
      input.projectPath.includes('\0') ||
      !isAbsolute(input.projectPath)
    ) {
      throw new HarnessInvocationError(
        COPILOT_HARNESS,
        'projectPath',
        'The trust session directory must be an absolute path without NUL characters.',
      );
    }

    const { executable } = resolveExecutable();

    // No prompt, no session id, and no `--trust-folder`: the user accepts the
    // interactive dialog, and persistent trust is then read back from config.
    return {
      harness: COPILOT_HARNESS,
      executable,
      args: ['-C', input.projectPath],
      cwd: input.projectPath,
    };
  };

  const adapter: HarnessAdapter = {
    id: COPILOT_HARNESS,
    displayName: COPILOT_DISPLAY_NAME,
    executableName: COPILOT_EXECUTABLE_NAME,
    executableResolution: 'config-then-path',
    installHint: COPILOT_INSTALL_HINT,
    discovery: DISCOVERY,
    supportedSessionModes: COPILOT_SUPPORTED_SESSION_MODES,
    nativeAgentSelection: Object.freeze({ interactive: true, headless: true }),
    nativeFork: false,
    forkMechanisms: COPILOT_FORK_MECHANISMS,
    trust: TRUST,
    automaticAdvancement: 'process-exit',
    supervisedAdvancement: 'user-only',
    // Copilot prints best-effort `skill(name)` evidence when it loads a skill.
    skillObservation: 'log-lines',
    automaticPermissions: COPILOT_AUTOMATIC_PERMISSIONS,
    requiresAutomaticPermissionOptIn: true,
    permissionOptInField: 'automaticPermissionOptIn',

    resolveExecutable,

    createSessionId(): string {
      return randomUUID();
    },

    isSessionId(value: string): boolean {
      return typeof value === 'string' && value.trim() !== '' && !value.includes('\0');
    },

    supportsSessionMode(mode: string): mode is ChainSessionMode {
      return isChainSessionMode(mode) && COPILOT_SUPPORTED_SESSION_MODES.includes(mode);
    },

    assertSessionMode(mode: string): ChainSessionMode {
      return assertSupportedSessionMode(
        COPILOT_HARNESS,
        COPILOT_SUPPORTED_SESSION_MODES,
        mode,
      );
    },

    buildInteractiveCommand(invocation: StepInvocation): HarnessCommand {
      const sessionMode = assertStepInvocation(COPILOT_HARNESS, invocation);
      assertSupportedSessionMode(
        COPILOT_HARNESS,
        COPILOT_SUPPORTED_SESSION_MODES,
        sessionMode,
      );

      const { executable } = resolveExecutable();
      const forkMechanism: ForkMechanism = sessionMode === 'fork' ? 'handoff' : 'none';

      return {
        harness: COPILOT_HARNESS,
        executable,
        args: [
          '-i',
          invocation.prompt,
          ...(invocation.agentName === undefined ? [] : ['--agent', invocation.agentName]),
          '--session-id',
          invocation.sessionId,
          '-C',
          invocation.projectPath,
        ],
        cwd: invocation.projectPath,
        sessionMode,
        forkMechanism,
      };
    },

    buildHeadlessCommand(invocation: StepInvocation): HarnessCommand {
      const sessionMode = assertStepInvocation(COPILOT_HARNESS, invocation);
      assertSupportedSessionMode(
        COPILOT_HARNESS,
        COPILOT_SUPPORTED_SESSION_MODES,
        sessionMode,
      );

      if (invocation.automaticPermissionOptIn !== true) {
        throw new HarnessPermissionOptInError(
          COPILOT_HARNESS,
          COPILOT_AUTOMATIC_PERMISSIONS,
        );
      }

      const { executable } = resolveExecutable();
      const forkMechanism: ForkMechanism = sessionMode === 'fork' ? 'handoff' : 'none';

      return {
        harness: COPILOT_HARNESS,
        executable,
        args: [
          '-p',
          invocation.prompt,
          ...(invocation.agentName === undefined ? [] : ['--agent', invocation.agentName]),
          '--session-id',
          invocation.sessionId,
          ...COPILOT_AUTOMATIC_PERMISSIONS,
          '-C',
          invocation.projectPath,
        ],
        cwd: invocation.projectPath,
        sessionMode,
        forkMechanism,
      };
    },

    buildTrustCommand,
  };

  return Object.freeze(adapter);
}
