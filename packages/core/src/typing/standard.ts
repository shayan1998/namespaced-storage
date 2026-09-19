import { InvalidOptionsError } from '../errors.js';
import type { Issue, ParseResult } from './t.js';

/**
 * Minimal shape of the Standard Schema v1 contract (https://standardschema.dev), inlined so that
 * Zod, Valibot, ArkType and Effect Schema all work with **no peer dependency declared** and
 * nothing extra in the bundle for users who do not reach for one. See ADR-007.
 */
export interface StandardSchemaV1<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined;
  };
}

type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof (value as StandardSchemaV1)['~standard']?.validate === 'function'
  );
}

export function parseWithStandard(
  schema: StandardSchemaV1,
  value: unknown,
  namespace: string,
  key: string,
): ParseResult<unknown> {
  const result = schema['~standard'].validate(value);

  // Storage reads and writes are synchronous by design (ADR-006), so an async validator cannot
  // be honoured. Saying so plainly beats returning a Promise nobody awaits.
  if (result instanceof Promise) {
    throw new InvalidOptionsError(
      `The schema for "${key}" validates asynchronously, which a synchronous store cannot use. ` +
        `Use a synchronous validator for this key.`,
      { namespace, key },
    );
  }

  if (result.issues === undefined) return { ok: true, value: result.value };
  return { ok: false, issues: result.issues.map(toIssue) };
}

function toIssue(issue: StandardIssue): Issue {
  const path = (issue.path ?? []).map((segment) => {
    const raw = typeof segment === 'object' && segment !== null ? segment.key : segment;
    return typeof raw === 'number' ? raw : String(raw);
  });
  return { path, message: issue.message };
}
