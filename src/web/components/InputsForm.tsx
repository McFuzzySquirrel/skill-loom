import { useId } from 'react';
import type { ChainInput } from '../api/chains';

/**
 * Run-start inputs form.
 *
 * Inputs render in declaration order. Required values are validated locally so
 * an empty value blocks Start immediately, while the same problem is still
 * reported by the server preflight for the authoritative finding. The form
 * never invents an input or rewrites a value.
 */

export interface InputsFormProps {
  inputs: ChainInput[];
  values: Record<string, string>;
  /** Validation messages keyed by declared input name. */
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (name: string, value: string) => void;
  onBlur?: (name: string) => void;
}

export function validateRequiredInputs(
  inputs: readonly ChainInput[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of inputs) {
    if (!input.required) {
      continue;
    }
    const value = values[input.name] ?? '';
    if (value.trim() === '') {
      errors[input.name] =
        `Provide a value for ${input.label ?? input.name}; this input is required.`;
    }
  }
  return errors;
}

export function InputsForm({
  inputs,
  values,
  errors = {},
  disabled = false,
  onChange,
  onBlur,
}: InputsFormProps) {
  const prefix = useId();

  return (
    <section className="preflight-panel" aria-labelledby={`${prefix}-title`}>
      <h2 className="section-title preflight-section-title" id={`${prefix}-title`}>
        Chain inputs
      </h2>

      {inputs.length === 0 ? (
        <p className="state-note" data-testid="preflight-inputs-empty">
          <span aria-hidden="true">✓</span> This chain declares no inputs.
        </p>
      ) : (
        <fieldset className="preflight-inputs" disabled={disabled}>
          <legend className="preflight-inputs__legend">
            Values are inserted at start and remembered for this chain after a successful start.
          </legend>
          {inputs.map((input) => {
            const inputId = `${prefix}-input-${input.name}`;
            const errorId = `${inputId}-error`;
            const hintId = `${inputId}-hint`;
            const value = values[input.name] ?? '';
            const error = errors[input.name];
            const describedBy =
              error === undefined ? hintId : `${hintId} ${errorId}`;

            return (
              <div
                className="field preflight-input"
                key={input.name}
                data-testid="preflight-input"
                data-input-name={input.name}
              >
                <label className="field__label" htmlFor={inputId}>
                  {input.label ?? input.name}
                  {input.required ? (
                    <span className="preflight-input__required"> (required)</span>
                  ) : (
                    <span className="preflight-input__optional"> (optional)</span>
                  )}
                </label>
                <code className="preflight-input__placeholder" id={hintId}>
                  {`{{${input.name}}}`}
                </code>
                <input
                  className="input"
                  id={inputId}
                  name={input.name}
                  type="text"
                  value={value}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(input.name, event.target.value)}
                  onBlur={() => onBlur?.(input.name)}
                  data-testid="preflight-input-field"
                />
                {error === undefined ? null : (
                  <p className="field__error" id={errorId} data-testid="preflight-input-error">
                    <span aria-hidden="true">! </span>
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}
