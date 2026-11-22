interface Parsed {
    command: string;
    flags: Map<string, string | true>;
}
export declare function parseArgs(argv: readonly string[]): Parsed;
export declare function main(argv: readonly string[]): Promise<number>;
export {};
