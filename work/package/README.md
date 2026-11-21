# jq-wasm

**jq-wasm** is a WebAssembly-powered version of the powerful [jq](https://github.com/jqlang/jq/) JSON processor, built using [Emscripten](https://emscripten.org/). It brings the versatility of jq to **Node.js**, modern browsers, and edge runtimes like **Cloudflare Workers** without any native dependencies.

## 🚀 Features

- **Cross-Platform:** One import runs jq in Node.js (ESM + CommonJS), browsers/bundlers, and Cloudflare Workers / Vercel Edge — the right build is auto-selected via package exports.
- **No Native Dependencies:** Everything runs in WebAssembly.
- **Fully Typed:** Comes with TypeScript definitions for a great developer experience.
- **Familiar jq Syntax:** Use standard jq queries and command-line flags.

## 📦 Installation

Install via npm:

```console
npm install jq-wasm
```

or with Yarn:

```console
yarn add jq-wasm
```

## 🛠️ Usage

### Zero-config convenience (async)

For simple, one-off queries, import the top-level async functions directly. A default instance is created and reused automatically.

```ts
import { json, first, raw, version } from "jq-wasm";

// json() always returns an array — one element per jq output value
const results = await json({ foo: "bar", list: [1, 2, 3] }, ".list[]");
// → [1, 2, 3]

const first_result = await first({ a: 1 }, ".a");
// → 1

// raw() never throws on jq-level errors; inspect exitCode/stderr yourself
const { stdout, stderr, exitCode } = await raw({ x: [1, 2] }, ".x | .[]");

const v = await version();
// → "jq-1.8.2"
```

### Factory pattern: load once, call synchronously

Use `loadJq(options?)` when you need **synchronous** method calls after initialization — ideal for Piscina worker pools, server workers, or anywhere you want to avoid per-call async overhead.

```ts
import { loadJq } from "jq-wasm";

const jq = await loadJq(); // async init once

// All handle methods are SYNCHRONOUS
const results = jq.json({ a: [1, 2, 3] }, ".a[]");
// → [1, 2, 3]

const one = jq.first({ a: 1 }, ".a");
// → 1

for (const value of jq.stream({ a: [1, 2, 3] }, ".a[]")) {
  use(value); // lazy, sync iteration
}

const { stdout, stderr, exitCode } = jq.raw({ x: 1 }, ".x");

console.log(jq.version); // sync getter → "jq-1.8.2"
```

### Platform support

The same import works everywhere — the correct build is selected automatically via `package.json` export conditions:

| Environment | Notes |
| --- | --- |
| Node.js (ESM & CommonJS), Bun | Works out of the box; `jq.wasm` is read from disk. |
| Vite, webpack, Rollup | Bundler handles the wasm asset (see recipes below). |
| Cloudflare Workers, Vercel Edge | Auto-selected via `workerd` / `edge-light` conditions. |
| Browsers via CDN / native ESM | `jq.wasm` is fetched alongside the module. |
| Single-file bundles (`jq-wasm/inline`) | Wasm embedded as bytes — no separate asset to locate. |

## 📖 API

### `loadJq(options?): Promise<Jq>`

Compiles the wasm and returns a ready-to-use synchronous handle. Each call creates an **independent** instance (useful for worker pools — call `loadJq()` once per worker, then make synchronous calls per task).

Loader knobs (supply **at most one**; supplying more than one throws `TypeError`):

| Option | Type | When to use |
| --- | --- | --- |
| `wasmBinary` | `ArrayBuffer \| Uint8Array` | You already have the bytes (e.g. from `readFileSync`). |
| `wasmURL` | `string \| URL` | Point to the asset; `loadJq` fetches/reads it. Node: `http(s)://` is fetched, `file://`/paths are read from disk. Browser: fetched. Edge/inline: unsupported (rejects with guidance). |
| `wasmModule` | `WebAssembly.Module` | Pre-compiled module — for Workers / cross-thread transfer. |
| `instantiateWasm` | function | Full Emscripten escape hatch for custom instantiation. Must call `onSuccess(instance)`; the return value is ignored (returning exports without calling back rejects instead of hanging). |
| *(none)* | — | Platform default (Node: disk; browser: fetch; edge: pre-compiled module; inline: embedded bytes). |

### Handle methods (synchronous)

All methods on the returned `Jq` handle are **synchronous** — call them without `await`.

#### `jq.raw(input, query, flags?): JqResult`

Low-level: runs jq and returns `{ stdout, stderr, exitCode }`. **Never throws** on jq-level errors. Use this when you need full control over the output, or to inspect warnings.

- **`input`**: `string | number | boolean | object | null`. A `string` is passed to jq as-is (raw JSON text); all other types are `JSON.stringify`-d first.
- **`query`**: A jq query string.
- **`flags`** *(optional)*: Array of jq CLI flags (e.g. `["-r"]` for raw string output).

#### `jq.json<T>(input, query, flags?): T[]`

Runs jq and returns **all outputs as an array** — `[]` when jq produces no output. Throws `JqError` on a real jq failure (see Error model below).

Because `json()`/`first()`/`stream()` parse jq's output as JSON, flags that change the output format (`-r`/`--raw-output`, `-j`/`--join-output`, `--tab`, `--indent`, `--seq`, `-C`/`--color-output`) are rejected with a `TypeError` — use `raw()` for non-JSON output.

#### `jq.first<T>(input, query, flags?): T | undefined`

Returns the first output value, or `undefined` if jq produces no output. Throws `JqError` on failure.

#### `jq.stream<T>(input, query, flags?): IterableIterator<T>`

Returns a lazy synchronous iterator over parsed output values. Throws `JqError` on failure.

#### `jq.version: string`

Sync getter. Returns the underlying jq version string (e.g. `"jq-1.8.2"`), computed on first access and memoized.

### Zero-config async functions

These functions use a memoized default handle and are always async. They are equivalent to the handle methods, but do not require an explicit `loadJq()` call.

```ts
raw(input, query, flags?): Promise<JqResult>
json<T>(input, query, flags?): Promise<T[]>
first<T>(input, query, flags?): Promise<T | undefined>
version(): Promise<string>
```

There is no top-level `stream` — for streaming, use `loadJq()` and call `jq.stream(...)` on the handle.

### Error model

`json()`, `first()`, and `stream()` throw a typed `JqError` under exactly one condition:

> `exitCode !== 0` **and** `stderr !== ""`

| jq situation | exitCode | stderr | Behavior |
| --- | --- | --- | --- |
| Success | 0 | `""` | Return result(s) |
| Warning (`debug`, deprecation, `@stderr`) | 0 | non-empty | **Return** result(s) — warnings do not throw. Use `raw()` to inspect them. |
| Compile / runtime error | ≠ 0 | non-empty | **Throw `JqError`** |
| `--exit-status` / `-e` truthiness | ≠ 0 | `""` | **Return** result(s) — use `raw()` to check `exitCode`. |

`raw()` never throws on jq-level errors.

`JqError` carries `.stderr`, `.exitCode`, and `.query`. `e instanceof JqError` is safe even when multiple copies of the package coexist (CJS + ESM, or `jq-wasm` + `jq-wasm/inline`): the check matches by error name, not class identity.

Two guard rails around the JSON-parsing methods: output-format flags are rejected up front with a `TypeError` (see `jq.json` above), and in the unlikely event jq still emits something unparseable, it surfaces as a `JqError` — never a bare `SyntaxError`.

### Sub-exports

- **`jq-wasm/jq.wasm`** — resolves to the wasm asset. Feed it to the loader knobs (see Bundler recipes below).
- **`jq-wasm/inline`** — the wasm is embedded as bytes. Exports the same API (`loadJq`, `raw`, `json`, `first`, `version`) with no separate asset to locate. Useful for single-file bundles and environments where asset resolution is awkward.

## 🔧 Bundler / framework recipes

These recipes pair the bundler's asset-resolution side with the correct `loadJq` knob. They were verified against jqplay.

### Node.js / Next.js `output: "standalone"`

```ts
import { loadJq } from "jq-wasm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const jq = await loadJq({
  wasmBinary: readFileSync(require.resolve("jq-wasm/jq.wasm")),
});
```

The explicit `require.resolve` puts `jq.wasm` in Next's static-analysis import graph, so the file tracer copies it into the standalone output automatically — no `outputFileTracingIncludes` workaround needed. The `createRequire` line makes the snippet work in plain Node ESM too (in CJS, drop it and use the built-in `require`).

### webpack (including Web Workers)

Add an asset module rule to your webpack config:

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      { test: /jq-wasm[\\/].*\.wasm$/, type: "asset/resource" },
    ],
  },
};
```

Then import the URL and pass it to `loadJq`:

```ts
import { loadJq } from "jq-wasm";
import wasmUrl from "jq-wasm/jq.wasm";

