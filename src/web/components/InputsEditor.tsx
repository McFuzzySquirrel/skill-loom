import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  CHAIN_INPUT_NAME_PATTERN,
  type ChainInput,
  type ChainStep,
} from '../api/chains';
import {
  collectInputReferences,
  stepDisplayName,
  type InputReference,
} from '../hooks/useChainDraft';
import { useStatusAnnouncer } from './StatusRegion';

export interface InputsEditorProps {
  inputs: ChainInput[];
  steps: ChainStep[];
  disabled?: boolean;
  onAdd: (input: ChainInput) => void;
  onUpdate: (name: string, patch: Partial<Omit<ChainInput, 'name'>>) => void;
  /** Called only after the affected-step report has been confirmed. */
  onRename: (oldName: string, newName: string) => void;
  /** Called only after the affected-step report has been confirmed. */
  onRemove: (name: string) => void;
}

interface RenameDraft {
  name: string;
  value: string;
  error: string | null;
}

interface PendingRename {
  oldName: string;
  newName: string;
  references: InputReference[];
}

interface PendingRemove {
  name: string;
  references: InputReference[];
}

type FocusTarget =
  | { kind: 'add' }
  | { kind: 'rename'; name: string }
  | { kind: 'remove'; name: string };

function placeholderFor(name: string): string {
  return `{{${name}}}`;
}

function countLabel(references: readonly InputReference[]): string {
  return `${String(references.length)} step${references.length === 1 ? '' : 's'}`;
}

/**
 * Named inputs editor (CHAIN-FR-06).
 *
 * A rename or removal never rewrites instruction text in place: the editor
 * first lists every instruction that references the input, including its
 * one-based step position and occurrence count, and only applies the change
 * after an explicit confirmation. The add form validates identifier syntax and
 * uniqueness before calling the draft hook.
 */
