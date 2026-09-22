import { basket } from './basket.storage.js';

const output = document.querySelector('#basket') as HTMLElement;

function render(): void {
  // `count` has a default, so this is `number` — never `number | undefined`.
  const count = basket.get('count');
  const lastOpened = basket.get('lastOpened'); // a real Date, not a string
  output.textContent = `${count} items · last opened ${lastOpened.toLocaleString()}`;
}

document.querySelector('#add')?.addEventListener('click', () => {
  const items = basket.get('items');
  basket.set('items', [...items, { id: crypto.randomUUID(), qty: 1 }]);
  basket.set('count', items.length + 1);
  render();
});

document.querySelector('#empty')?.addEventListener('click', () => {
  // Scoped: this clears basket:* and touches nothing else on the origin.
  basket.clear();
  render();
});

// Another tab changing the basket updates this one. `source` says which tab it was.
basket.subscribe((event) => {
  if (event.source === 'remote') render();
});

basket.set('lastOpened', new Date());
render();

// In development: what is actually in here?
if (import.meta.env?.DEV) basket.inspect();
