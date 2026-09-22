import { NamespaceConflictError, type NamespacedStorageError } from '../errors.js';

/**
 * Shared through `globalThis` rather than module scope, so the guard still works when a bundler
 * or a pnpm layout ends up with two copies of this package in one page — which is exactly the
 * situation where a silent namespace collision is most likely.
 */
const REGISTRY_KEY = Symbol.for('namespaced-storage.registry');

interface Registration {
  /** Where the store was constructed, or `undefined` when the engine would not say. */
  site: string | undefined;
}

type Registry = Map<string, Registration>;

function registry(): Registry {
  const host = globalThis as { [REGISTRY_KEY]?: Registry };
  return (host[REGISTRY_KEY] ??= new Map());
}

/** Test and HMR helper — forgets every registered namespace. */
export function resetNamespaceRegistry(): void {
  registry().clear();
}

function isProduction(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.NODE_ENV === 'production';
}

/** Stack frames belonging to this package, which sit between the caller and the capture. */
const OWN_FRAMES = ['/src/namespace/registry.', '/src/store/create.', '/dist/index.'];

/**
 * The first stack frame outside this package. Purely diagnostic: stack formats differ between
 * engines and minifiers rewrite them, so this returns `undefined` rather than guessing when it
 * cannot tell — and an unknown site is treated as *distinct*, so the guard fails loud.
 */
function callerSite(): string | undefined {
  const stack = new Error().stack;
  if (stack === undefined) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    if (OWN_FRAMES.some((own) => line.includes(own))) continue;
    const match = /\(?((?:[A-Za-z]:)?[^():\s]+:\d+:\d+)\)?\s*$/.exec(line.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

export interface ConflictCheck {
  /** Namespace path including any prefix, e.g. `myapp:basket`. */
  path: string;
  /** The *requested* backend, so `local` and `session` may share a namespace name. */
  backend: string;
  strict: boolean | undefined;
  report: (error: NamespacedStorageError) => void;
}

/**
 * Catches the accidental case: two places constructing the same namespace without knowing about
 * each other. It cannot stop anyone determined — see ADR-001 — but it turns a silent data
 * collision into a message naming both call sites.
 */
export function registerNamespace({ path, backend, strict, report }: ConflictCheck): void {
  if (strict === false) return;

  // Fail fast where a developer will see it; never white-screen a production page over it.
  // The conflict is still reported through onError, so a monitored app finds out either way.
  const shouldThrow = strict ?? !isProduction();

  const id = `${backend}::${path}`;
  const site = callerSite();
  const existing = registry().get(id);

  if (existing === undefined) {
    registry().set(id, { site });
    return;
  }

  // The same line of the same file running twice is a module re-evaluation, which is what Vite
  // does on every hot reload. Complaining about that would make the guard unusable in dev.
  // An unknown site is never treated as a match: silence is the one failure we cannot afford.
  if (existing.site !== undefined && existing.site === site) return;

  const error = new NamespaceConflictError(
    `Namespace "${path}" is already registered on ${backend}.\n` +
      `  first:  ${existing.site ?? 'unknown location'}\n` +
      `  second: ${site ?? 'unknown location'}\n` +
      `Import the existing store instead of creating a second one. ` +
      `Pass { strict: false } if two instances are intentional.`,
    { namespace: path },
  );

  report(error);
  if (shouldThrow) throw error;
}
