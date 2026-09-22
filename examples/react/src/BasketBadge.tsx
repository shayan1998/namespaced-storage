import { basket } from './basket.storage.js';
import { useStoreValue } from './use-store.js';

export function BasketBadge(): JSX.Element {
  const count = useStoreValue<number>(basket, 'count') ?? 0;

  return (
    <button onClick={() => basket.set('count', count + 1)}>
      Basket <span aria-label={`${count} items`}>{count}</span>
    </button>
  );
}
