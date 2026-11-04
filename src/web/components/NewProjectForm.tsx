import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiClientError } from '../api/client';
import {
  projectsApi,
  toApiClientError,
  type ProjectRegistration,
  type ProjectsApi,
} from '../api/projects';
import { InlineError } from './InlineError';

const MAX_NAME_LENGTH = 255;

export interface NewProjectFormProps {
  parentPath: string;
  onCreated: (project: ProjectRegistration) => void;
  onCancel: () => void;
  api?: ProjectsApi;
}

function validateFolderName(value: string): string | null {
  if (value.trim() === '') {
    return 'Enter a folder name.';
  }
  if (value !== value.trim()) {
    return 'The folder name cannot start or end with whitespace.';
  }
  if (value === '.' || value === '..') {
    return 'Choose a name other than "." or "..".';
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return 'Use one folder name. Slashes and path separators are not allowed.';
  }
  if (value.length > MAX_NAME_LENGTH) {
    return `Keep the folder name to ${String(MAX_NAME_LENGTH)} characters or fewer.`;
  }
  return null;
}

function validateParent(value: string): string | null {
  if (value.trim() === '') {
    return 'Enter the parent folder for the new project.';
  }
  if (!value.startsWith('/')) {
    return 'The parent folder must be an absolute path starting with "/".';
  }
  return null;
}

/**
 * Compact new-project form.
 *
 * It creates one empty directory under an existing parent and optionally runs
 * `git init`. There are deliberately no template or scaffolding choices, and
 * the form never writes anything itself: the server owns every filesystem
 * operation.
 */
export function NewProjectForm({
  parentPath,
  onCreated,
  onCancel,
  api = projectsApi,
}: NewProjectFormProps) {
  const [parent, setParent] = useState(parentPath);
  const [name, setName] = useState('');
  const [gitInit, setGitInit] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [parentError, setParentError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [serverError, setServerError] = useState<ApiClientError | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    nameInput.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const nextNameError = validateFolderName(name);
    const nextParentError = validateParent(parent);
    setNameError(nextNameError);
    setParentError(nextParentError);
    if (nextNameError !== null || nextParentError !== null) {
      return;
    }

    setCreating(true);
    try {
      const project = await api.createProject({
        parentPath: parent.trim(),
        name,
        gitInit,
      });
      if (!mounted.current) {
        return;
      }
      setCreating(false);
      onCreated(project);
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      setCreating(false);
      setServerError(
        toApiClientError(error, 'An unexpected error prevented creating the project.'),
      );
    }
  };

  return (
    <section className="panel new-project" aria-labelledby="new-project-title">
      <h2 className="section-title" id="new-project-title">
        New project
      </h2>
      <p className="field__hint">
        Skill Loom creates one empty folder. Optionally initialize a git repository; no
        templates or scaffolding files are added.
      </p>

      {serverError !== null ? (
        <InlineError
          title="Project could not be created"
          message={serverError.message}
          code={serverError.code}
          httpStatus={serverError.status}
        />
      ) : null}

      <form className="project-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="new-project-parent">
            Parent folder
          </label>
          <input
            className="input"
            id="new-project-parent"
            name="parentPath"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={parent}
            onChange={(event) => {
              setParent(event.target.value);
              setParentError(null);
            }}
            aria-invalid={parentError !== null}
            aria-describedby={parentError !== null ? 'new-project-parent-error' : undefined}
          />
          {parentError !== null ? (
            <p className="field__error" id="new-project-parent-error" role="alert">
              {parentError}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="new-project-name">
            Folder name
          </label>
          <input
            className="input"
            id="new-project-name"
            name="name"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={name}
            ref={nameInput}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
            aria-invalid={nameError !== null}
            aria-describedby={nameError !== null ? 'new-project-name-error' : undefined}
          />
          {nameError !== null ? (
            <p className="field__error" id="new-project-name-error" role="alert">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="checkbox-field">
          <input
            id="new-project-git"
            name="gitInit"
            type="checkbox"
            checked={gitInit}
            onChange={(event) => setGitInit(event.target.checked)}
            aria-describedby="new-project-git-hint"
          />
          <label htmlFor="new-project-git">Initialize git repository</label>
          <p className="field__hint" id="new-project-git-hint">
            Runs <code>git init</code> in the new folder. Leave unchecked to create a plain
            directory.
          </p>
        </div>

        <div className="panel__actions">
          <button type="submit" className="button" disabled={creating} aria-busy={creating}>
            {creating ? 'Creating project…' : 'Create project'}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={creating}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
