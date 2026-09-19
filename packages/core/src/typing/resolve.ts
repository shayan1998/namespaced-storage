import { encode } from '../codec/envelope.js';
import { decode } from '../codec/envelope.js';
import { InvalidOptionsError } from '../errors.js';
import { isStandardSchema, parseWithStandard } from './standard.js';
import { type Issue, type ParseResult, isTSchema } from './t.js';

export type AnySchema = { parse(value: unknown): ParseResult<unknown> } | { '~standard': unknown };

export type Validator = (value: unknown) => ParseResult<unknown>;

export interface ResolvedTyping {
  /** Keys that have a fallback value. */
  readonly defaults: Map<string, unknown>;
  readonly validators: Map<string, Validator>;
  /** Every key declared through `defaults` or `schema`. */
  readonly known: Set<string>;
  readonly typeNames: Map<string, string>;
}

/**
 * Returned defaults must never be the caller's own object: handing back the same array every time
 * means one `push` at a call site quietly corrupts the fallback for the whole app.
 */
export function cloneDefault(value: unknown, namespace: string, key: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to the codec, which handles everything we can actually store */
    }
  }
  return decode(encode(value, namespace, key), namespace, key).value;
}

export function resolveTyping(
  namespace: string,
  defaults: Record<string, unknown> | undefined,
  schema: Record<string, unknown> | undefined,
): ResolvedTyping | undefined {
  if (defaults === undefined && schema === undefined) return undefined;

  const validators = new Map<string, Validator>();
  const typeNames = new Map<string, string>();

  for (const [key, entry] of Object.entries(schema ?? {})) {
    validators.set(key, toValidator(entry, namespace, key));
    typeNames.set(key, isTSchema(entry) ? entry.name : 'schema');
  }

  const resolvedDefaults = new Map<string, unknown>(Object.entries(defaults ?? {}));

  // A key may appear in both: the schema supplies the type and the validation, the default
  // supplies the fallback (ADR-015). Catching a contradiction here beats discovering it on the
  // first read in production.
  for (const [key, value] of resolvedDefaults) {
    const validator = validators.get(key);
    if (!validator) continue;
    const result = validator(value);
    if (!result.ok) {
      throw new InvalidOptionsError(
        `The default for "${key}" does not satisfy its own schema: ${formatIssues(result.issues)}.`,
        { namespace, key },
      );
    }
  }

  return {
    defaults: resolvedDefaults,
    validators,
    known: new Set([...resolvedDefaults.keys(), ...validators.keys()]),
    typeNames,
  };
}

function toValidator(entry: unknown, namespace: string, key: string): Validator {
  if (isTSchema(entry)) return (value) => entry.parse(value);
  if (isStandardSchema(entry)) {
    return (value) => parseWithStandard(entry, value, namespace, key);
  }
  throw new InvalidOptionsError(
    `The schema for "${key}" is neither a built-in \`t.*\` schema nor a Standard Schema ` +
      `validator. Zod 3.24+, Valibot and ArkType all qualify.`,
    { namespace, key },
  );
}

export function formatIssues(issues: Issue[]): string {
  return issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}
