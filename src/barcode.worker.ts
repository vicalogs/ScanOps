import { prepareZXingModule, readBarcodes, ZXING_WASM_SHA256 } from 'zxing-wasm/reader';
import { barcodeBounds } from './barcode-region.js';
import { validateFormats, SUPPORTED_FORMATS } from './formats.js';
import { RUNTIME_FILES } from './runtime-files.mjs';
import type { BarcodeFormat } from './formats.js';
import type { DetectedCode } from './types.js';

let ready = false, busy = false;
let formats: BarcodeFormat[] = [];
let maxCodes = 1;
self.onmessage = async ({ data: message }: MessageEvent) => {
  const { id, type, data, assetBaseUrl, token } = message;
  if (busy) { self.postMessage({ id, error: 'Barcode worker is busy; await the previous request' }); return; }
  busy = true;
  try {
    if (type === 'init') {
      formats = validateFormats(message.formats);
      maxCodes = message.maxCodes ?? 1;
      if (!Number.isInteger(maxCodes) || maxCodes < 1 || maxCodes > 10) throw new RangeError('maxCodes must be an integer between 1 and 10');
      const url = new URL(RUNTIME_FILES.barcodeWasm, assetBaseUrl);
      const response = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
      if (!response.ok) throw new Error(`Barcode WASM request failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== ZXING_WASM_SHA256) throw new Error('Barcode WASM fingerprint mismatch; copy assets from this SDK version');
      await prepareZXingModule({ overrides: { wasmBinary: bytes, locateFile: () => url.href }, fireImmediately: true });
      ready = true; self.postMessage({ id, result: true });
    } else if (type === 'decode') {
      if (!ready) throw new Error('Barcode engine is not initialized');
      if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width <= 0 || data.height <= 0 || !(data.data instanceof Uint8ClampedArray) || data.data.length !== data.width * data.height * 4) throw new Error('Invalid barcode frame');
      const results = await readBarcodes(data, { formats, tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: maxCodes, minLineCount: 2, returnErrors: false });
      const codes: DetectedCode[] = [];
      for (const code of results.filter(result => result.isValid && !result.error).slice(0, maxCodes)) {
        // ZXing may identify a variant (e.g. Code39Std). Expose the supported SDK family.
        let format = SUPPORTED_FORMATS.includes(code.format as BarcodeFormat) ? code.format as BarcodeFormat : code.symbology as BarcodeFormat;
        // UPC-A and leading-zero EAN-13 encode the same bars. Prefer UPC-A when enabled.
        if (format === 'EAN13' && formats.includes('UPCA') && /^0[0-9]{12}$/.test(code.text)) format = 'UPCA';
        if (!formats.includes(format)) continue;
        const { topLeft, topRight, bottomRight, bottomLeft } = code.position;
        let text = code.text;
        // Preserve the printed UPC representation instead of ZXing's EAN-13 expansion.
        if (format === 'UPCA' && /^0[0-9]{12}$/.test(text)) text = text.slice(1);
        if (format === 'UPCE' && code.extra) {
          const original = JSON.parse(code.extra).UPCE;
          if (typeof original === 'string' && /^[0-9]{8}$/.test(original)) text = original;
        }
        const corners = [topLeft, topRight, bottomRight, bottomLeft];
        codes.push({ data: text, format, cornerPoints: format === 'QRCode' ? corners : barcodeBounds(data, corners) });
      }
      self.postMessage({ id, ...(codes[0] ?? { data: null }), codes });
    } else throw new Error('Unknown barcode request');
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  finally { busy = false; }
};
