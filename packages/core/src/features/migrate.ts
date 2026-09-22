import type { SyncAdapter } from '../adapters/types.js';
import { decode, isExpired, peekMeta } from '../codec/envelope.js';
import { isPlainObject } from '../codec/tags.js';
import { InvalidOptionsError, MigrationError, NamespacedStorageError } from '../errors.js';
import { RESERVED_KEY_PREFIX, createKeyCodec, isReservedKey } from '../namespace/key.js';
import type { StoreOptions, SyncNamespacedStore } from '../types.js';

/**
 * The namespace's own record, as opposed to any one entry's: `{"v":2}` under
 * `<namespace>:__nss:meta`. Reserved, so it is already hidden from `keys()`, `entries()`, `size`
 * and `subscribe()`, and already removed by `clear()`. See PLAN §6.3.
 */
const META_KEY = `${RESERVED_KEY_PREFIX}:meta`;

export interface MigrationContext {
  /** `[prefix?, namespace]` — the root store's segments, never a child's. */
  segments: readonly string[];
  adapter: SyncAdapter;
  options: StoreOptions;
  /** Used for the write-back, so migrated values are validated and encoded like any other write. */
  store: SyncNamespacedStore;
  report: (error: NamespacedStorageError) => void;
}

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/**
 * Checked at construction, before the namespace is registered and before anything is written:
 * a malformed call reports its own mistake first (ADR-021).
 */
export function assertMigrationOptions(options: StoreOptions, namespace: string): void {
  const { version, migrate } = options;

  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    throw new InvalidOptionsError(
      `version must be a whole number of 1 or more, received ${JSON.stringify(version)}.`,
      { namespace },
    );
  }

  // A migration that can never run is dead code pretending to be a safety net.
  if (migrate !== undefined && (version ?? 1) === 1) {
    throw new InvalidOptionsError(
      `migrate could never run at version ${version ?? 1}. Raise version to 2 or above.`,
      { namespace },
    );
  }
}

/**
 * Brings the namespace up to `options.version`, once, at construction.
 *
 * Runs after the store is built and the namespace registered: `assertMigrationOptions` has already
 * rejected a malformed call (ADR-021), and a duplicate namespace is caught before its data would
 * be rewritten twice.
 */
export function runMigration({
  segments,
  adapter,
  options,
  store,
  report,
}: MigrationContext): void {
  const { version, migrate } = options;

  // Level 1 pays nothing for level 3: no read, no write, no reserved key.
  if (version === undefined && migrate === undefined) return;
  const target = version ?? 1;
  if (target === 1) return;

  const path = store.namespace;
  const separator = options.separator;
  const codec = createKeyCodec(separator === undefined ? { segments } : { segments, separator });
  const metaKey = codec.encode(META_KEY);
  const stamped = adapter.getItem(metaKey);

  const fail = (message: string, from?: number, cause?: unknown): MigrationError => {
    const error = new MigrationError(
      message,
      from === undefined ? { to: target } : { from, to: target },
      cause === undefined ? { namespace: path } : { namespace: path, cause },
    );
    report(error);
    return error;
  };

  /** Records the new version, unless that exact record is already on disk. */
  const stamp = (): void => {
    const raw = JSON.stringify({ v: target });
    if (raw === stamped) return;
    try {
      adapter.setItem(metaKey, raw);
    } catch (cause) {
      // The data is migrated; only the bookkeeping failed. Reporting beats undoing the work.
      report(
        new MigrationError(
          `Migrated to v${target}, but the version could not be recorded — it runs again next load.`,
          { to: target },
          { namespace: path, cause },
        ),
      );
    }
  };

  /**
   * Every readable, unexpired key in the namespace, decoded but deliberately **not** validated:
   * data in an old shape is exactly what a migration exists to see, and validating it here would
   * hand the migration the current defaults instead of the values it is meant to migrate.
   *
   * A key that cannot be decoded is reported and left out — and, because the write-back only
   * removes keys the migration dropped from the snapshot, left on disk rather than deleted by
   * omission.
   */
  const snapshot = (): Record<string, unknown> => {
    const now = Date.now();
    const out: Record<string, unknown> = {};
    for (const rawKey of adapter.keys()) {
      const key = codec.decode(rawKey);
      if (key === null || isReservedKey(key)) continue;
      const raw = adapter.getItem(rawKey);
      if (raw === null || isExpired(peekMeta(raw), now)) continue;
      try {
        out[key] = decode(raw, path, key).value;
      } catch (error) {
        if (!(error instanceof NamespacedStorageError)) throw error;
        report(error);
      }
    }
    return out;
  };

  /**
   * The version the stored data is written at, or `null` when there is nothing left to do.
   *
   * No record while data is present means the data predates versioning, which is version 1 by
   * definition. No record and nothing stored is a fresh namespace: it is stamped, not migrated.
   */
  const storedVersion = (): number | null => {
    if (stamped === null) {
      const hasData = adapter.keys().some((rawKey) => {
        const key = codec.decode(rawKey);
        return key !== null && !isReservedKey(key);
      });
      return hasData ? 1 : target;
    }

    const found = parseVersion(stamped);

    if (found === undefined) {
      // Someone wrote over the record by hand. Guessing "1" could re-run a destructive migration
      // over already-migrated data, so the data is left alone and only the record is repaired.
      fail(
        `Unreadable version record. The data was left alone and the record reset to v${target}.`,
      );
      stamp();
      return null;
    }

    if (found > target) {
      // A rolled-back deploy, not a corruption. Throwing would white-screen everyone whose data is
      // ahead of the code they were just served; `onInvalid` still governs the values themselves.
      fail(
        `This namespace holds v${found} data, newer than the v${target} this build declares. ` +
          `Left untouched.`,
        found,
      );
      return null;
    }

    return found;
  };

  const from = storedVersion();
  if (from === null) return;

  if (from < target && migrate !== undefined) {
    const previous = snapshot();
    // Copied before the migration sees it: a migration may mutate the snapshot in place, and the
    // write-back has to know what the namespace looked like before it did.
    const original = { ...previous };

    let returned: Record<string, unknown> | void;
    try {
      returned = migrate(previous, from);
    } catch (cause) {
      throw fail(`Migration v${from} → v${target} threw.`, from, cause);
    }

    if (typeof (returned as { then?: unknown } | undefined)?.then === 'function') {
      throw fail(
        `Migration v${from} → v${target} returned a promise; storage is synchronous.`,
        from,
      );
    }

    // Returning nothing means the snapshot was mutated in place, which is the shortest correct
    // migration. Anything that is not a plain object is a mistake, never an intent.
    const next = returned === undefined ? previous : returned;
    if (!isPlainObject(next)) {
      throw fail(
        `Migration v${from} → v${target} must return an object of key/value pairs, or nothing.`,
        from,
      );
    }

    try {
      for (const key of Object.keys(original)) {
        if (!hasOwn(next, key)) store.remove(key);
      }
      for (const [key, value] of Object.entries(next)) {
        // Compared by reference: a value the migration carried across untouched keeps its place,
        // its timestamps and its TTL.
        if (hasOwn(original, key) && Object.is(original[key], value)) continue;
        store.set(key, value);
      }
    } catch (cause) {
      throw fail(
        `Migration v${from} → v${target} could not be written; the version stays at v${from}.`,
        from,
        cause,
      );
    }
  }

  stamp();
}

function parseVersion(raw: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  const { v } = parsed;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : undefined;
}
