import { describe, expect, it, vi } from 'vitest';
import { createCopilotAdapter } from '../../src/server/harness/copilot.js';
import { createOpenCodeAdapter } from '../../src/server/harness/opencode.js';
import {
  DEFAULT_OSC_BUFFER_BYTES,
  OSC7501_PREFIX,
  OSC7501_STATES,
  Osc7501Parser,
  Osc7501StateMachine,
  parseOsc7501Chunk,
  parseOsc7501Params,
  type Osc7501Event,
} from '../../src/server/runs/osc.js';
import {
  DEFAULT_SKILL_LINE_BUFFER_BYTES,
  MAX_SKILL_OBSERVATIONS,
  SKILL_OBSERVATION_CAPABILITIES,
  SkillObservationTracker,
  extractSkillNames,
  findSkillObservations,
  observeSkillFiring,
  observeSkillFiringForAdapter,
  stripTerminalEscapes,
} from '../../src/server/runs/observations.js';

const BEL = '\x07';
const ST = '\x1b\\';

function sequence(state: string, id?: string): string {
  const suffix = id === undefined ? '' : `;id=${id}`;
  return `${OSC7501_PREFIX}state=${state}${suffix}${BEL}`;
}

function stSequence(state: string, id?: string): string {
  const suffix = id === undefined ? '' : `;id=${id}`;
  return `${OSC7501_PREFIX}state=${state}${suffix}${ST}`;
}

function states(events: readonly Osc7501Event[]): string[] {
  return events.map((event) => event.state);
}

describe('OSC 7501 parameter parsing', () => {
  it('parses state and an optional ses_ session id in either order', () => {
    expect(parseOsc7501Params('state=working')).toEqual({
      state: 'working',
      sessionId: null,
      params: 'state=working',
    });
    expect(parseOsc7501Params('state=idle;id=ses_abc123')).toEqual({
      state: 'idle',
      sessionId: 'ses_abc123',
      params: 'state=idle;id=ses_abc123',
    });
    expect(parseOsc7501Params('id=ses_abc123;state=clear')).toEqual({
      state: 'clear',
      sessionId: 'ses_abc123',
      params: 'id=ses_abc123;state=clear',
    });
  });

  it('ignores unknown states, absent states, and unsafe ids without guessing', () => {
    expect(parseOsc7501Params('state=paused')).toBeNull();
    expect(parseOsc7501Params('state=')).toBeNull();
    expect(parseOsc7501Params('id=ses_abc')).toBeNull();
    expect(parseOsc7501Params('state=working;id=<script>')).toEqual({
      state: 'working',
      sessionId: null,
      params: 'state=working;id=<script>',
    });
  });

  it('exposes exactly the documented state vocabulary', () => {
    expect(OSC7501_STATES).toEqual(['working', 'idle', 'clear']);
  });
});

