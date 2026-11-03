import { type Question, type SubmitRequest } from "./model.js";
export interface PublicOption {
    id: string;
    label: string;
    content: string;
}
export interface BundleInput {
    question: Question;
    options: PublicOption[];
    visual: string;
    images: {
        image: string;
        label: string;
    }[];
    assetHashes: string[];
    assets: {
        path: string;
        contentType: string;
        bytes: Buffer;
    }[];
}
export declare function prepare(request: SubmitRequest): Promise<BundleInput>;
export declare function render(input: BundleInput, revision: string, backend: "local" | "here.now", capability?: string): string;
export declare function dataManifest(): {
    collections: {
        answers: {
            fields: {
                question: {
                    type: string;
                    required: boolean;
                };
                revision: {
                    type: string;
                    required: boolean;
                };
                selected_ids: {
                    type: string;
                    required: boolean;
                };
                comments: {
                    type: string;
                    required: boolean;
                };
            };
            access: {
                read: string;
                insert: string;
                update: string;
                delete: string;
            };
        };
    };
};