export function InputsEditor({
  inputs,
  steps,
  disabled = false,
  onAdd,
  onUpdate,
  onRename,
  onRemove,
}: InputsEditorProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const addNameId = `${baseId}-add-name`;
  const addLabelId = `${baseId}-add-label`;
  const addDefaultId = `${baseId}-add-default`;
  const addRequiredId = `${baseId}-add-required`;
  const addErrorId = `${baseId}-add-error`;
  const reconciliationTitleId = `${baseId}-reconciliation-title`;
  const { announce } = useStatusAnnouncer();

  const [addName, setAddName] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addRequired, setAddRequired] = useState(false);
  const [addDefault, setAddDefault] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<RenameDraft | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  const addNameRef = useRef<HTMLInputElement>(null);
  const reconciliationHeading = useRef<HTMLHeadingElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (pendingRename !== null || pendingRemove !== null) {
      reconciliationHeading.current?.focus();
    }
  }, [pendingRename, pendingRemove]);

  useEffect(() => {
    if (focusTarget === null) {
      return;
    }
    if (focusTarget.kind === 'add') {
      addNameRef.current?.focus();
    } else if (focusTarget.kind === 'rename') {
      renameButtons.current.get(focusTarget.name)?.focus();
    } else {
      removeButtons.current.get(focusTarget.name)?.focus();
    }
    setFocusTarget(null);
  }, [focusTarget, inputs]);

  const validateNewName = (candidate: string, ignoreName?: string): string | null => {
    const name = candidate.trim();
    if (name === '') {
      return 'Enter a name for this input.';
    }
    if (!CHAIN_INPUT_NAME_PATTERN.test(name)) {
      return 'Input names must start with a letter and use only letters, numbers, and underscores.';
    }
    if (inputs.some((input) => input.name === name && input.name !== ignoreName)) {
      return `An input named "${name}" is already declared.`;
    }
    return null;
  };

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validateNewName(addName);
    if (error !== null) {
      setAddError(error);
      announce(error);
      return;
    }

    const name = addName.trim();
    const label = addLabel.trim();
    onAdd({
      name,
      required: addRequired,
      ...(label === '' ? {} : { label }),
      ...(addDefault === '' ? {} : { defaultValue: addDefault }),
    });
    setAddName('');
    setAddLabel('');
    setAddRequired(false);
    setAddDefault('');
    setAddError(null);
    setFocusTarget({ kind: 'add' });
  };

  const beginRename = (name: string) => {
    setPendingRename(null);
    setPendingRemove(null);
    setRenaming({ name, value: name, error: null });
  };

  const cancelRename = () => {
    const name = renaming?.name;
    setRenaming(null);
    if (name !== undefined) {
      setFocusTarget({ kind: 'rename', name });
    }
  };

  const reviewRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renaming === null) {
      return;
    }

    const newName = renaming.value.trim();
    const error = validateNewName(newName, renaming.name);
    if (error !== null) {
      setRenaming({ ...renaming, error });
      return;
    }
    if (newName === renaming.name) {
      setRenaming(null);
      announce(`Input ${renaming.name} was not renamed.`);
      return;
    }

    const references = collectInputReferences(steps, renaming.name);
    setPendingRename({ oldName: renaming.name, newName, references });
    setRenaming(null);
    announce(
      references.length === 0
        ? `Rename input ${renaming.name} to ${newName}. No instruction references it. Review the change.`
        : `Rename input ${renaming.name} to ${newName}. ${countLabel(
            references,
          )} reference it. Review every affected step before applying.`,
    );
  };

  const applyRename = () => {
    if (pendingRename === null) {
      return;
    }
    const { oldName, newName } = pendingRename;
    setPendingRename(null);
    onRename(oldName, newName);
    setFocusTarget({ kind: 'rename', name: newName });
  };

  const reviewRemove = (name: string) => {
    setPendingRename(null);
    setRenaming(null);
    const references = collectInputReferences(steps, name);
    setPendingRemove({ name, references });
    announce(
      references.length === 0
        ? `Remove input ${name}. No instruction references it. Review the change.`
        : `Remove input ${name}. ${countLabel(
            references,
          )} reference it. Review every affected step before applying.`,
    );
  };

  const applyRemove = () => {
    if (pendingRemove === null) {
      return;
    }
    const { name } = pendingRemove;
    setPendingRemove(null);
    onRemove(name);
    setFocusTarget({ kind: 'add' });
  };

  return (
    <section
      className="builder-panel inputs-panel"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      data-testid="inputs-editor"
    >
      <div className="builder-panel__heading">
        <h2 className="section-title builder-panel__title" id={titleId}>
          Inputs
        </h2>
        <span className="builder-panel__count" data-testid="inputs-count">
          {String(inputs.length)} input{inputs.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="field__hint" id={hintId}>
        Declare reusable values once, then reference them as{' '}
        <code>{'{{name}}'}</code> in step instructions. Renaming or removing an
        input lists every affected step before any placeholder changes.
      </p>

      {inputs.length === 0 ? (
        <div className="empty-state" data-testid="inputs-empty">
          <p>No inputs declared.</p>
          <p>
            Add an input below when several instructions need the same value,
            such as a ticket number or target branch.
          </p>
        </div>
      ) : (
        <ul className="input-list" data-testid="input-list">
          {inputs.map((input) => {
            const references = collectInputReferences(steps, input.name);
            const isRenaming = renaming?.name === input.name;
            return (
              <li
                className="input-row"
                key={input.name}
                data-testid="input-row"
                data-input-name={input.name}
              >
                <div className="input-row__identity">
                  <p className="input-row__name">
                    <code data-testid="input-name">{input.name}</code>
                  </p>
                  <p className="input-row__placeholder">
                    Placeholder: <code>{placeholderFor(input.name)}</code>
                  </p>
                  {references.length === 0 ? (
                    <span
                      className="status-tag status-tag--warning input-row__badge"
                      data-testid="input-unused"
                    >
                      <span aria-hidden="true">○</span> Unused input
                    </span>
                  ) : (
                    <span
                      className="status-tag status-tag--ok input-row__badge"
                      data-testid="input-used"
                    >
                      <span aria-hidden="true">✓</span> Used in {countLabel(references)}
                    </span>
                  )}
                </div>

                <div className="input-row__fields">
                  <div className="field">
                    <label className="field__label" htmlFor={`${baseId}-${input.name}-label`}>
                      Label (optional)
                    </label>
                    <input
                      className="input"
                      id={`${baseId}-${input.name}-label`}
                      type="text"
                      value={input.label ?? ''}
                      onChange={(event) =>
                        onUpdate(input.name, { label: event.target.value })
                      }
                      disabled={disabled}
                      maxLength={120}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="input-label"
                    />
                  </div>

                  <label className="checkbox-field input-row__required">
                    <input
                      type="checkbox"
                      checked={input.required}
                      onChange={(event) =>
                        onUpdate(input.name, { required: event.target.checked })
                      }
                      disabled={disabled}
                      data-testid="input-required"
                    />
                    <span>Required at run time</span>
                  </label>

                  <div className="field">
                    <label
                      className="field__label"
                      htmlFor={`${baseId}-${input.name}-default`}
                    >
                      Default value (optional)
                    </label>
                    <input
                      className="input"
                      id={`${baseId}-${input.name}-default`}
                      type="text"
                      value={input.defaultValue ?? ''}
                      onChange={(event) =>
                        onUpdate(input.name, { defaultValue: event.target.value })
                      }
                      disabled={disabled}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="input-default"
                    />
                  </div>
                </div>

                <div className="input-row__actions">
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    ref={(node) => {
                      if (node === null) {
                        renameButtons.current.delete(input.name);
                      } else {
                        renameButtons.current.set(input.name, node);
                      }
                    }}
                    onClick={() => beginRename(input.name)}
                    disabled={disabled}
                    aria-label={`Rename input ${input.name}`}
                    data-testid="input-rename"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small button--danger"
                    ref={(node) => {
                      if (node === null) {
                        removeButtons.current.delete(input.name);
                      } else {
                        removeButtons.current.set(input.name, node);
                      }
                    }}
                    onClick={() => reviewRemove(input.name)}
                    disabled={disabled}
                    aria-label={`Remove input ${input.name}`}
                    data-testid="input-remove"
                  >
                    Remove
                  </button>
                </div>

                {isRenaming ? (
                  <form
                    className="input-rename"
                    onSubmit={reviewRename}
                    noValidate
                    aria-label={`Rename input ${input.name}`}
                    data-testid="input-rename-form"
                  >
                    <div className="field">
                      <label
                        className="field__label"
                        htmlFor={`${baseId}-${input.name}-rename`}
                      >
                        New name for input {input.name}
                      </label>
                      <input
                        className="input"
                        id={`${baseId}-${input.name}-rename`}
                        type="text"
                        value={renaming?.value ?? ''}
                        onChange={(event) => {
                          if (renaming === null) {
                            return;
                          }
                          setRenaming({
                            ...renaming,
                            value: event.target.value,
                            error: null,
                          });
                        }}
                        aria-invalid={renaming !== null && renaming.error !== null}
                        aria-describedby={
                          renaming === null || renaming.error === null
                            ? undefined
                            : `${baseId}-${input.name}-rename-error`
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="input-rename-name"
                      />
                      {renaming?.error !== null ? (
                        <p
                          className="field__error"
                          id={`${baseId}-${input.name}-rename-error`}
                          data-testid="input-rename-error"
                        >
                          <span aria-hidden="true">! </span>
                          {renaming?.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="panel__actions">
                      <button
                        type="submit"
                        className="button button--small"
                        data-testid="input-rename-review"
                      >
                        Review rename
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={cancelRename}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pendingRename !== null || pendingRemove !== null ? (
        <section
          className="confirm-panel input-reconciliation"
          aria-labelledby={reconciliationTitleId}
          data-testid="input-reconciliation"
          data-action={pendingRename === null ? 'remove' : 'rename'}
        >
          <h3
            className="input-reconciliation__title"
            id={reconciliationTitleId}
            ref={reconciliationHeading}
            tabIndex={-1}
          >
            {pendingRename === null
              ? `Remove input ${pendingRemove?.name ?? ''}`
              : `Rename input ${pendingRename.oldName} to ${pendingRename.newName}`}
          </h3>

          {(() => {
            const references =
              pendingRename === null
                ? (pendingRemove?.references ?? [])
                : pendingRename.references;
            if (references.length === 0) {
              return (
                <p data-testid="input-reconciliation-none">
                  No instruction references this input, so no placeholder text
                  will change.
                </p>
              );
            }
            return (
              <>
                <p>
                  <span aria-hidden="true">▲</span> {countLabel(references)}{' '}
                  reference this input. Review every affected instruction before
                  applying the change.
                </p>
                <ol className="input-reconciliation__list">
                  {references.map((reference) => (
                    <li
                      key={reference.stepId}
                      data-testid="input-reconciliation-step"
                      data-step-id={reference.stepId}
                    >
                      <strong>
                        Step {String(reference.position)} —{' '}
                        {reference.displayName}
                      </strong>
                      : <code>{reference.placeholder}</code> appears{' '}
                      {String(reference.occurrences)} time
                      {reference.occurrences === 1 ? '' : 's'}.
                    </li>
                  ))}
                </ol>
              </>
            );
          })()}

          <p className="field__hint">
            {pendingRename === null
              ? 'Confirming removes the placeholder text from every listed instruction. The instruction text itself is kept and may become empty, which then blocks saving.'
              : `Confirming rewrites every listed placeholder to {{${pendingRename?.newName ?? ''}}}. No other instruction text changes.`}
          </p>

          <div className="panel__actions">
            {pendingRename === null ? (
              <button
                type="button"
                className="button button--danger button--small"
                onClick={applyRemove}
                data-testid="input-remove-confirm"
              >
                Remove input and placeholders
              </button>
            ) : (
              <button
                type="button"
                className="button button--small"
                onClick={applyRename}
                data-testid="input-rename-apply"
              >
                Rename and update placeholders
              </button>
            )}
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                if (pendingRename !== null) {
                  const name = pendingRename.oldName;
                  setPendingRename(null);
                  setFocusTarget({ kind: 'rename', name });
                  return;
                }
                if (pendingRemove !== null) {
                  const name = pendingRemove.name;
                  setPendingRemove(null);
                  setFocusTarget({ kind: 'remove', name });
                }
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <form className="inputs-add" onSubmit={handleAdd} noValidate data-testid="input-add-form">
        <h3 className="inputs-add__title">Add an input</h3>
        <div className="inputs-add__grid">
          <div className="field">
            <label className="field__label" htmlFor={addNameId}>
              Name
            </label>
            <input
              className="input"
              id={addNameId}
              ref={addNameRef}
              type="text"
              value={addName}
              onChange={(event) => {
                setAddName(event.target.value);
                setAddError(null);
              }}
              aria-invalid={addError !== null}
              aria-describedby={addError === null ? hintId : `${hintId} ${addErrorId}`}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              placeholder="task_name"
              data-testid="input-add-name"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={addLabelId}>
              Label (optional)
            </label>
            <input
              className="input"
              id={addLabelId}
              type="text"
              value={addLabel}
              onChange={(event) => setAddLabel(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              maxLength={120}
              data-testid="input-add-label"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={addDefaultId}>
              Default value (optional)
            </label>
            <input
              className="input"
              id={addDefaultId}
              type="text"
              value={addDefault}
              onChange={(event) => setAddDefault(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              data-testid="input-add-default"
            />
          </div>

          <label className="checkbox-field inputs-add__required">
            <input
              id={addRequiredId}
              type="checkbox"
              checked={addRequired}
              onChange={(event) => setAddRequired(event.target.checked)}
              disabled={disabled}
              data-testid="input-add-required"
            />
            <span>Required at run time</span>
          </label>
        </div>

        {addError !== null ? (
          <p className="field__error" id={addErrorId} data-testid="input-add-error">
            <span aria-hidden="true">! </span>
            {addError}
          </p>
        ) : null}

        <div className="panel__actions">
          <button
            type="submit"
            className="button button--small"
            disabled={disabled}
            data-testid="input-add-submit"
          >
            Add input
          </button>
        </div>
      </form>
    </section>
  );
}
