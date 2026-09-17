import { lstat, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

// Only obsolete runtime outputs, never licenses or an entire directory tree.
const legacyFiles = [
  'decoder.worker.js', 'barcode.worker.js', 'locator.worker.js', 'version.json',
  'zxing/zxing_reader.wasm',
  'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm',
  'models/locator-v2/qr-locator.onnx', 'models/locator-v2/metadata.json',
  // The unlicensed locator model shipped up to 0.1.0-beta.2; upgrades must not leave it publicly served.
  'scanops-locator.onnx', 'scanops-locator.json',
  // onnxruntime-web, replaced by inference inside scanops-engine.wasm.
  'scanops-inference.mjs', 'scanops-inference.wasm',
];
const stat = path => lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });

export async function pruneLegacyAssets(destination) {
  const removed = [];
  if (!(await stat(destination))?.isDirectory()) return removed;
  for (const name of legacyFiles) {
    const parts = name.split('/');
    let parent = destination, safe = true;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      if (!(await stat(parent))?.isDirectory()) { safe = false; break; }
    }
    const path = join(destination, name);
    if (safe && (await stat(path))?.isFile()) { await unlink(path); removed.push(name); }
  }
  // Empty old folders only; nested user files and symbolic links stay untouched.
  for (const name of ['zxing', 'ort', 'models/locator-v2', 'models']) {
    const parts = name.split('/');
    let path = destination, safe = true;
    for (const part of parts) {
      path = join(path, part);
      if (!(await stat(path))?.isDirectory()) { safe = false; break; }
    }
    if (safe) await rmdir(path).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
  }
  return removed;
}
