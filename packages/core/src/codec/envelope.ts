import { DecodeError } from '../errors.js';
import { type TagEntry, decodeValue, encodeValue, isPlainObject } from './tags.js';

export const ENVELOPE_VERSION = 1;

/** The marker that distinguishes an envelope from a plain stored value. */
const MARKER = '__nss';

export interface EnvelopeMeta {
  /** createdAt, ms. */
  c?: number;
  /** updatedAt, ms. */
  u?: number;
  /** expiresAt, ms. */
  e?: number;
}

interface Envelope extends EnvelopeMeta {
  __nss: number;
  v: unknown;
  t?: TagEntry[];
}

export interface Decoded {
  value: unknown;
  meta: EnvelopeMeta | undefined;
}

function hasMeta(meta: EnvelopeMeta | undefined): meta is EnvelopeMeta {
  return (
    meta !== undefined && (meta.c !== undefined || meta.u !== undefined || meta.e !== undefined)
  );
}

function isEnvelope(value: unknown): value is Envelope {
  return isPlainObject(value) && typeof value[MARKER] === 'number';
}

/**
 * Writes the plain shape whenever it can, and only reaches for the envelope when something
 * genuinely needs it: a non-JSON type somewhere in the value, or metadata such as a TTL.
 * See ADR-003.
 */
export function encode(
  value: unknown,
  namespace: string,
  key: string,
  meta?: EnvelopeMeta,
): string {
  const { payload, tags } = encodeValue(value, namespace, key);

  // A user value that itself looks like an envelope must be wrapped, or reading it back would
  // mistake it for one. This is what keeps the round trip exact for every possible input.
  const ambiguous = isEnvelope(payload);

  if (tags.length === 0 && !hasMeta(meta) && !ambiguous) {
    return JSON.stringify(payload);
  }

  const envelope: Envelope = { [MARKER]: ENVELOPE_VERSION, v: payload, ...meta };
  if (tags.length > 0) envelope.t = tags;
  return JSON.stringify(envelope);
}

export function decode(raw: string, namespace: string, key: string): Decoded {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new DecodeError(`Could not parse "${key}" — the stored value is not valid JSON.`, {
      namespace,
      key,
      cause,
    });
  }

  // Anything without the marker is a plain value: written by us on the fast path, or by whatever
  // code owned this key before the package was adopted.
  if (!isEnvelope(parsed)) return { value: parsed, meta: undefined };

  if (parsed.__nss > ENVELOPE_VERSION) {
    throw new DecodeError(
      `"${key}" was written in envelope format v${parsed.__nss}, but this version of ` +
        `namespaced-storage only understands v${ENVELOPE_VERSION}. Upgrade the package.`,
      { namespace, key },
    );
  }

  const tags = Array.isArray(parsed.t) ? parsed.t : [];
  const value = decodeValue(parsed.v, tags, namespace, key);
  const meta: EnvelopeMeta = {};
  if (parsed.c !== undefined) meta.c = parsed.c;
  if (parsed.u !== undefined) meta.u = parsed.u;
  if (parsed.e !== undefined) meta.e = parsed.e;

  return { value, meta: hasMeta(meta) ? meta : undefined };
}
