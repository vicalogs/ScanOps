/** The emscripten build of packages/engine, aliased in by scripts/build.mjs. */
declare module 'scanops-engine' {
  interface EmbindVector<T> { size(): number; get(index: number): T; delete(): void }
  interface LocatorCandidate { score: number; scanRegion: { x: number; y: number; width: number; height: number } }
  export interface ScanOpsEngineModule {
    /** A view of `byteLength` engine bytes to fill with the model weights before loading. */
    licensedLocatorWeights(byteLength: number): Uint8Array;
    licensedLocatorFrame(): Uint8Array;
    /** Parses the filled weights buffer into the network. Empty on success, else why it was refused. */
    loadLocatorWeights(): string;
    /** Opens the sealed key against the current time and this worker's domain. Empty on success;
     * 'seal_unverified' (another build/edited), 'seal_expired', 'seal_domain', 'seal_malformed'. */
    openLicensedLocator(sealedTableKey: string, nowSeconds: number, domain: string): string;
    locateLicensed(width: number, height: number, confidence: number, maskThreshold: number, minArea: number): EmbindVector<LocatorCandidate>;
  }
  export default function ScanOpsEngine(options: { wasmBinary: Uint8Array }): Promise<ScanOpsEngineModule>;
}

/** SHA-256 of the engine WASM this worker was built against; injected by scripts/build.mjs. */
declare const SCANOPS_ENGINE_WASM_SHA256: string;
