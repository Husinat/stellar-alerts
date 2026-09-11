export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonPatchOperation =
  | { op: 'add' | 'replace'; path: string; value: JsonValue }
  | { op: 'remove'; path: string };

function escapePathSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pathFor(parent: string, segment: string | number): string {
  return `${parent}/${escapePathSegment(String(segment))}`;
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Produces a deterministic RFC 6902 patch transforming `before` into `after`.
 * Object keys are sorted and array changes are emitted index-by-index, which
 * makes the generated audit records stable and easy to review.
 */
export function createJsonPatch(before: JsonValue | undefined, after: JsonValue, parentPath = ''): JsonPatchOperation[] {
  if (before === undefined) return [{ op: 'add', path: parentPath || '/', value: after }];
  if (Object.is(before, after)) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    const operations: JsonPatchOperation[] = [];
    const sharedLength = Math.min(before.length, after.length);
    for (let index = 0; index < sharedLength; index++) {
      operations.push(...createJsonPatch(before[index], after[index], pathFor(parentPath, index)));
    }
    for (let index = before.length - 1; index >= after.length; index--) {
      operations.push({ op: 'remove', path: pathFor(parentPath, index) });
    }
    for (let index = before.length; index < after.length; index++) {
      operations.push({ op: 'add', path: pathFor(parentPath, index), value: after[index] });
    }
    return operations;
  }

  if (isObject(before) && isObject(after)) {
    const operations: JsonPatchOperation[] = [];
    const beforeKeys = Object.keys(before).sort();
    const afterKeys = Object.keys(after).sort();

    for (const key of beforeKeys) {
      if (!(key in after)) operations.push({ op: 'remove', path: pathFor(parentPath, key) });
    }
    for (const key of afterKeys) {
      const path = pathFor(parentPath, key);
      if (!(key in before)) operations.push({ op: 'add', path, value: after[key] });
      else operations.push(...createJsonPatch(before[key], after[key], path));
    }
    return operations;
  }

  return [{ op: 'replace', path: parentPath || '/', value: after }];
}
