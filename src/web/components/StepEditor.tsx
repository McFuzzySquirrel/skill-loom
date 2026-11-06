import { useEffect, useId, useRef } from 'react';
import type { ChainStep } from '../api/chains';
import { HelpPopover } from './HelpPopover';

export interface StepEditorProps {
  step: ChainStep | null;
  position: number | null;
  totalSteps: number;
  /** Skill names discovered in the chain's catalog, plus the current skill. */
  skillOptions: string[];
  /**
   * Increment to move focus into the instruction field. The builder raises it
   * after Add as step so the keyboard path lands where work is needed.
   */
  focusRequest?: number;
  /** Placeholder problems for this step, already naming the input. */
  placeholderIssues?: string[];
  onChange: (
    patch: Partial<Pick<ChainStep, 'skillName' | 'instruction' | 'label'>>,
  ) => void;
}

/**
 * Editor for one selected step (CHAIN-FR-05).
 *
 * The instruction is required: a blank instruction marks the field invalid and
 * blocks save. The label is optional. Skill names come from the catalog, but a
 * chain is always bound to one harness, so this selector never changes harness.
 * All values are rendered as escaped React text.
 */
export function StepEditor({
  step,
  position,
  totalSteps,
  skillOptions,
  focusRequest,
  placeholderIssues = [],
  onChange,
}: StepEditorProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const skillId = `${baseId}-skill`;
  const instructionId = `${baseId}-instruction`;
  const instructionHelpId = `${baseId}-instruction-help`;
  const instructionErrorId = `${baseId}-instruction-error`;
  const labelId = `${baseId}-label`;
  const labelHelpId = `${baseId}-label-help`;
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusRequest !== undefined && focusRequest > 0) {
      instructionRef.current?.focus();
    }
  }, [focusRequest]);

  if (step === null) {
    return (
      <section className="builder-panel step-editor" aria-labelledby={titleId}>
        <div className="builder-panel__heading">
          <h2 className="section-title builder-panel__title" id={titleId}>
            Step editor
          </h2>
          <HelpPopover topic="stepEditor" />
        </div>
        <div className="empty-state" data-testid="step-editor-empty">
          <p>No step selected.</p>
          <p>Select a step in the ordered list to edit its instruction and label.</p>
        </div>
      </section>
    );
  }

  const instructionMissing = step.instruction.trim() === '';
  const hasPlaceholderIssues = placeholderIssues.length > 0;
  const options =
    step.kind === 'instruction' ? [] : skillOptions.includes(step.skillName)
      ? skillOptions
      : [step.skillName, ...skillOptions];

  return (
    <section
      className="builder-panel step-editor"
      aria-labelledby={titleId}
      data-testid="step-editor"
    >
      <div className="builder-panel__heading">
        <h2 className="section-title builder-panel__title" id={titleId}>
          Step editor
        </h2>
        <div className="builder-panel__heading-actions">
          <span className="builder-panel__count" data-testid="step-position">
            Step {String(position ?? '')} of {String(totalSteps)}
          </span>
          <HelpPopover topic="stepEditor" />
        </div>
      </div>

      <dl className="step-editor__meta">
        <div>
          <dt>Step id</dt>
          <dd>
            <code data-testid="step-id">{step.id}</code>
          </dd>
        </div>
      </dl>

      {step.kind === 'instruction' ? (
        <p className="field__hint" data-testid="step-kind">Instruction step — no installed skill required.</p>
      ) : <div className="field">
        <label className="field__label" htmlFor={skillId}>
          Skill
        </label>
        <select
          className="input"
          id={skillId}
          value={step.skillName}
          onChange={(event) => onChange({ skillName: event.target.value })}
          data-testid="step-skill"
        >
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="field__hint">
          One harness serves every step. Per-step harness switching is unsupported;
          duplicate the chain to use another harness.
        </p>
      </div>}

      <div className="field">
        <label className="field__label" htmlFor={instructionId}>
          Instruction for step {String(position ?? '')} (required)
        </label>
        <textarea
          className="input step-editor__instruction"
          id={instructionId}
          ref={instructionRef}
          value={step.instruction}
          onChange={(event) => onChange({ instruction: event.target.value })}
          rows={7}
          required
          aria-invalid={instructionMissing || hasPlaceholderIssues}
          aria-describedby={
            instructionMissing || hasPlaceholderIssues
              ? `${instructionHelpId} ${instructionErrorId}`
              : instructionHelpId
          }
          data-testid="step-instruction"
          placeholder={step.kind === 'instruction' ? 'Describe what the agent should do.' : 'Describe what the harness should do with this skill.'}
        />
        <p className="field__hint" id={instructionHelpId}>
          Use <code>{'{{input}}'}</code> placeholders only for inputs declared on this
          chain. The inputs editor lists every affected step before a rename.
        </p>
        {instructionMissing ? (
          <p className="field__error" id={instructionErrorId} data-testid="step-instruction-error">
            <span aria-hidden="true">! </span>
            Enter an instruction for step {String(position ?? '')} before saving.
          </p>
        ) : null}
        {hasPlaceholderIssues ? (
          <ul
            className="field__error step-editor__placeholder-errors"
            id={instructionErrorId}
            data-testid="step-placeholder-errors"
          >
            {placeholderIssues.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={labelId}>
          Step label (optional)
        </label>
        <input
          className="input"
          id={labelId}
          type="text"
          value={step.label ?? ''}
          onChange={(event) => onChange({ label: event.target.value })}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={labelHelpId}
          data-testid="step-label"
        />
        <p className="field__hint" id={labelHelpId}>
          {step.kind === 'instruction'
            ? 'Shown in the step list instead of “Instruction”.'
            : 'Shown in the step list instead of the skill name. The skill name stays visible.'}
        </p>
      </div>
    </section>
  );
}
