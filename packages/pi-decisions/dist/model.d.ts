export type Backend = "here.now" | "local";
export type QuestionMode = "single" | "multiple" | "review";
export type ContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    path: string;
    alt: string;
    caption?: string;
} | {
    type: "video";
    path: string;
    caption?: string;
} | {
    type: "mermaid";
    code: string;
    caption?: string;
};
export interface ChoiceOption {
    id: string;
    label: string;
    content?: ContentBlock[];
}
export interface SubmitRequest {
    questionId: string;
    mode: QuestionMode;
    question: string;
    content?: ContentBlock[];
    options?: ChoiceOption[];
    recommended?: string;
    label?: string;
}
export interface Question extends SubmitRequest {
    content: ContentBlock[];
    options: ChoiceOption[];
}
export interface State {
    version: 2;
    sessionId: string;
    cwd: string;
    storageDir: string;
    questionId: string;
    revision: string;
    backend: Backend;
    question: Question;
    responsePath: string;
    statePath: string;
    bundleDir: string;
    files: {
        path: string;
        contentType: string;
    }[];
    status: "prepared" | "publishing" | "ready" | "failed";
    url?: string;
    capability?: string;
    slug?: string;
    publication?: {
        versionId: string;
        finalizeUrl: string;
        uploads: {
            path: string;
            url: string;
            headers?: Record<string, string>;
        }[];
    };
    error?: string;
    warnings?: string[];
}
export interface BrowserAnswer {
    question: string;
    revision: string;
    selected_ids: string[];
    comments: string;
}
export interface Answer {
    questionId: string;
    revision: string;
    mode: QuestionMode;
    selectedIds: string[];
    selectedLabels: string[];
    submissionType: "selection" | "comments-only";
    response: string;
    timestamp: string;
    sessionId: string;
    backend: Backend;
    recordId: string | null;
}
export declare function object(value: unknown, name?: string): Record<string, unknown>;
export declare function string(value: unknown, name: string): string;
export declare function hash(bytes: string | Buffer): string;
export declare function inside(root: string, file: string): boolean;
export declare function absoluteFile(input: string): Promise<string>;
export declare function sessionStorage(cwd: string, sessionId: string, create?: boolean): Promise<{
    cwd: string;
    storageDir: string;
}>;
export declare function questionId(value: unknown): string;
export declare function json<T>(file: string): Promise<T>;
export declare function optionalJson<T>(file: string): Promise<T | undefined>;
export declare function save(file: string, value: unknown): Promise<void>;
export declare function privateDirectory(dir: string): Promise<void>;
export declare function loadState(file: string, expectedSession?: string): Promise<State>;
export declare function normalize(state: State, input: unknown, recordId?: string | null): Answer;
