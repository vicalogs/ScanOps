import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { RUNTIME_FILES } from '../src/runtime-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const qrRoot = dirname(require.resolve('qr-scanner/package.json'));
const zxingWasm = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
const zxingRoot = dirname(dirname(dirname(zxingWasm)));
const { ZXING_WASM_SHA256 } = await import('zxing-wasm/reader');
for (const [folder, name] of [[qrRoot, 'qr-scanner'], [zxingRoot, 'zxing-wasm']]) {
  const dependency = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  if (dependency.version !== manifest.devDependencies[name]) throw new Error(`Unexpected ${name} version: ${dependency.version}`);
}
// The engine carries the compiled-in secret, so it is built per release rather than
// taken from npm: `SCANOPS_ENGINE_SECRET=… emcmake cmake -S packages/engine -B <dir>`.
const engineBuild = process.env.SCANOPS_ENGINE_BUILD;
if (!engineBuild) throw new Error('Set SCANOPS_ENGINE_BUILD to the emscripten build directory of packages/engine');
const engineWasm = join(engineBuild, 'scanops_engine.wasm');
const engineWasmSha256 = createHash('sha256').update(await readFile(engineWasm)).digest('hex');
const dist = join(root, 'dist'), assets = join(dist, 'assets');
await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
// Integrators supply only their key; the licence endpoints are ours. Override the
// origin for a staging build; leaving it empty keeps the URLs same-origin, which is
// what this repo's own demo (which imports the SDK from source) relies on.
const serviceOrigin = (process.env.SCANOPS_PUBLIC_ORIGIN ?? 'https://scaner.niigel.com').replace(/\/$/, '');
const common = { absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'inline',
  define: { SCANOPS_SERVICE_ORIGIN: JSON.stringify(serviceOrigin) } };
await build({ ...common, entryPoints: ['src/index.ts'], outfile: join(dist, 'scanops.js') });
await build({ ...common, entryPoints: ['src/react.tsx'], outfile: join(dist, 'scanops-react.js'), external: ['react', 'react/jsx-runtime'], banner: { js: "'use client';" } });
// The emscripten glue only reaches node:* on its Node code path, which the worker never takes.
await build({ ...common, entryPoints: ['src/locator.worker.ts'], outfile: join(assets, RUNTIME_FILES.locatorWorker), minify: true, alias: { 'scanops-engine': join(engineBuild, 'scanops_engine.js') }, external: ['node:*'], define: { ...common.define, SCANOPS_ENGINE_WASM_SHA256: JSON.stringify(engineWasmSha256) } });
await copyFile(engineWasm, join(assets, RUNTIME_FILES.engineWasm));
await build({ ...common, entryPoints: ['src/barcode.worker.ts'], outfile: join(assets, RUNTIME_FILES.barcodeWorker), minify: true });
await build({ ...common, entryPoints: ['src/candidate.worker.ts'], outfile: join(assets, RUNTIME_FILES.candidateWorker), minify: true });
const barcodeBytes = await readFile(zxingWasm);
if (createHash('sha256').update(barcodeBytes).digest('hex') !== ZXING_WASM_SHA256) throw new Error('Barcode WASM checksum mismatch');
await copyFile(zxingWasm, join(assets, RUNTIME_FILES.barcodeWasm));
// Materialize the upstream worker as a file so consumers do not need blob: worker CSP.
const upstream = await readFile(join(qrRoot, 'qr-scanner-worker.min.js'), 'utf8');
const scope = {
  Blob: class { constructor(parts) { this.source = parts.join(''); } },
  URL: { createObjectURL: value => value },
  Worker: class { constructor(value) { this.source = value.source; } },
};
vm.runInNewContext(upstream.replace('export const createWorker=', 'globalThis.createWorker='), scope);
await writeFile(join(assets, RUNTIME_FILES.qrWorker), '/* qr-scanner 1.4.2 (MIT), embedded jsqr-es6 1.4.0-1 (Apache-2.0). Worker materialized as a static module; see licenses/ and THIRD_PARTY_NOTICES.md. */\n' + scope.createWorker().source);
// No locator model ships in the package: each customer's licensed build is served
// from licensedAssetsUrl, so the model and its metadata are runtime names only.
const unshipped = new Set([RUNTIME_FILES.manifest, RUNTIME_FILES.model, RUNTIME_FILES.modelMetadata]);
await cp(join(root, 'licenses'), join(assets, 'licenses'), { recursive: true });
await copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(assets, 'THIRD_PARTY_NOTICES.md'));
const integrity = {};
for (const name of Object.values(RUNTIME_FILES).filter(name => !unshipped.has(name))) {
  integrity[name] = createHash('sha256').update(await readFile(join(assets, name))).digest('hex');
}
await writeFile(join(assets, RUNTIME_FILES.manifest), JSON.stringify({ sdk: manifest.version, assetLayout: 'scanops-v1', files: RUNTIME_FILES, sha256: integrity, decoder: manifest.devDependencies['qr-scanner'], barcodeDecoder: manifest.devDependencies['zxing-wasm'], barcodeWasmSha256: ZXING_WASM_SHA256, engineWasmSha256 }, null, 2) + '\n');
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
await writeFile(join(dist, 'types/scanops.d.ts'), "export * from './index.js';\n");
await writeFile(join(dist, 'types/scanops-react.d.ts'), "export * from './react.js';\n");
console.log(`Built ${manifest.name}@${manifest.version}`);