describe('streaming OSC 7501 parsing', () => {
  it('parses BEL- and ST-terminated sequences with optional ids', () => {
    const result = parseOsc7501Chunk(
      `${OSC7501_PREFIX}state=working;id=ses_one${BEL}${OSC7501_PREFIX}id=ses_two;state=idle${ST}`,
    );

    expect(states(result.events)).toEqual(['working', 'idle']);
    expect(result.events[0]?.sessionId).toBe('ses_one');
    expect(result.events[1]?.sessionId).toBe('ses_two');
    expect(result.remainder).toBe('');
  });

  it('parses every possible two-chunk split of a BEL-terminated sequence', () => {
    const text = sequence('working', 'ses_split');

    for (let split = 0; split <= text.length; split += 1) {
      const parser = new Osc7501Parser();
      const first = parser.push(text.slice(0, split));
      const second = parser.push(text.slice(split));
      const events = [...first, ...second];

      expect(states(events), `split at ${String(split)}`).toEqual(['working']);
      expect(events[0]?.sessionId, `split at ${String(split)}`).toBe('ses_split');
      expect(parser.remainder, `split at ${String(split)}`).toBe('');
    }
  });

  it('parses every possible two-chunk split of an ST-terminated sequence', () => {
    const text = stSequence('idle', 'ses_split_st');

    for (let split = 0; split <= text.length; split += 1) {
      const parser = new Osc7501Parser();
      const first = parser.push(text.slice(0, split));
      const second = parser.push(text.slice(split));
      const events = [...first, ...second];

      expect(states(events), `split at ${String(split)}`).toEqual(['idle']);
      expect(events[0]?.sessionId, `split at ${String(split)}`).toBe('ses_split_st');
    }
  });

  it('parses a working-then-idle stream fed one character at a time', () => {
    const input = `noise\x1b[31m${sequence('working')}middle${stSequence('idle')}trailer`;
    const parser = new Osc7501Parser();
    const events: Osc7501Event[] = [];

    for (const character of input) {
      events.push(...parser.push(character));
    }

    expect(states(events)).toEqual(['working', 'idle']);
    expect(parser.remainder).toBe('');
  });

  it('accepts a carried remainder from a previous parse call', () => {
    const first = parseOsc7501Chunk(`${OSC7501_PREFIX}state=wor`);
    expect(first.events).toEqual([]);
    expect(first.remainder).toBe(`${OSC7501_PREFIX}state=wor`);

    const second = parseOsc7501Chunk(`king${BEL}`, first.remainder);
    expect(states(second.events)).toEqual(['working']);
    expect(second.remainder).toBe('');
  });

  it('ignores unrelated ANSI, other OSC channels, and plain text mentioning states', () => {
    const input = [
      '\x1b[31mred\x1b[0m',
      '\x1b]0;window title\x07',
      '\x1b]8;;https://example.test\x1b\\link text\x1b]8;;\x1b\\',
      '\x1b]0;7501;state=idle\x07',
      '\x1b[?25l',
      'the state=idle and idle word appear in ordinary output',
      '\x1b22;0t',
    ].join('');

    const parser = new Osc7501Parser();
    expect(parser.push(input)).toEqual([]);
    expect(parser.remainder).toBe('');
  });

  it('finds valid sequences surrounded by unrelated ANSI output', () => {
    const parser = new Osc7501Parser();
    const events = parser.push(
      `\x1b[1m${sequence('working')}\x1b[0m unrelated \x1b]0;title\x07 ${stSequence('idle')}\x1b[2K`,
    );

    expect(states(events)).toEqual(['working', 'idle']);
  });

  it('does not swallow a later valid sequence after a malformed unterminated one', () => {
    const parser = new Osc7501Parser();
    const events = parser.push(
      `${OSC7501_PREFIX}state=working\x1b[31mred${sequence('idle')}`,
    );

    // The malformed sequence is not reported as working; the later complete
    // sequence is still parsed instead of being hidden by the broken one.
    expect(states(events)).toEqual(['idle']);
  });

  it('bounds an unterminated fragment instead of growing without limit', () => {
    const parser = new Osc7501Parser({ maxBufferBytes: 128 });
    const huge = `${OSC7501_PREFIX}state=working${'x'.repeat(4096)}`;

    expect(parser.push(huge)).toEqual([]);
    expect(parser.remainder).toBe('');

    const events = parser.push(sequence('idle'));
    expect(states(events)).toEqual(['idle']);
  });

  it('uses a 64 KiB default buffer cap', () => {
    expect(DEFAULT_OSC_BUFFER_BYTES).toBe(64 * 1024);
  });
});

