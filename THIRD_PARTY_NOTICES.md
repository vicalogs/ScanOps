# Third-party components

The runtime includes qr-scanner 1.4.2 (MIT) and its embedded jsqr-es6 1.4.0-1
decoder (Apache-2.0).
The qr-scanner decoder is materialized from its distributed worker into a static
worker file without changing the decoding algorithm. Locator inference runs in
this project's own engine code; ONNX Runtime is no longer included.

Full upstream licenses are in `licenses/` and copied with browser assets — filenames
follow the SDK's own branding (see the table below for which file covers which
upstream project); their text is unmodified. Retain these files when deploying or
redistributing those components. React is an optional peer dependency and is not
bundled.

The locator-v2 model was trained in this project from generated QR scenes. It is
experimental and has not been validated for production performance on real devices.
It is not included in this package: each licensed customer receives their own build
from the licence service. There are no Dynamsoft binaries, model weights, or SDK code
in this package.

`scanops-engine.wasm` is built by this project from its own licensing and locator code
plus ZXing-C++ (Apache-2.0, vendored at the commit below).

Upstream references:
- https://github.com/nimiq/qr-scanner/tree/v1.4.2
- https://www.npmjs.com/package/jsqr-es6/v/1.4.0-1 (fork of Cosmo Wolfe's jsQR)

Original SDK code uses the package's separate license; upstream license permissions
remain intact. This inventory is an engineering record, not a completed legal review.

Barcode support additionally bundles zxing-wasm 3.1.3 (MIT) and its unmodified
ZXing-C++ reader WASM (Apache-2.0), built from commit
`a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f`.
The WASM SHA-256 is recorded in assets/scanops-manifest.json and checked before use.
ScanOps adds its own messaging adapter, UPC text normalization and bar-region
estimation around the upstream reader; the upstream binary is unchanged.
Licenses are retained in licenses/scanops-barcode-worker-license.txt and
licenses/scanops-engine-core-license.txt.

References: https://github.com/Sec-ant/zxing-wasm and https://github.com/zxing-cpp/zxing-cpp .
The bwip-js fixture generator is a development-only dependency and is not bundled
in the published runtime.

## Branded distribution filenames

ScanOps filenames identify the SDK distribution, not exclusive authorship of the
underlying engines. Original copyright notices and license files remain intact.

| Distribution file | Component / original file |
| --- | --- |
| `scanops-qr.worker.js` | Static worker extracted from qr-scanner's `qr-scanner-worker.min.js`, including jsqr-es6 |
| `scanops-barcode.worker.js` | ScanOps adapter bundled with zxing-wasm's reader JavaScript |
| `scanops-barcode.wasm` | Unmodified ZXing-C++ `zxing_reader.wasm` from zxing-wasm |
| `scanops-vision.worker.js` | ScanOps locator adapter bundled with the engine's emscripten JavaScript |
| `scanops-engine.wasm` | ScanOps engine: licensed locator pre-processing, inference and post-processing, built with emscripten |
| `scanops-locator.weights` / `scanops-locator.json` | Not shipped; a customer's licensed locator-v2 build, served from `licensedAssetsUrl` |

Explicit runtime URLs select the renamed loader and WASM; binary contents are not
rewritten. `scanops-manifest.json` records the layout, asset hashes and dependency
versions for verification and support.

License filenames follow the same convention — renamed to identify which SDK
component they cover rather than the upstream project name, with the license text
itself byte-for-byte unmodified (copyright notices intact):

| `licenses/` file | License | Covers | Upstream project |
| --- | --- | --- | --- |
| `scanops-qr-worker-license.txt` | MIT | `scanops-qr.worker.js` (decoding harness) | qr-scanner 1.4.2 |
| `scanops-qr-core-license.txt` | Apache-2.0 | `scanops-qr.worker.js` (embedded pixel reader) | jsqr-es6 1.4.0-1 |
| `scanops-barcode-worker-license.txt` | MIT | `scanops-barcode.wasm` / `scanops-barcode.worker.js` | zxing-wasm 3.1.3 |
| `scanops-engine-core-license.txt` | Apache-2.0 | `scanops-engine.wasm` (vendored decoder core) | ZXing-C++ (commit `a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f`) |
