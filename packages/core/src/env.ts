/**
 * Deliberately *not* written as the literal `process.env.NODE_ENV` a bundler would substitute:
 * that form throws `ReferenceError` in a browser loading this package without a build step, and
 * nothing here is trying to be dead-code eliminated. It decides behaviour, not bytes (ADR-023).
 */
export function isProduction(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.NODE_ENV === 'production';
}
