/**
 * A deliberately small validator, enough for the shapes people actually keep in storage.
 * Anything richer is a job for a Standard Schema validator (Zod, Valibot, ArkType) — see
 * `./standard.ts`. Nothing here is a dependency for users who only want namespacing.
 */

export interface Issue {
  path: (string | number)[];
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const BRAND = '~nss';

export interface TSchema<T> {
  readonly [BRAND]: true;
  /** Human-readable type name, used in messages and by `nss scan`. */
  readonly name: string;
  parse(value: unknown): ParseResult<T>;
  optional(): TSchema<T | undefined>;
  nullable(): TSchema<T | null>;
}

export function isTSchema(value: unknown): value is TSchema<unknown> {
  return typeof value === 'object' && value !== null && BRAND in value;
}

function define<T>(name: string, parse: (value: unknown) => ParseResult<T>): TSchema<T> {
  const schema: TSchema<T> = {
    [BRAND]: true,
    name,
    parse,
    optional: () =>
      define<T | undefined>(`${name} | undefined`, (value) =>
        value === undefined ? { ok: true, value: undefined } : parse(value),
      ),
    nullable: () =>
      define<T | null>(`${name} | null`, (value) =>
        value === null ? { ok: true, value: null } : parse(value),
      ),
  };
  return schema;
}

function fail(message: string, path: (string | number)[] = []): ParseResult<never> {
  return { ok: false, issues: [{ path, message }] };
}

function primitive<T>(name: string, test: (value: unknown) => boolean): TSchema<T> {
  return define<T>(name, (value) =>
    test(value)
      ? { ok: true, value: value as T }
      : fail(`expected ${name}, received ${describe(value)}`),
  );
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a Date';
  return `a ${typeof value}`;
}

/** Prefixes every issue from a nested parse with the segment it came from. */
function under(segment: string | number, issues: Issue[]): Issue[] {
  return issues.map((issue) => ({ ...issue, path: [segment, ...issue.path] }));
}

export const t = {
  string: () => primitive<string>('a string', (v) => typeof v === 'string'),
  number: () => primitive<number>('a number', (v) => typeof v === 'number' && Number.isFinite(v)),
  boolean: () => primitive<boolean>('a boolean', (v) => typeof v === 'boolean'),
  bigint: () => primitive<bigint>('a bigint', (v) => typeof v === 'bigint'),
  unknown: () => define<unknown>('unknown', (value) => ({ ok: true, value })),

  date: () =>
    define<Date>('a Date', (value) =>
      value instanceof Date
        ? Number.isNaN(value.getTime())
          ? fail('expected a valid Date, received an invalid one')
          : { ok: true, value }
        : fail(`expected a Date, received ${describe(value)}`),
    ),

  literal: <const T extends string | number | boolean>(expected: T): TSchema<T> =>
    define<T>(JSON.stringify(expected), (value) =>
      value === expected
        ? { ok: true, value: expected }
        : fail(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(value)}`),
    ),

  enum: <const T extends readonly [string, ...string[]]>(values: T): TSchema<T[number]> =>
    define<T[number]>(values.map((v) => JSON.stringify(v)).join(' | '), (value) =>
      typeof value === 'string' && (values as readonly string[]).includes(value)
        ? { ok: true, value: value as T[number] }
        : fail(`expected one of ${values.join(', ')}, received ${JSON.stringify(value)}`),
    ),

  array: <T>(item: TSchema<T>): TSchema<T[]> =>
    define<T[]>(`${item.name}[]`, (value) => {
      if (!Array.isArray(value)) return fail(`expected an array, received ${describe(value)}`);
      const issues: Issue[] = [];
      const out: T[] = [];
      value.forEach((entry, index) => {
        const result = item.parse(entry);
        if (result.ok) out.push(result.value);
        else issues.push(...under(index, result.issues));
      });
      return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
    }),

  object: <S extends Record<string, TSchema<unknown>>>(
    shape: S,
  ): TSchema<{ [K in keyof S]: S[K] extends TSchema<infer T> ? T : never }> =>
    define('an object', (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(`expected an object, received ${describe(value)}`);
      }
      const input = value as Record<string, unknown>;
      const issues: Issue[] = [];
      for (const [key, member] of Object.entries(shape)) {
        const result = member.parse(input[key]);
        if (!result.ok) issues.push(...under(key, result.issues));
      }
      // Undeclared properties are passed through rather than stripped: silently dropping
      // stored data would be a worse surprise than carrying it.
      return issues.length > 0
        ? { ok: false, issues }
        : {
            ok: true,
            value: value as { [K in keyof S]: S[K] extends TSchema<infer T> ? T : never },
          };
    }),

  record: <T>(item: TSchema<T>): TSchema<Record<string, T>> =>
    define<Record<string, T>>(`Record<string, ${item.name}>`, (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(`expected an object, received ${describe(value)}`);
      }
      const issues: Issue[] = [];
      for (const [key, entry] of Object.entries(value)) {
        const result = item.parse(entry);
        if (!result.ok) issues.push(...under(key, result.issues));
      }
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, value: value as Record<string, T> };
    }),

  union: <const S extends readonly [TSchema<unknown>, ...TSchema<unknown>[]]>(
    members: S,
  ): TSchema<S[number] extends TSchema<infer T> ? T : never> =>
    define(members.map((m) => m.name).join(' | '), (value) => {
      for (const member of members) {
        const result = member.parse(value);
        if (result.ok) return result as ParseResult<never>;
      }
      return fail(
        `expected ${members.map((m) => m.name).join(' or ')}, received ${describe(value)}`,
      );
    }),
};
