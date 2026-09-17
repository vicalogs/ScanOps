// Execute the shipped browser worker in an isolated Node thread; only file loading
// and the browser messaging boundary are adapted. The decoder/WASM are unmodified.
import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
const assets = new URL('../dist/assets/', import.meta.url);
globalThis.self = { postMessage: value => parentPort.postMessage(value) };
globalThis.fetch = async input => {
  const url = new URL(input);
  if (!url.href.startsWith(assets.href)) throw new Error('Unexpected asset request');
  return new Response(await readFile(url));
};
await import('../dist/assets/scanops-barcode.worker.js');
parentPort.on('message', data => {
  if (data.type === 'init') data.assetBaseUrl = assets.href;
  void self.onmessage({ data });
});
