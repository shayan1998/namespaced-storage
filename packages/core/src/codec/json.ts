import { SerializationError } from '../errors.js';

/**
 * The plain-JSON path. Values are stored exactly as `JSON.stringify` would write them, so anything
 * else that reads the raw key still works and pre-existing data stays readable (ADR-003).
 * M2 layers the envelope on top of this for values that need TTL, timestamps or a codec tag.
 */
export function encodeJson(value: unknown, namespace: string, key: string): string {
  let raw: string | undefined;
  try {
    raw = JSON.stringify(value);
  } catch (cause) {
    throw new SerializationError(
      `Could not serialize the value for "${key}" — ${describe(value)}. ` +
        `Circular references cannot be stored.`,
      { namespace, key, cause },
    );
  }
  if (raw === undefined) {
    // `undefined` is handled by the caller as a removal; anything else reaching here is a bug in
    // the calling code (a function, a symbol) rather than storable data.
    throw new SerializationError(
      `Could not serialize the value for "${key}" — ${describe(value)} has no JSON representation.`,
      { namespace, key },
    );
  }
  return raw;
}

function describe(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return 'a symbol';
  if (typeof value === 'bigint') return 'a bigint';
  return `a value of type ${typeof value}`;
}

/** Approximate stored size. Browsers count UTF-16 code units against the quota. */
export function approximateBytes(raw: string): number {
  return raw.length * 2;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
