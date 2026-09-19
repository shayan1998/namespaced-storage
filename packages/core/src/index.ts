export { createLocalStorage, createSessionStorage, createMemoryStorage } from './store/create.js';

export type {
  CorruptPolicy,
  FallbackPolicy,
  StoreOptions,
  SyncNamespacedStore,
  TrySetResult,
} from './types.js';

export {
  DecodeError,
  InvalidKeyError,
  InvalidNamespaceError,
  InvalidOptionsError,
  NamespacedStorageError,
  SerializationError,
  StorageQuotaError,
  StorageUnavailableError,
  type ErrorCode,
} from './errors.js';

export type { Adapter, AsyncAdapter, RawChange, SyncAdapter } from './adapters/types.js';
export { createMemoryAdapter, createNoopAdapter, resetMemoryAdapters } from './adapters/memory.js';
export { createWebStorageAdapter, type WebStorageKind } from './adapters/web-storage.js';
