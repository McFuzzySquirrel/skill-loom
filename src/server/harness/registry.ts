import {
  HARNESS_IDS,
  type HarnessCommands,
  type HarnessId,
} from '../config/schema.js';
import type { ChainSessionMode } from '../chains/model.js';
import { createCopilotAdapter } from './copilot.js';
import { createOpenCodeAdapter } from './opencode.js';
import {
  HarnessUnsupportedError,
  type ExecutableResolutionOptions,
  type HarnessAdapter,
  type HarnessAdapterOptions,
  type HarnessCommand,
  type ResolvedExecutable,
  type StepInvocation,
} from './types.js';

/**
 * Harness adapter registry.
 *
 * The registry is the single place route, preflight, and run code obtain a
 * harness adapter. Callers pass a harness id from the validated chain, receive
 * the descriptor, and use its builders; they never import a harness module or
 * compare a harness name. Adding a harness in a future version means adding an
 * adapter here, not a branch in a route.
 *
 * The v1 registry intentionally contains exactly two adapters (OpenCode and
 * Copilot). A third harness is out of scope for v1.
 */

export const HARNESS_REGISTRY_IDS = HARNESS_IDS;
export type HarnessRegistryId = (typeof HARNESS_REGISTRY_IDS)[number];

export interface HarnessRegistryOptions extends ExecutableResolutionOptions {
  /** Skill Loom config `harnessCommands` map. Missing entries fall back to PATH. */
  commands?: HarnessCommands | undefined;
}

/** Lookup and convenience helpers over the configured adapters. */
export interface HarnessRegistry {
  /** Adapters in stable registry order. */
  list(): readonly HarnessAdapter[];
  /** Get an adapter or throw a typed `HARNESS_UNSUPPORTED` error. */
  get(harness: string): HarnessAdapter;
  has(harness: string): harness is HarnessId;
  resolveExecutable(harness: string): ResolvedExecutable;
  supportsSessionMode(harness: string, mode: string): boolean;
  assertSessionMode(harness: string, mode: string): ChainSessionMode;
  buildInteractiveCommand(harness: string, invocation: StepInvocation): HarnessCommand;
  buildHeadlessCommand(harness: string, invocation: StepInvocation): HarnessCommand;
}

/** True when `value` is one of the v1 harness ids. */
export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && (HARNESS_IDS as readonly string[]).includes(value);
}

/** Create one adapter by id with the same config/PATH seams as the registry. */
export function createHarnessAdapter(
  harness: string,
  options: HarnessAdapterOptions = {},
): HarnessAdapter {
  if (harness === 'opencode') {
    return createOpenCodeAdapter(options);
  }
  if (harness === 'copilot') {
    return createCopilotAdapter(options);
  }
  throw new HarnessUnsupportedError(harness, HARNESS_IDS);
}

/**
 * Create a registry bound to the current Skill Loom configuration and injection
 * seams.
 *
 * Executable resolution honours `commands[id]` first and then PATH. A missing
 * or broken override is reported by `resolveExecutable`/a command builder as a
 * typed `HARNESS_UNAVAILABLE` error; creating the registry itself never probes
 * the filesystem, so listing capabilities always works even when a CLI is not
 * installed.
 */
export function createHarnessRegistry(options: HarnessRegistryOptions = {}): HarnessRegistry {
  const commands = options.commands ?? {};
  const adapters = new Map<HarnessId, HarnessAdapter>();

  for (const harness of HARNESS_REGISTRY_IDS) {
    const adapterOptions: HarnessAdapterOptions = {
      pathEnv: options.pathEnv,
      pathDelimiter: options.pathDelimiter,
      isExecutable: options.isExecutable,
      cwd: options.cwd,
      env: options.env,
    };
    const override = commands[harness];
    if (override !== undefined) {
      adapterOptions.executableOverride = override;
    }
    adapters.set(harness, createHarnessAdapter(harness, adapterOptions));
  }

  const ordered = Object.freeze(
    HARNESS_REGISTRY_IDS.map((harness) => {
      const adapter = adapters.get(harness);
      if (adapter === undefined) {
        // Unreachable: the loop above fills every documented id. Throwing a
        // typed error keeps the registry honest if the id list changes.
        throw new HarnessUnsupportedError(harness, HARNESS_IDS);
      }
      return adapter;
    }),
  );

  const get = (harness: string): HarnessAdapter => {
    if (!isHarnessId(harness)) {
      throw new HarnessUnsupportedError(harness, HARNESS_IDS);
    }
    const adapter = adapters.get(harness);
    if (adapter === undefined) {
      throw new HarnessUnsupportedError(harness, HARNESS_IDS);
    }
    return adapter;
  };

  const registry: HarnessRegistry = {
    list(): readonly HarnessAdapter[] {
      return ordered;
    },

    get,

    has(harness: string): harness is HarnessId {
      return isHarnessId(harness) && adapters.has(harness);
    },

    resolveExecutable(harness: string): ResolvedExecutable {
      return get(harness).resolveExecutable();
    },

    supportsSessionMode(harness: string, mode: string): boolean {
      return get(harness).supportsSessionMode(mode);
    },

    assertSessionMode(harness: string, mode: string): ChainSessionMode {
      return get(harness).assertSessionMode(mode);
    },

    buildInteractiveCommand(harness: string, invocation: StepInvocation): HarnessCommand {
      return get(harness).buildInteractiveCommand(invocation);
    },

    buildHeadlessCommand(harness: string, invocation: StepInvocation): HarnessCommand {
      return get(harness).buildHeadlessCommand(invocation);
    },
  };

  return Object.freeze(registry);
}
