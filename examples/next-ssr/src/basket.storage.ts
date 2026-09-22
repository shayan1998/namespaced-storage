import { createLocalStorage } from 'namespaced-storage';

/**
 * Declared at module scope, imported by server components and client components alike. Nothing
 * here touches `window` at construction: on the server the store falls back to memory, reports
 * once through `onError`, and `basket.available` is `false`.
 */
export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  defaults: { count: 0, lastOpened: new Date() },
  onError: (error) => {
    // A server render is the expected case, not an incident.
    if (error.code !== 'STORAGE_UNAVAILABLE') console.error(error);
  },
});
