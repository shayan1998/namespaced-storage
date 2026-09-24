import { DecodeError, SerializationError } from '../errors.js';

/**
 * Types JSON cannot represent, recorded out of band so the payload itself stays a faithful copy
 * of the user's structure. See ADR-014 for why the tags are paths rather than inline markers.
 */
export type TypeTag =
  'date' | 'map' | 'set' | 'bigint' | 'regexp' | 'undef' | 'nan' | 'inf' | '-inf';

/** Location inside the payload. `[]` is the root; numbers index arrays. */
export type Path = (string | number)[];

export type TagEntry = [Path, TypeTag];

export interface Encoded {
  payload: unknown;
  tags: TagEntry[];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface WalkState {
  tags: TagEntry[];
  /** Ancestors on the current branch, so a genuine cycle is caught but shared refs are allowed. */
  seen: Set<object>;
  namespace: string;
  key: string;
}

export function encodeValue(value: unknown, namespace: string, key: string): Encoded {
  const state: WalkState = { tags: [], seen: new Set(), namespace, key };
  const payload = walk(value, [], state);
  return { payload, tags: state.tags };
}

function walk(value: unknown, path: Path, state: WalkState): unknown {
  if (value === undefined) {
    // Nested `undefined` is preserved; JSON would drop the key entirely.
    // (A *top-level* undefined never reaches here — the store treats it as a removal.)
    state.tags.push([path, 'undef']);
    return null;
  }
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // JSON.stringify turns all three of these into `null`, silently.
      if (Number.isNaN(value)) return tagged(state, path, 'nan');
      if (value === Infinity) return tagged(state, path, 'inf');
      if (value === -Infinity) return tagged(state, path, '-inf');
      return value;
    case 'bigint':
      state.tags.push([path, 'bigint']);
      return value.toString();
    case 'function':
    case 'symbol':
      throw new SerializationError(
        `Could not serialize ${describePath(path)} of "${state.key}" — a ${typeof value} has no ` +
          `JSON representation.`,
        { namespace: state.namespace, key: state.key },
      );
    default:
      break;
  }

  const object = value as object;
  if (state.seen.has(object)) {
    throw new SerializationError(
      `Could not serialize the value for "${state.key}" — it contains a circular reference at ` +
        `${formatPath(path)}.`,
      { namespace: state.namespace, key: state.key },
    );
  }
  state.seen.add(object);
  try {
    return walkObject(object, path, state);
  } finally {
    state.seen.delete(object);
  }
}

function walkObject(object: object, path: Path, state: WalkState): unknown {
  if (object instanceof Date) {
    state.tags.push([path, 'date']);
    const time = object.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (object instanceof RegExp) {
    state.tags.push([path, 'regexp']);
    return [object.source, object.flags];
  }
  if (object instanceof Map) {
    state.tags.push([path, 'map']);
    return [...object].map(([entryKey, entryValue], index) => [
      walk(entryKey, [...path, index, 0], state),
      walk(entryValue, [...path, index, 1], state),
    ]);
  }
  if (object instanceof Set) {
    state.tags.push([path, 'set']);
    return [...object].map((entry, index) => walk(entry, [...path, index], state));
  }
  // Honour `toJSON` exactly as JSON.stringify would, after the built-ins above have had their say.
  const toJSON = (object as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return walk((toJSON as () => unknown).call(object), path, state);
  }
  if (Array.isArray(object)) {
    return object.map((entry, index) => walk(entry, [...path, index], state));
  }
  const out: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(object)) {
    out[entryKey] = walk(entryValue, [...path, entryKey], state);
  }
  return out;
}

function tagged(state: WalkState, path: Path, tag: TypeTag): null {
  state.tags.push([path, tag]);
  return null;
}

function describePath(path: Path): string {
  return path.length === 0 ? 'the value' : `the value at ${path.join('.')}`;
}

function formatPath(path: Path): string {
  return path.length === 0 ? 'the root' : path.join('.');
}

export function decodeValue(
  payload: unknown,
  tags: TagEntry[],
  namespace: string,
  key: string,
): unknown {
  if (tags.length === 0) return payload;

  // Deepest first: a Map is still a plain array of pairs while its entries are being revived.
  const ordered = [...tags].sort((a, b) => b[0].length - a[0].length);
  let root = payload;

  for (const entry of ordered) {
    const [path, tag] = entry;
    if (path.length === 0) {
      root = revive(root, tag, namespace, key);
      continue;
    }
    const parent = resolve(root, path.slice(0, -1));
    if (parent === undefined) continue; // the payload no longer matches the tag; skip it
    const last = path[path.length - 1] as string | number;
    const container = parent as Record<string | number, unknown>;
    container[last] = revive(container[last], tag, namespace, key);
  }

  return root;
}

function resolve(root: unknown, path: Path): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current === null || typeof current !== 'object' ? undefined : current;
}

function revive(value: unknown, tag: TypeTag, namespace: string, key: string): unknown {
  try {
    switch (tag) {
      case 'date':
        return value === null ? new Date(NaN) : new Date(value as number);
      case 'map':
        return new Map(value as [unknown, unknown][]);
      case 'set':
        return new Set(value as unknown[]);
      case 'bigint':
        return BigInt(value as string);
      case 'regexp': {
        const [source, flags] = value as [string, string];
        return new RegExp(source, flags);
      }
      case 'undef':
        return undefined;
      case 'nan':
        return NaN;
      case 'inf':
        return Infinity;
      case '-inf':
        return -Infinity;
    }
  } catch (cause) {
    throw new DecodeError(
      `Could not restore the "${tag}" value stored for "${key}" — the payload does not match ` +
        `the recorded type.`,
      { namespace, key, cause },
    );
  }
}
