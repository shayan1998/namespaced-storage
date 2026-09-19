import { InvalidKeyError, InvalidNamespaceError, InvalidOptionsError } from '../errors.js';

/**
 * Characters allowed in a prefix / namespace / child segment. Deliberately excludes the default
 * separator, which is what guarantees a segment can never be confused with a separator boundary.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const DEFAULT_SEPARATOR = ':';

/** Internal bookkeeping lives under this prefix and is hidden from `keys()`/`size`/`entries()`. */
export const RESERVED_KEY_PREFIX = '__nss';

export function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_KEY_PREFIX);
}

export function assertValidSegment(segment: string, what: string, namespace?: string): void {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new InvalidNamespaceError(
      `${what} must be a non-empty string, received ${JSON.stringify(segment)}.`,
      namespace === undefined ? {} : { namespace },
    );
  }
  if (!SEGMENT_PATTERN.test(segment)) {
    throw new InvalidNamespaceError(
      `${what} "${segment}" contains characters outside [A-Za-z0-9_.-]. ` +
        `Those characters are reserved so a segment can never collide with the separator.`,
      namespace === undefined ? {} : { namespace },
    );
  }
}

export function assertValidSeparator(separator: string): void {
  if (typeof separator !== 'string' || separator.length === 0) {
    throw new InvalidOptionsError(
      `separator must be a non-empty string, received ${JSON.stringify(separator)}.`,
    );
  }
  // If the separator is made only of characters a segment may contain, a segment could embed it
  // and the encoded key would become ambiguous.
  if (SEGMENT_PATTERN.test(separator)) {
    throw new InvalidOptionsError(
      `separator "${separator}" is built from characters that are also legal inside a namespace, ` +
        `which would make keys ambiguous. Use something like ":" or "::" or "/".`,
    );
  }
}

export function assertValidKey(key: string, namespace: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidKeyError(`key must be a non-empty string, received ${JSON.stringify(key)}.`, {
      namespace,
    });
  }
  if (isReservedKey(key)) {
    throw new InvalidKeyError(
      `key "${key}" is reserved — keys may not start with "${RESERVED_KEY_PREFIX}".`,
      { namespace, key },
    );
  }
}

export interface KeyCodec {
  /** The full string every key in this namespace starts with, e.g. `"myapp:basket:"`. */
  readonly fullPrefix: string;
  /** Human-readable namespace path, e.g. `"basket:items"`. Used in errors and devtools. */
  readonly path: string;
  readonly segments: readonly string[];
  encode(key: string): string;
  /** Returns the namespace-relative key, or `null` if the raw key belongs to someone else. */
  decode(rawKey: string): string | null;
}

export interface KeyCodecOptions {
  /** `[prefix?, namespace, ...children]` — already ordered. */
  segments: readonly string[];
  separator?: string;
}

export function createKeyCodec({
  segments,
  separator = DEFAULT_SEPARATOR,
}: KeyCodecOptions): KeyCodec {
  assertValidSeparator(separator);
  const namespace = segments.join(separator);
  for (const segment of segments) {
    assertValidSegment(segment, 'namespace segment', namespace);
  }

  const fullPrefix = namespace + separator;

  return {
    fullPrefix,
    path: namespace,
    segments,
    encode(key) {
      // The key is always the final segment, so it may contain the separator freely.
      return fullPrefix + key;
    },
    decode(rawKey) {
      return rawKey.startsWith(fullPrefix) ? rawKey.slice(fullPrefix.length) : null;
    },
  };
}