describe('OSC 7501 completion state machine', () => {
  it('reports idle completion only after working in the same step', () => {
    const machine = new Osc7501StateMachine();
    const changes = machine.push(`${sequence('working')}${sequence('idle')}`);

    expect(changes.map((change) => change.state)).toEqual(['working', 'idle']);
    expect(changes[0]?.advanced).toBe(false);
    expect(changes[1]?.advanced).toBe(true);
    expect(machine.sawWorking).toBe(true);
    expect(machine.completed).toBe(true);
    expect(machine.advanced).toBe(true);
    expect(machine.phase).toBe('idle');
  });

  it('ignores idle without a prior working event', () => {
    const machine = new Osc7501StateMachine();
    const changes = machine.push(sequence('idle'));

    expect(changes).toEqual([]);
    expect(machine.sawWorking).toBe(false);
    expect(machine.completed).toBe(false);
    expect(machine.phase).toBe('unknown');
  });

  it('does not treat a quiet terminal as completion', () => {
    vi.useFakeTimers();
    try {
      const machine = new Osc7501StateMachine();
      machine.push(sequence('working'));

      expect(machine.push('output line\n')).toEqual([]);
      expect(machine.push('\x1b[2Kredraw')).toEqual([]);
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(machine.completed).toBe(false);
      expect(machine.phase).toBe('working');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets completion and working observation on clear', () => {
    const machine = new Osc7501StateMachine();
    machine.push(`${sequence('working')}${sequence('idle')}`);
    expect(machine.completed).toBe(true);

    const cleared = machine.push(sequence('clear'));
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.cleared).toBe(true);
    expect(cleared[0]?.advanced).toBe(false);
    expect(machine.sawWorking).toBe(false);
    expect(machine.completed).toBe(false);
    expect(machine.phase).toBe('clear');

    // An idle after clear still requires a fresh working event.
    expect(machine.push(sequence('idle'))).toEqual([]);
    expect(machine.completed).toBe(false);

    machine.push(sequence('working'));
    machine.push(sequence('idle'));
    expect(machine.completed).toBe(true);
  });

  it('reports the completion edge only once for repeated idle events', () => {
    const machine = new Osc7501StateMachine();
    machine.push(sequence('working'));

    const first = machine.push(sequence('idle'));
    const second = machine.push(sequence('idle'));

    expect(first[0]?.advanced).toBe(true);
    expect(second[0]?.advanced).toBe(false);
    expect(machine.completed).toBe(true);
  });

  it('tracks the optional session id and keeps parsing across id changes', () => {
    const machine = new Osc7501StateMachine();
    machine.push(sequence('working', 'ses_first'));
    expect(machine.sessionId).toBe('ses_first');

    machine.push(sequence('clear'));
    expect(machine.sessionId).toBe('ses_first');

    machine.push(sequence('working', 'ses_second'));
    machine.push(sequence('idle', 'ses_second'));
    expect(machine.sessionId).toBe('ses_second');
    expect(machine.completed).toBe(true);
  });

  it('reset clears everything for the next step', () => {
    const machine = new Osc7501StateMachine();
    machine.push(`${sequence('working', 'ses_old')}${sequence('idle', 'ses_old')}`);
    expect(machine.completed).toBe(true);

    machine.reset();

    expect(machine.phase).toBe('unknown');
    expect(machine.sawWorking).toBe(false);
    expect(machine.completed).toBe(false);
    expect(machine.sessionId).toBeNull();
  });

  it('handles completion split across chunks in either terminator form', () => {
    for (const complete of [sequence('working'), stSequence('working')]) {
      const machine = new Osc7501StateMachine();
      const idle = complete.includes(ST) ? stSequence('idle') : sequence('idle');

      for (const character of `${complete}noise${idle}`) {
        machine.push(character);
      }

      expect(machine.completed).toBe(true);
      expect(machine.phase).toBe('idle');
    }
  });
});

