/**
 * Types for the `jq-wasm/jq.wasm` sub-export (the raw wasm asset), ESM form.
 *
 * With a bundler asset rule (webpack `asset/resource`, esbuild `file`) the
 * import resolves to the emitted asset URL/path at runtime, hence `string`.
 * Vite's `jq-wasm/jq.wasm?url` form is typed by `vite/client`'s `*?url`
 * ambient instead and never reaches this declaration. If your loader
 * produces something else (e.g. a pre-compiled `WebAssembly.Module`), cast
 * at the import site.
 */
declare const wasmAssetUrl: string;
export default wasmAssetUrl;
