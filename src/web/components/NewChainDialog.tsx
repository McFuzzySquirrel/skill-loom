import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  CHAIN_HARNESSES,
  CHAIN_SESSION_MODES,
  newChainBuilderPath,
  type ChainHarness,
} from '../api/chains';
import { CHAIN_HARNESS_LABELS } from '../hooks/useChains';
import { useRouter } from '../router';
import { useStatusAnnouncer } from './StatusRegion';

export interface NewChainDialogProps {
  projectId: string;
  onClose: () => void;
}

function harnessDescription(harness: ChainHarness): string {
  return harness === 'opencode'
    ? 'Runs the OpenCode CLI. Skills are model-invoked context, so Skill Loom guarantees prompt order rather than skill firing.'
    : 'Runs the Copilot CLI. Skills are model-invoked context, so Skill Loom guarantees prompt order rather than skill firing.';
}

/**
 * Create an unsaved chain draft from a name and one harness (CHAIN-FR-04).
 *
 * The harness is chosen here and cannot change later without duplicating the
 * chain, so the dialog says that explicitly. No chain file is written yet: the
 * builder owns the first save and a cancelled draft leaves `.loom/chains`
 * untouched. The dialog is non-modal and never traps focus.
 */
export function NewChainDialog({ projectId, onClose }: NewChainDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const nameHelpId = useId();
  const nameErrorId = useId();
  const harnessHelpId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { navigate } = useRouter();
  const { announce } = useStatusAnnouncer();
  const [name, setName] = useState('');
  const [harness, setHarness] = useState<ChainHarness>('opencode');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    onClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('Enter a name for this chain.');
      return;
    }
    if (trimmed.length > 120) {
      setNameError('Use a chain name of 120 characters or fewer.');
      return;
    }

    const draft = {
      name: trimmed,
      harness,
      // New chains start shared; the builder can change this before the first
      // save without rewriting an existing chain record.
      sessionMode: CHAIN_SESSION_MODES[0],
    } as const;

    announce(
      `Draft chain ${trimmed} created for ${CHAIN_HARNESS_LABELS[harness]}. Opening the builder.`,
    );
    navigate(newChainBuilderPath(projectId, draft));
  };

  return (
    <section
      className="new-chain"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="new-chain-dialog"
      onKeyDown={handleEscape}
    >
      <div className="new-chain__header">
        <h3 className="new-chain__title" id={titleId} ref={heading} tabIndex={-1}>
          New chain
        </h3>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={onClose}
          aria-label="Close new chain dialog"
        >
          Close
        </button>
      </div>

      <p className="field__hint">
        A chain is one ordered recipe bound to a single harness. Choose the harness now:
        changing it later requires duplicating the chain, because per-step harness
        switching is unsupported.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={nameId}>
            Chain name
          </label>
          <input
            className="input"
            id={nameId}
            name="chain-name"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
            aria-invalid={nameError !== null}
            aria-describedby={
              nameError === null ? nameHelpId : `${nameHelpId} ${nameErrorId}`
            }
            maxLength={120}
            data-testid="new-chain-name"
          />
          {nameError !== null ? (
            <p className="field__error" id={nameErrorId}>
              <span aria-hidden="true">! </span>
              {nameError}
            </p>
          ) : null}
          <p className="field__hint" id={nameHelpId}>
            Shown in this project&apos;s chain library. You can edit it in the builder
            before the first save.
          </p>
        </div>

        <fieldset className="catalog__harness new-chain__harness" aria-describedby={harnessHelpId}>
          <legend className="field__label">Harness</legend>
          <div className="catalog__harness-options">
            {CHAIN_HARNESSES.map((value) => (
              <label className="catalog__harness-option" key={value}>
                <input
                  type="radio"
                  name="chain-harness"
                  value={value}
                  checked={harness === value}
                  onChange={() => setHarness(value)}
                  data-testid={`new-chain-harness-${value}`}
                />
                <span>{CHAIN_HARNESS_LABELS[value]}</span>
              </label>
            ))}
          </div>
          <p className="field__hint" id={harnessHelpId}>
            {harnessDescription(harness)}
          </p>
        </fieldset>

        <div className="panel__actions">
          <button
            type="submit"
            className="button"
            disabled={name.trim() === ''}
            data-testid="new-chain-submit"
          >
            Create draft
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
