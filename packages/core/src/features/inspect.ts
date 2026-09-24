import { formatBytes } from '../codec/size.js';
import { isProduction } from '../env.js';
import type { SyncNamespacedStore } from '../types.js';

/** One row of `inspect()`, keyed in the table by the key it describes. */
interface InspectRow {
  value: unknown;
  type: string;
  size: string;
  expires: string;
}

/**
 * What a value *is*, in the vocabulary the codecs use, so the table and the storage format agree
 * with each other. `typeof` alone would call a Date, an array and a Map all "object".
 */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type !== 'object') return type;
  const name: unknown = (value as object).constructor?.name;
  return typeof name === 'string' ? name.toLowerCase() : 'object';
}

function formatExpiry(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/**
 * Writes a summary line and hands the rows to the host's own `console.table`. Drawing the table
 * here would cost more bytes than the whole feature and render worse: the browser's table folds
 * objects open, and ours would print `[object Object]` (ADR-023).
 */
export function printInspection(
  store: SyncNamespacedStore,
  bytesOf: (key: string) => number,
): void {
  const rows: Record<string, InspectRow> = {};
  let total = 0;

  for (const [key, value] of store.entries()) {
    const bytes = bytesOf(key);
    total += bytes;
    rows[key] = {
      value,
      type: typeName(value),
      size: formatBytes(bytes),
      expires: formatExpiry(store.ttl(key)),
    };
  }

  const count = Object.keys(rows).length;
  console.log(
    `namespaced-storage · ${store.namespace} (${store.adapter}) · ` +
      `${count} ${count === 1 ? 'key' : 'keys'} · ${formatBytes(total)}` +
      (store.available ? '' : ' · storage unavailable, using a fallback'),
  );
  console.table(rows);
}

/** The shape hung on `globalThis` in development. */
export interface Devtools {
  /** Every root store constructed on this page, by namespace path. */
  stores: Record<string, SyncNamespacedStore>;
  /** One row per namespace: backend, keys, bytes. */
  inspect(): void;
}

const GLOBAL_KEY = '__NAMESPACED_STORAGE__';

/**
 * Development only, and for a reason that is about behaviour rather than size: this holds every
 * store on the page alive, and hands any script a directory of everything the app persists.
 */
export function registerDevStore(store: SyncNamespacedStore): void {
  if (isProduction()) return;

  try {
    const host = globalThis as Record<string, unknown>;
    let devtools = host[GLOBAL_KEY] as Devtools | undefined;

    if (devtools === undefined) {
      // A plain string key, not the registry's `Symbol.for`: this one has to be typeable into a
      // console. Two copies of the package on a page therefore share one directory, which is what
      // someone typing it wants to see.
      const stores: Record<string, SyncNamespacedStore> = {};
      devtools = {
        stores,
        // Closed over rather than reading `this`, so `const { inspect } = __NAMESPACED_STORAGE__`
        // still works from a console.
        inspect: () => {
          for (const registered of Object.values(stores)) registered.inspect();
        },
      };
      host[GLOBAL_KEY] = devtools;
    }

    // localStorage and sessionStorage may each hold a namespace of the same name, so the second
    // one to arrive is qualified rather than quietly replacing the first. The same store arriving
    // again — a hot reload — simply takes its own place back.
    const existing = devtools.stores[store.namespace];
    devtools.stores[
      existing === undefined || existing.adapter === store.adapter
        ? store.namespace
        : `${store.namespace}@${store.adapter}`
    ] = store;
  } catch {
    /* a frozen or exotic globalThis is not worth failing a store's construction over */
  }
}
