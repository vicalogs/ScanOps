import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { candidateRois } from './candidate-rois.mjs';
import { sealLicenseConstants } from '../../../app/api/license/seal.ts';
import { deriveLicenseConstants } from '../../../app/api/license/derivation.ts';

const assets = new URL('../dist/assets/', import.meta.url);
const DOMAIN = 'licensed.test';
const licensedBase = `https://${DOMAIN}/customer/`;
const metadataOf = overrides => ({ version: 'locator-v2-licensed', licensed: true, inputSize: 192, confidenceThreshold: 0.9, maskThreshold: 0.5, minArea: 30, sha256: '', ...overrides });

let response;
// One object for every test: the worker module is imported once and sets onmessage on
// whichever `self` existed then, so a fresh object per test would lose the handler.
// `location` is the origin the engine checks the sealed domain against.
const workerSelf = { postMessage: value => { response = value; }, location: { hostname: DOMAIN } };
/** Loads the shipped worker with `fetch` serving dist assets plus the given licensed files. */
async function worker(licensedFiles) {
  globalThis.self = workerSelf;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.href.startsWith(assets.href)) return new Response(await readFile(url));
    const name = url.href.startsWith(licensedBase) && url.href.slice(licensedBase.length);
    if (name in licensedFiles) return new Response(await licensedFiles[name]());
    throw new Error(`Unexpected test request ${url}`);
  };
  await import('../dist/assets/scanops-vision.worker.js');
  return async message => { await self.onmessage({ data: message }); return response; };
}
const init = token => ({ id: 1, type: 'init', assetBaseUrl: assets.href, modelBaseUrl: licensedBase, token });

test('vision worker refuses plain models and licensed models without a token', async t => {
  const originalFetch = globalThis.fetch, originalSelf = globalThis.self;
  t.after(() => { globalThis.fetch = originalFetch; if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf; });
  let metadata = metadataOf({ licensed: undefined, version: 'locator-v2' });
  const send = await worker({ 'scanops-locator.json': () => JSON.stringify(metadata) });
  assert.match((await send(init('token'))).error, /Only licensed locator models/);
  metadata = metadataOf();
  assert.match((await send(init(undefined))).error, /requires a license token/);
});

// Needs fixtures that cannot be committed. To run: build the engine with a test seal
// key, export a model with a test derivation secret, then set the four SCANOPS_TEST_*
// vars (see packages/engine build + PUBLISH.md) and run npm test.
//   SCANOPS_SEAL_KEY=$SCANOPS_TEST_SEAL_KEY emcmake cmake -S packages/engine -B $B && cmake --build $B --target scanops_engine
//   python -m qr_locator.export_licensed --checkpoint artifacts/locator-v2/best.pt \
//     --secret $SCANOPS_TEST_ENGINE_SECRET --table-key $SCANOPS_TEST_TABLE_KEY --out $DIR/scanops-locator.onnx
//   SCANOPS_TEST_LICENSED_MODEL_DIR=$DIR SCANOPS_ENGINE_BUILD=$B npm run build && npm test
const { SCANOPS_TEST_ENGINE_SECRET: secret, SCANOPS_TEST_SEAL_KEY: sealKey, SCANOPS_TEST_TABLE_KEY: tableKey, SCANOPS_TEST_LICENSED_MODEL_DIR: modelDir } = process.env;
const FUTURE = Math.floor(Date.now() / 1000) + 600;
test('licensed model through the shipped worker and engine WASM matches the Python/ONNX reference regions', { skip: !(secret && sealKey && tableKey && modelDir) && 'set SCANOPS_TEST_ENGINE_SECRET, SCANOPS_TEST_SEAL_KEY, SCANOPS_TEST_TABLE_KEY and SCANOPS_TEST_LICENSED_MODEL_DIR' }, async t => {
  const originalFetch = globalThis.fetch, originalSelf = globalThis.self;
  t.after(() => { globalThis.fetch = originalFetch; if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf; });
  const directory = new URL(`file://${modelDir.endsWith('/') ? modelDir : modelDir + '/'}`);
  const send = await worker({
    'scanops-locator.json': () => readFile(new URL('scanops-locator.json', directory)),
    'scanops-locator.weights': () => readFile(new URL('scanops-locator.weights', directory)),
  });
  // Mirror the licence service: derive the constants (derivation secret + table key),
  // then seal them (seal key + key id) into the token body.
  const token = async ({ derivationKey = tableKey, derivationSecret = secret, seal = sealKey, keyId = 1, exp = FUTURE, domain = DOMAIN } = {}) => {
    const constants = await deriveLicenseConstants(Buffer.from(derivationSecret, 'hex'), derivationKey);
    const sealed = await sealLicenseConstants({ ...constants, exp, domain }, seal, keyId);
    return `${Buffer.from(JSON.stringify({ sealedLocator: sealed })).toString('base64url')}.signature`;
  };

  const floats = async name => { const bytes = await readFile(new URL(name, import.meta.url)); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
  // The worker takes RGBA; the saved tensor is exactly k/255, so it round-trips.
  const tensor = await floats('./onnx-input.f32'), plane = 192 * 192, input = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 4; c++) input[i * 4 + c] = c === 3 ? 255 : Math.round(tensor[c * plane + i] * 255);
  const metadata = JSON.parse(await readFile(new URL('scanops-locator.json', directory), 'utf8'));
  const reference = candidateRois(await floats('./onnx-expected.f32'), 192, 640, 480, metadata);
  const locate = () => send({ id: 2, type: 'locate', input: input.slice(), width: 640, height: 480 });

  assert.equal((await send(init(await token()))).error, undefined);
  const { error, result } = await locate();
  assert.equal(error, undefined);
  assert.ok(reference.length > 0); assert.equal(result.length, reference.length);
  for (let i = 0; i < reference.length; i++) {
    assert.deepEqual(result[i].scanRegion, reference[i].scanRegion);
    assert.ok(Math.abs(result[i].score - reference[i].score) < 1e-4);
  }

  // Sealed under a different key with the ring's id, or under an id the ring lacks: both
  // read as "not issued for this SDK build".
  assert.match((await send(init(await token({ seal: 'ab'.repeat(32) })))).error, /not issued for this SDK build/);
  assert.match((await send(init(await token({ keyId: 99 })))).error, /not issued for this SDK build/);
  assert.match((await send(init(await token({ exp: Math.floor(Date.now() / 1000) - 1 })))).error, /expired/);
  assert.match((await send(init(await token({ domain: 'evil.test' })))).error, /not valid for this origin/);

  // A refresh re-opens with a renewed token; a stale (past-exp) refresh is refused.
  assert.equal((await send(init(await token()))).error, undefined);
  assert.equal((await send({ id: 3, type: 'refresh', token: await token() })).error, undefined);
  assert.match((await send({ id: 3, type: 'refresh', token: await token({ exp: Math.floor(Date.now() / 1000) - 1 }) })).error, /expired/);

  // Constants for another customer's table key open (correct seal key) but do not fit this model.
  assert.equal((await send(init(await token({ derivationKey: '00'.repeat(32) })))).error, undefined);
  const stale = (await locate()).result;
  assert.notDeepEqual(stale.map(candidate => candidate.scanRegion), reference.map(candidate => candidate.scanRegion));
});
