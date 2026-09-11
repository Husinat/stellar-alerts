import { describe, expect, it } from 'vitest';
import { createJsonPatch } from '../state-diff';

describe('createJsonPatch', () => {
  it('creates add, remove, and replace operations for object state', () => {
    expect(createJsonPatch(
      { balance: 10, obsolete: true, nested: { label: 'old' } },
      { balance: 15, nested: { label: 'new' }, fresh: 'yes' },
    )).toEqual([
      { op: 'remove', path: '/obsolete' },
      { op: 'replace', path: '/balance', value: 15 },
      { op: 'add', path: '/fresh', value: 'yes' },
      { op: 'replace', path: '/nested/label', value: 'new' },
    ]);
  });

  it('handles array changes and JSON pointer escaping', () => {
    expect(createJsonPatch(
      { 'a/b': ['same', 'removed'] },
      { 'a/b': ['changed', 'added'] },
    )).toEqual([
      { op: 'replace', path: '/a~1b/0', value: 'changed' },
      { op: 'replace', path: '/a~1b/1', value: 'added' },
    ]);
  });

  it('emits a root add for the first snapshot', () => {
    expect(createJsonPatch(undefined, { value: 1 })).toEqual([
      { op: 'add', path: '/', value: { value: 1 } },
    ]);
  });

  it('returns no operations for equal state', () => {
    expect(createJsonPatch({ value: 1 }, { value: 1 })).toEqual([]);
  });
});