describe('skill observation parsing', () => {
  it('strips ANSI escapes and unsafe controls from a log line', () => {
    const stripped = stripTerminalEscapes(
      '\x1b[2m●\x1b[0m \x1b[36mskill(spike-skill)\x1b[0m\r\nnext\x00',
    );

    expect(stripped).toBe('● skill(spike-skill)\nnext');
  });

  it('observes a Copilot skill(name) log line and records evidence', () => {
    const output = [
      'thinking...',
      '\x1b[2m●\x1b[0m skill(\x1b[36mspike-skill\x1b[0m)',
      'done',
    ].join('\n');

    const observations = findSkillObservations(output);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      skillName: 'spike-skill',
      lineIndex: 1,
    });
    expect(observations[0]?.line).toBe('● skill(spike-skill)');
    expect(extractSkillNames(output)).toEqual(['spike-skill']);
  });

  it('does not confuse an unrelated hyphenated word with a skill line', () => {
    expect(extractSkillNames('my-skill(fake)\nskill()\nskill(   )')).toEqual([]);
  });

  it('returns observed with the observed name when evidence exists', () => {
    const result = observeSkillFiring({
      capability: 'log-lines',
      output: '● skill(spike-skill)\n',
    });

    expect(result.state).toBe('observed');
    expect(result.skillName).toBe('spike-skill');
    expect(result.capability).toBe('log-lines');
    expect(result.observations).toHaveLength(1);
  });

  it('returns unknown when observable output contains no skill evidence', () => {
    const result = observeSkillFiring({
      capability: 'log-lines',
      output: 'No skill token in this output.\n',
    });

    expect(result.state).toBe('unknown');
    expect(result.skillName).toBeNull();
    expect(result.observations).toEqual([]);
  });

  it('marks interactive OpenCode output not-observable even if it contains the token', () => {
    const result = observeSkillFiring({
      capability: 'unobservable',
      output: '● skill(spike-skill)\n',
    });

    expect(result.state).toBe('not-observable');
    expect(result.skillName).toBeNull();
    expect(result.observations).toEqual([]);
  });

  it('never throws for missing or non-string output', () => {
    expect(() =>
      observeSkillFiring({ capability: 'log-lines', output: null }),
    ).not.toThrow();
    expect(
      observeSkillFiring({ capability: 'log-lines', output: undefined }).state,
    ).toBe('unknown');
    expect(
      observeSkillFiring({
        capability: 'log-lines',
        output: 42 as unknown as string,
      }).state,
    ).toBe('unknown');
  });

  it('prefers the expected step skill when several skills are observed', () => {
    const output = '● skill(other-skill)\n● skill(wanted-skill)\n';

    const matching = observeSkillFiring({
      capability: 'log-lines',
      output,
      expectedSkillName: 'wanted-skill',
    });
    expect(matching.state).toBe('observed');
    expect(matching.skillName).toBe('wanted-skill');
    expect(matching.matchesExpected).toBe(true);

    const mismatched = observeSkillFiring({
      capability: 'log-lines',
      output,
      expectedSkillName: 'missing-skill',
    });
    expect(mismatched.state).toBe('observed');
    expect(mismatched.skillName).toBe('other-skill');
    expect(mismatched.matchesExpected).toBe(false);
  });

  it('uses the adapter capability instead of branching on a harness name', () => {
    const opencode = createOpenCodeAdapter();
    const copilot = createCopilotAdapter();

    expect(SKILL_OBSERVATION_CAPABILITIES).toEqual(['log-lines', 'unobservable']);
    expect(opencode.skillObservation).toBe('unobservable');
    expect(copilot.skillObservation).toBe('log-lines');

    expect(
      observeSkillFiringForAdapter(opencode, '● skill(spike-skill)').state,
    ).toBe('not-observable');
    expect(
      observeSkillFiringForAdapter(copilot, '● skill(spike-skill)').state,
    ).toBe('observed');
  });

  it('observes a skill line split across streaming chunks', () => {
    const tracker = new SkillObservationTracker({ capability: 'log-lines' });

    const pending = tracker.push('● skill(spike');
    expect(pending.state).toBe('unknown');

    const complete = tracker.push('-skill)\n');
    expect(complete.state).toBe('observed');
    expect(complete.skillName).toBe('spike-skill');
    expect(complete.observations[0]?.lineIndex).toBe(0);
  });

  it('finishes an unterminated final line and tracks its line number', () => {
    const tracker = new SkillObservationTracker({ capability: 'log-lines' });

    tracker.push('first line\nsecond line\n● skill(tail-skill)');
    expect(tracker.result().state).toBe('unknown');

    const result = tracker.finish();
    expect(result.state).toBe('observed');
    expect(result.skillName).toBe('tail-skill');
    expect(result.observations[0]?.lineIndex).toBe(2);
  });

  it('keeps the not-observable capability across streaming chunks', () => {
    const tracker = new SkillObservationTracker({ capability: 'unobservable' });

    expect(tracker.push('● skill(spike-skill)\n').state).toBe('not-observable');
    expect(tracker.finish().state).toBe('not-observable');
  });

  it('bounds retained observation evidence and incomplete line buffering', () => {
    expect(MAX_SKILL_OBSERVATIONS).toBeGreaterThan(0);
    expect(DEFAULT_SKILL_LINE_BUFFER_BYTES).toBe(8 * 1024);

    const many = Array.from(
      { length: MAX_SKILL_OBSERVATIONS + 5 },
      (_value, index) => `skill(skill-${String(index)})`,
    ).join('\n');
    const result = observeSkillFiring({ capability: 'log-lines', output: many });
    expect(result.observations).toHaveLength(MAX_SKILL_OBSERVATIONS);

    const tracker = new SkillObservationTracker({
      capability: 'log-lines',
      maxBufferedLineBytes: 32,
    });
    expect(() => tracker.push(`${'x'.repeat(100)} skill(spike-skill)`)).not.toThrow();
    expect(tracker.result().state).toBe('observed');
  });

  it('reset discards collected evidence', () => {
    const tracker = new SkillObservationTracker({ capability: 'log-lines' });
    tracker.push('● skill(spike-skill)\n');
    expect(tracker.result().state).toBe('observed');

    tracker.reset();
    expect(tracker.result().state).toBe('unknown');
  });
});
