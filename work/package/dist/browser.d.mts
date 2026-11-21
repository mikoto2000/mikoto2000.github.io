import { J as JqInput, a as JqLoadOptions, b as Jq, c as JqResult } from './jq-handle-JzmDralH.mjs';
export { d as JqError } from './jq-handle-JzmDralH.mjs';

declare const loadJq: (options?: JqLoadOptions) => Promise<Jq>;
declare const raw: (input: JqInput, query: string, flags?: string[]) => Promise<JqResult>;
declare const json: <T = unknown>(input: JqInput, query: string, flags?: string[]) => Promise<T[]>;
declare const first: <T = unknown>(input: JqInput, query: string, flags?: string[]) => Promise<T | undefined>;
declare const version: () => Promise<string>;

export { Jq, JqInput, JqLoadOptions, JqResult, first, json, loadJq, raw, version };
