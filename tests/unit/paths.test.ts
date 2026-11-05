import { describe, expect, it } from 'vitest';
import { isAbsolutePath } from '../../src/shared/paths.js';

describe('isAbsolutePath', () => {
  it.each([
    ['/home/user/project', true],
    ['C:\\Users\\user\\project', true],
    ['D:/work/project', true],
    ['\\\\server\\share\\project', true],
    ['//server/share/project', true],
    ['relative/project', false],
    ['C:project', false],
    ['\\project', true],
    ['', false],
  ])('recognizes %j as absolute: %s', (value, expected) => {
    expect(isAbsolutePath(value)).toBe(expected);
  });
});
