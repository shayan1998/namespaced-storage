import { createLocalStorage } from 'namespaced-storage';

export interface BasketItem {
  id: string;
  qty: number;
}

/**
 * One declaration, next to the feature that owns it, exported. There is no registry file — run
 * `npx nss scan` to see every namespace in the app.
 */
export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  description: 'Shopping basket, survives reload',
  defaults: {
    count: 0,
    items: [] as BasketItem[],
    lastOpened: new Date(),
  },
});
