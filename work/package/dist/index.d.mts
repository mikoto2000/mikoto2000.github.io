interface JqResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
type JqInput = string | number | boolean | object | null;
interface JqLoadOptions {
    wasmBinary?: ArrayBuffer | Uint8Array;
    wasmURL?: string | URL;
    wasmModule?: WebAssembly.Module;
    /**
     * Custom instantiation hook. Must call `onSuccess(instance, module)` —
     * the Emscripten runtime resolves only through the callback and ignores the
     * return value, so the classic sync contract (return `instance.exports`
     * without calling back) would hang; loadJq detects it and rejects instead.
     */
    instantiateWasm?: (imports: WebAssembly.Imports, onSuccess: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => void;
}
declare class JqError extends Error {
    readonly stderr: string;
    readonly exitCode: number;
    readonly query: string;
    constructor(message: string, opts: {
        stderr: string;
        exitCode: number;
        query: string;
    });
    /**
     * The package ships as several independently-bundled entries and formats
     * (CJS + ESM, main + inline), so the thrower's JqError class and the
     * catcher's may be different copies. Match by name instead of prototype
     * identity so `e instanceof JqError` holds across copies.
     */
    static [Symbol.hasInstance](value: unknown): value is JqError;
}
interface Jq {
    raw(input: JqInput, query: string, flags?: string[]): JqResult;
    json<T = unknown>(input: JqInput, query: string, flags?: string[]): T[];
    first<T = unknown>(input: JqInput, query: string, flags?: string[]): T | undefined;
    stream<T = unknown>(input: JqInput, query: string, flags?: string[]): IterableIterator<T>;
    readonly version: string;
}

declare const loadJq: (options?: JqLoadOptions) => Promise<Jq>;
declare const raw: (input: JqInput, query: string, flags?: string[]) => Promise<JqResult>;
declare const json: <T = unknown>(input: JqInput, query: string, flags?: string[]) => Promise<T[]>;
declare const first: <T = unknown>(input: JqInput, query: string, flags?: string[]) => Promise<T | undefined>;
declare const version: () => Promise<string>;

export { type Jq, JqError, type JqInput, type JqLoadOptions, type JqResult, first, json, loadJq, raw, version };
