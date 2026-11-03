import { type Answer, type Backend, type State, type SubmitRequest } from "./model.js";
export type { Answer, Backend, State, SubmitRequest } from "./model.js";
export { loadState } from "./model.js";
export declare const cliPath: string;
export declare const shellQuote: (value: string) => string;
export declare function watcherCommand(statePath: string): string;
export declare function findState(id: string, cwd: string, sessionId: string): Promise<State>;
export declare function stopLocal(file: string): Promise<void>;
export declare function stopOwnedChildren(): Promise<void>;
export declare function submitQuestion(request: SubmitRequest, context: {
    sessionId: string;
    cwd: string;
    backend: Backend;
}, signal?: AbortSignal): Promise<State>;
export declare function submissionResult(state: State): {
    questionId: string;
    backend: Backend;
    url: string | undefined;
    responsePath: string;
    statePath: string;
    status: "failed" | "prepared" | "publishing" | "ready";
    public: boolean;
    warnings: string[] | undefined;
};
export declare function archive(state: State, input: unknown, recordId?: string | null): Promise<Answer>;
export declare function checkAnswer(file: string, signal?: AbortSignal): Promise<{
    status: "answered";
    answer: Answer;
} | {
    status: "waiting";
}>;
export declare function watchAnswer(file: string, signal?: AbortSignal): Promise<Answer>;
export declare function publicAsset(state: State, name: string): Promise<{
    bytes: Buffer;
    type: string;
} | undefined>;
