// One asset contract for the build and every runtime loader.
export const RUNTIME_FILES = Object.freeze({
  qrWorker: 'scanops-qr.worker.js',
  barcodeWorker: 'scanops-barcode.worker.js',
  locatorWorker: 'scanops-vision.worker.js',
  candidateWorker: 'scanops-candidate.worker.js',
  barcodeWasm: 'scanops-barcode.wasm',
  engineWasm: 'scanops-engine.wasm',
  // Licensed, per customer, served from licensedAssetsUrl; never part of the package.
  model: 'scanops-locator.weights',
  modelMetadata: 'scanops-locator.json',
  manifest: 'scanops-manifest.json',
});
