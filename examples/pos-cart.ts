import { ScanOps } from '@scanops/browser-sdk';
import type { DetectedCode } from '@scanops/browser-sdk';

/**
 * POS "scan to add to cart" pattern.
 *
 * Listen on 'confirmed', not 'result': 'result' fires every processed frame,
 * so a product held in front of the camera for a second would add itself a
 * dozen times. 'confirmed' fires once per presentation — it stays silent
 * while the same code remains in view, and only fires again once the item
 * has actually left the frame and a new one (or the same one again, for a
 * second unit) is confirmed.
 */

const video = document.querySelector<HTMLVideoElement>('#camera')!;
const cartList = document.querySelector<HTMLElement>('#cart')!;
const totalEl = document.querySelector<HTMLElement>('#total')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;

const cart = new Map<string, { code: DetectedCode; quantity: number }>();

function renderCart() {
  cartList.replaceChildren();
  let total = 0;
  for (const { code, quantity } of cart.values()) {
    total += quantity;
    const row = document.createElement('li');
    row.textContent = `${code.data}（${code.format}） × ${quantity}`;
    cartList.appendChild(row);
  }
  totalEl.textContent = `共 ${total} 件`;
}

function addToCart(code: DetectedCode) {
  const key = `${code.format}:${code.data}`;
  const entry = cart.get(key);
  if (entry) entry.quantity++;
  else cart.set(key, { code, quantity: 1 });
  renderCart();
}

const scanner = new ScanOps({
  license: { key: 'YOUR_LICENSE_KEY', endpoint: 'https://your-domain.com/api/license/authorize' },
  assetBaseUrl: '/scanops/',
  // Cashiers move fast: confirm a little more strictly, and re-arm sooner
  // once an item actually leaves the frame, than the general-purpose defaults.
  confirmationFrames: 3,
  confirmationWindowMs: 400,
});

scanner.on('confirmed', ({ code }) => addToCart(code));
scanner.on('state', state => { statusEl.textContent = state === 'running' ? '扫描中，将商品条码放入画面' : state; });
scanner.on('error', error => { statusEl.textContent = error.message; });

document.querySelector('#start')!.addEventListener('click', () => { void scanner.start(video).catch(() => {}); });
document.querySelector('#stop')!.addEventListener('click', () => scanner.stop());
document.querySelector('#clear')!.addEventListener('click', () => { cart.clear(); renderCart(); });
window.addEventListener('pagehide', () => scanner.stop());
