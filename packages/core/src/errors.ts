/**
 * Error taxonomy. Every error this package throws extends {@link NamespacedStorageError} and
 * carries a stable `code`, so consumers can branch on the code rather than on the message.
 */

export type ErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'NAMESPACE_CONFLICT'
  | 'INVALID_NAMESPACE'
  | 'INVALID_KEY'
  | 'INVALID_OPTIONS'
  | 'SERIALIZE'
  | 'DECODE'
  | 'VALIDATION'
  | 'SUBSCRIBER'
  | 'MIGRATION';

export interface ErrorContext {
  namespace?: string;
  key?: string;
  cause?: unknown;
}

const PREFIX = '[namespaced-storage]';

export class NamespacedStorageError extends Error {
  readonly code: ErrorCode;
  readonly namespace: string | undefined;
  readonly key: string | undefined;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
    super(`${PREFIX} ${message}`, 'cause' in context ? { cause: context.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.namespace = context.namespace;
    this.key = context.key;
    // Keeps `instanceof` working when a consumer downlevels to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StorageUnavailableError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('STORAGE_UNAVAILABLE', message, context);
  }
}

export class StorageQuotaError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('QUOTA_EXCEEDED', message, context);
  }
}

export class NamespaceConflictError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('NAMESPACE_CONFLICT', message, context);
  }
}

export class InvalidNamespaceError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('INVALID_NAMESPACE', message, context);
  }
}

export class InvalidKeyError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('INVALID_KEY', message, context);
  }
}

export class InvalidOptionsError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('INVALID_OPTIONS', message, context);
  }
}

export class SerializationError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('SERIALIZE', message, context);
  }
}

export class DecodeError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('DECODE', message, context);
  }
}

export class ValidationError extends NamespacedStorageError {
  /** Every way the value failed, with the path inside the value that failed. */
  readonly issues: ReadonlyArray<{ path: (string | number)[]; message: string }>;

  constructor(
    message: string,
    issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
    context?: ErrorContext,
  ) {
    super('VALIDATION', message, context);
    this.issues = issues;
  }
}

/** A change-event subscriber threw. Reported, never rethrown into the event loop. */
export class SubscriberError extends NamespacedStorageError {
  constructor(message: string, context?: ErrorContext) {
    super('SUBSCRIBER', message, context);
  }
}

/**
 * Browsers disagree about how a full quota is reported. Firefox uses a legacy name, older WebKit
 * uses numeric codes, and Safari private mode throws on the very first write.
 */
export function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  // Some environments (and some polyfills) throw a plain Error with a recognisable name.
  return error instanceof Error && /quota/i.test(error.name);
}
