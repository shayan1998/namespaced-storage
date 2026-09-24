import type { RawChange } from './types.js';

export type RawListener = (change: RawChange) => void;

export interface Emitter {
  /** Adapters use this to skip the work of capturing old values when nobody is listening. */
  readonly size: number;
  add(listener: RawListener): () => void;
  emit(change: RawChange): void;
}

export function createEmitter(): Emitter {
  const listeners = new Set<RawListener>();
  return {
    get size() {
      return listeners.size;
    },
    add(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(change) {
      // A copy, so a listener that unsubscribes mid-delivery cannot disturb the iteration.
      for (const listener of [...listeners]) listener(change);
    },
  };
}
