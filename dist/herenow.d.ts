import { type State } from "./model.js";
export declare class ApiError extends Error {
    status: number;
    retryAfterMs?: number | undefined;
    code?: string | undefined;
    providerMessage?: string | undefined;
    constructor(status: number, retryAfterMs?: number | undefined, code?: string | undefined, providerMessage?: string | undefined);
}
export declare function publish(state: State, signal?: AbortSignal): Promise<void>;
export declare function records(state: State, signal?: AbortSignal): AsyncGenerator<{
    id: string;
    data: unknown;
}>;