const jq = await loadJq({ wasmURL: wasmUrl });
```

This reliably emits the asset across nested-worker chunks where `new URL(import.meta.url)` does not.

### Vite

```ts
import { loadJq } from "jq-wasm";
import wasmUrl from "jq-wasm/jq.wasm?url";

const jq = await loadJq({ wasmURL: wasmUrl });
```

### Cloudflare Workers / edge

Zero-config works automatically (the `workerd` export condition is auto-selected). For explicit control with a pre-compiled module:

```ts
import { loadJq } from "jq-wasm";
import mod from "./jq.wasm"; // pre-compiled WebAssembly.Module

const jq = await loadJq({ wasmModule: mod });
```

### No bundler / single-file / esbuild

```ts
import { json } from "jq-wasm/inline"; // wasm embedded — no separate asset

const results = await json({ a: 1 }, ".a");
```

## 🔄 Migrating from v2

v3 has two behavioral breaking changes:

### 1. `json()` always returns an array

| v2 | v3 |
| --- | --- |
| `json()` → scalar (1 result) / array (N results) / `null` (0 results) | `json()` → `T[]` always (`[]` when 0 results) |

**Migration:**

```ts
// v2: const result = await json(input, ".foo"); // could be scalar or null

// v3 — one result:
const result = await first(input, ".foo");       // → T | undefined
// or: (await json(input, ".foo"))[0]

