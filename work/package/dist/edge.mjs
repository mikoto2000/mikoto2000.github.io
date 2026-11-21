import {
  JqError,
  makeConvenience,
  makeLoadJq,
  moduleHook
} from "./chunk-OUKQZV2W.mjs";

// src/edge.ts
import jqModule from "./build/jq.wasm";
var defaultBuilder = (reject) => ({
  instantiateWasm: moduleHook(jqModule, reject)
});
function fromURL() {
  throw new TypeError(
    "jq-wasm (edge): wasmURL is not supported on Workers/edge; pass wasmModule (a pre-compiled WebAssembly.Module)."
  );
}
var platform = { defaultBuilder, fromURL };
var loadJq = makeLoadJq(platform);
var { raw, json, first, version } = makeConvenience(loadJq);
export {
  JqError,
  first,
  json,
  loadJq,
  raw,
  version
};
