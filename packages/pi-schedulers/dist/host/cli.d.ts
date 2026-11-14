interface Parsed {
    command: string;
    positionals: string[];
    flags: Map<string, string | true>;
}
export declare function parseArgs(argv: readonly string[]): Parsed;
/** `15m`, `90s`, `2h`, or a bare number of minutes. */
export declare function parseInterval(value: string): number;
/** `mon,tue`, `1,3,5`, `weekdays`, `weekends` or `daily`. */
export declare function parseDays(value: string): number[] | undefined;
export declare function main(argv: readonly string[]): Promise<number>;
export {};
