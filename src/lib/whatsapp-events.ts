import { EventEmitter } from "events";

const g = globalThis as unknown as { _waEmitter?: EventEmitter };
export const waEmitter = g._waEmitter ?? new EventEmitter();
if (process.env.NODE_ENV !== "production") g._waEmitter = waEmitter;