// v3 — no result (was null, now []):
const results = await json(input, ".foo");
if (results.length === 0) { /* no output */ }
```

### 2. `json()` no longer throws on benign stderr

| v2 | v3 |
| --- | --- |
| `json()` throws if jq writes anything to stderr | `json()` throws `JqError` only when `exitCode !== 0` AND `stderr !== ""` |

jq warnings (`debug`, deprecations, `@stderr`) exit with code 0 and do not throw in v3. If you were catching those warning-throws, check `raw().stderr` instead.

### Smaller behavioral changes

- **Inputs widened:** `null`, numbers, and booleans are now accepted as input (stringified for jq); v2 rejected them with a `TypeError`. If you relied on that `TypeError` as a null-input guard, validate before calling.
- **Output-format flags rejected:** `json()`/`first()`/`stream()` now throw a `TypeError` for flags like `-r`, `-j`, `--tab`, `--seq` (v2 ran them and threw or mis-parsed, depending on the flag). `raw()` accepts all flags, unchanged.

**Unchanged:** `raw()` output contract (`{ stdout, stderr, exitCode }`, never throws on jq-level errors), async top-level `version()`, string-input-as-raw-JSON-text semantics, `jq-wasm/inline`.

## 📚 License

This project is licensed under the [MIT License](LICENSE).

## 🌟 Contributions

Contributions, issues, and feature requests are welcome! Feel free to check out the issues page.
