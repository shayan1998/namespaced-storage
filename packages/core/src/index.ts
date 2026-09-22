export { createLocalStorage, createSessionStorage, createMemoryStorage } from './store/create.js';

export { t, type TSchema, type Issue, type ParseResult } from './typing/t.js';
export type { StandardSchemaV1 } from './typing/standard.js';
export type { InferEntry, InferSchema, StoreValues, DefaultedKeys } from './typing/infer.js';

export type {
  ChangeEvent,
  CorruptPolicy,
  EntryMeta,
  FallbackPolicy,
  InvalidPolicy,
  MigrateFn,
  SetOptions,
  StoreOptions,
  SyncNamespacedStore,
  TrySetResult,
  TypedStoreOptions,
  TypedSyncNamespacedStore,
  Unsubscribe,
} from './types.js';

export {
  DecodeError,
  InvalidKeyError,
  InvalidNamespaceError,
  InvalidOptionsError,
  MigrationError,
  NamespaceConflictError,
  NamespacedStorageError,
  SerializationError,
  StorageQuotaError,
  StorageUnavailableError,
  SubscriberError,
  ValidationError,
  type ErrorCode,
} from './errors.js';

export type { Devtools } from './features/inspect.js';

export type { Adapter, AsyncAdapter, RawChange, SyncAdapter } from './adapters/types.js';
export { createMemoryAdapter, createNoopAdapter, resetMemoryAdapters } from './adapters/memory.js';
export { createWebStorageAdapter, type WebStorageKind } from './adapters/web-storage.js';
export { resetNamespaceRegistry } from './namespace/registry.js';
