'use client';

import { useEffect, useState } from 'react';
import { basket } from './basket.storage.js';

/**
 * The server has no storage, so the first client render must match what the server produced —
 * otherwise React reports a hydration mismatch. Read after mount, not during render.
 */
export function BasketCount(): JSX.Element {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    setCount(basket.get('count'));
    return basket.subscribe('count', (event) => setCount(event.newValue ?? 0));
  }, []);

  if (count === undefined) return <span aria-busy="true">Basket</span>;
  return <span>Basket {count}</span>;
}
