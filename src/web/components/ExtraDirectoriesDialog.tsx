import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { ApiClientError } from '../api/client';
import { catalogApi, toApiClientError, type CatalogApi } from '../api/catalog';
import { useExtraDirectories } from '../hooks/useCatalog';
import { isAbsolutePath } from '../../shared/paths';
import { useStatusAnnouncer } from './StatusRegion';
import { InlineError } from './InlineError';

export interface ExtraDirectoriesDialogProps {
  onClose: () => void;
  /** Called after a successful add or remove so the catalog can refresh. */
  onDirectoriesChanged: () => void;
  api?: CatalogApi;
}

function validateAbsolutePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 'Enter an absolute directory path.';
  }
  if (trimmed.includes('\0')) {
    return 'The path contains an invalid character.';
  }
  if (!isAbsolutePath(trimmed)) {
    return 'Enter an absolute POSIX or Windows path.';
  }
  return null;
}

/**
 * Global extra skill directory settings.
 *
 * This is a non-modal dialog: focus moves into it when it opens and Escape
 * returns to the trigger, but the rest of the page is never made unreachable.
 * Removal states the consequence and never touches the directory on disk.
 */
export function ExtraDirectoriesDialog({
  onClose,
  onDirectoriesChanged,
  api = catalogApi,
}: ExtraDirectoriesDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const inputErrorId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, reload, add, remove } = useExtraDirectories(api);
  const { announce } = useStatusAnnouncer();
  const [path, setPath] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<ApiClientError | null>(null);
  const [busy, setBusy] = useState<'adding' | 'removing' | null>(null);
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    if (confirmingPath !== null) {
      setConfirmingPath(null);
      return;
    }
    if (busy === null) {
      onClose();
    }
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMutationError(null);
    const validation = validateAbsolutePath(path);
    if (validation !== null) {
      setInputError(validation);
      return;
    }
    setInputError(null);
    setBusy('adding');
    try {
      await add(path.trim());
      setPath('');
      announce(`Added extra skill directory ${path.trim()}.`);
      onDirectoriesChanged();
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented adding this extra skill directory.',
      );
      setMutationError(apiError);
      announce(`Extra skill directory could not be added: ${apiError.message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (directory: string) => {
    setMutationError(null);
    setBusy('removing');
    try {
      await remove(directory);
      setConfirmingPath(null);
      announce(`Removed extra skill directory ${directory}. Files were not deleted.`);
      onDirectoriesChanged();
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented removing this extra skill directory.',
      );
      setMutationError(apiError);
      announce(`Extra skill directory could not be removed: ${apiError.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="catalog-settings"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="extra-directories-dialog"
      onKeyDown={handleEscape}
    >
      <div className="catalog-settings__header">
        <h3 className="catalog-settings__title" id={titleId} ref={heading} tabIndex={-1}>
          Extra skill directories
        </h3>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={onClose}
          disabled={busy !== null}
        >
          Close settings
        </button>
      </div>

      <p className="field__hint">
        Changes are global to Skill Loom and apply to every project. Extra directories are
        scanned by OpenCode and appear with a Loom extra badge.
      </p>

      <form className="catalog-settings__form" onSubmit={(event) => void handleAdd(event)}>
        <div className="field">
          <label className="field__label" htmlFor={inputId}>
            Absolute directory path
          </label>
          <div className="browser-path-form__row">
            <input
              className="input"
              id={inputId}
              name="extra-skill-directory"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                setInputError(null);
                setMutationError(null);
              }}
              aria-invalid={inputError !== null}
              aria-describedby={inputError === null ? undefined : inputErrorId}
              placeholder="/home/user/skills or C:\\Users\\you\\skills"
              disabled={busy !== null}
              data-testid="extra-directory-input"
            />
            <button
              type="submit"
              className="button"
              disabled={busy !== null || path.trim() === ''}
              data-testid="extra-directory-add"
            >
              {busy === 'adding' ? 'Adding…' : 'Add directory'}
            </button>
          </div>
          {inputError !== null ? (
            <p className="field__error" id={inputErrorId}>
              <span aria-hidden="true">! </span>
              {inputError}
            </p>
          ) : null}
        </div>
      </form>

      {mutationError !== null ? (
        <InlineError
          title="Extra directory update failed"
          message={mutationError.message}
          code={mutationError.code}
          httpStatus={mutationError.status}
        />
      ) : null}

      <h4 className="section-title catalog-settings__list-title">
        Configured directories
      </h4>

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="extra-directories-loading">
          <span aria-hidden="true">◌</span> Loading extra skill directories…
        </p>
      ) : null}

      {state.error !== null ? (
        <InlineError
          title="Extra skill directories could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => void reload()}
          retryLabel="Retry extra directories"
        />
      ) : null}

      {state.status === 'ready' && state.directories.length === 0 ? (
        <p className="empty-state" data-testid="extra-directories-empty">
          No extra skill directories configured. Add an absolute path above to scan
          skills outside the harness defaults.
        </p>
      ) : null}

      {state.status === 'ready' && state.directories.length > 0 ? (
        <ul className="catalog-settings__list">
          {state.directories.map((directory) => (
            <li
              className="catalog-settings__item"
              key={directory}
              data-testid="extra-directory-item"
              data-path={directory}
            >
              <code>{directory}</code>
              <button
                type="button"
                className="button button--secondary button--small button--danger"
                onClick={() => setConfirmingPath(directory)}
                disabled={busy !== null}
                aria-label={`Remove ${directory}`}
              >
                Remove
              </button>
              {confirmingPath === directory ? (
                <div
                  className="confirm-panel"
                  role="group"
                  aria-label={`Confirm removal of ${directory}`}
                >
                  <p>
                    Remove <code>{directory}</code> from Skill Loom&apos;s extra skill
                    directories? Skills in it will disappear from the catalog on the next
                    refresh. Files on disk are not deleted.
                  </p>
                  <div className="panel__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => void handleRemove(directory)}
                      disabled={busy !== null}
                      data-testid="extra-directory-confirm"
                    >
                      {busy === 'removing' ? 'Removing…' : 'Confirm remove'}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setConfirmingPath(null)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
