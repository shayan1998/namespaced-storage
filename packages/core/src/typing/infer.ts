import type { StandardSchemaV1 } from './standard.js';
import type { TSchema } from './t.js';

/** The value type a single schema entry describes, whether it is ours or someone else's. */
export type InferEntry<S> =
  S extends TSchema<infer T>
    ? T
    : S extends StandardSchemaV1<infer O>
      ? O
      : S extends { '~standard': { types?: { output: infer O } } }
        ? O
        : unknown;

export type InferSchema<S> = { [K in keyof S]: InferEntry<S[K]> };

/**
 * The value map a store exposes. Where a key is declared in both places the schema wins, because
 * it is the more precise statement of the type; the default only supplies the fallback (ADR-015).
 */
export type StoreValues<D, S> = Omit<D, keyof S> & InferSchema<S>;

/** Keys that read back without `| undefined`, because a fallback always exists. */
export type DefaultedKeys<D, S> = keyof StoreValues<D, S> & keyof D;
