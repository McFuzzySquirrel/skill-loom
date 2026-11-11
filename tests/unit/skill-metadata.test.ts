import { describe, expect, it } from 'vitest';
import {
  SKILL_METADATA_LIMITS,
  extractSkillMetadata,
} from '../../src/server/catalog/skill-metadata.js';

describe('skill metadata extraction', () => {
  it('reads tags, tools, inputs, outputs, and when_to_use deterministically', () => {
    const result = extractSkillMetadata({
      tags: ['release', 'Remote'],
      allowed_tools: 'Read Write, Bash',
      inputs: ['release_manifest', { name: 'target_channel' }],
      outputs: 'release_notes\nattestation_bundle',
      when_to_use: 'Use before a remote release.',
      metadata: { tags: ['remote', 'attestation'] },
    });
    expect(result.issues).toEqual([]);
    expect(result.metadata).toEqual({
      tags: ['release', 'Remote', 'attestation'],
      tools: ['Read', 'Write', 'Bash'],
      inputs: ['release_manifest', 'target_channel'],
      outputs: ['release_notes', 'attestation_bundle'],
      whenToUse: 'Use before a remote release.',
    });
  });

  it('keeps multi-word tags together and splits only declared separators', () => {
    const result = extractSkillMetadata({
      tags: 'react compiler, accessibility',
      inputs: 'release notes, target channel',
      allowed_tools: 'Read Grep Bash',
    });
    expect(result.metadata.tags).toEqual(['react compiler', 'accessibility']);
    expect(result.metadata.inputs).toEqual(['release notes', 'target channel']);
    expect(result.metadata.tools).toEqual(['Read', 'Grep', 'Bash']);
  });

  it('accepts kebab-case and camel-case when_to_use aliases', () => {
    expect(extractSkillMetadata({ 'when-to-use': 'When shipping.' }).metadata.whenToUse).toBe('When shipping.');
    expect(extractSkillMetadata({ whenToUse: 'When reviewing.' }).metadata.whenToUse).toBe('When reviewing.');
  });

  it('reports invalid shapes without inventing values', () => {
    const result = extractSkillMetadata({
      tags: { nested: true },
      tools: [42],
      inputs: [{ unknown: 'value' }],
      outputs: false,
      when_to_use: ['not a string'],
    });
    expect(result.metadata).toEqual({ tags: [], tools: [], inputs: [], outputs: [] });
    expect(result.issues).toEqual(['inputs', 'outputs', 'tags', 'tools', 'when_to_use']);
  });

  it('bounds list counts and long values', () => {
    const result = extractSkillMetadata({
      tags: Array.from({ length: SKILL_METADATA_LIMITS.tags + 5 }, (_, index) => `tag-${String(index)}`),
      inputs: [`${'x'.repeat(SKILL_METADATA_LIMITS.valueChars + 1)}`],
      when_to_use: { value: 'not a string' },
    });
    expect(result.metadata.tags).toHaveLength(SKILL_METADATA_LIMITS.tags);
    expect(result.metadata.inputs).toHaveLength(1);
    expect(result.metadata.inputs[0]).toHaveLength(SKILL_METADATA_LIMITS.valueChars);
    expect(result.issues).toEqual(['inputs', 'tags', 'when_to_use']);
  });

  it('returns empty metadata for absent fields', () => {
    expect(extractSkillMetadata({ name: 'demo', description: 'Demo' })).toEqual({
      metadata: { tags: [], tools: [], inputs: [], outputs: [] },
      issues: [],
    });
  });
});
