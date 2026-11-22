export interface MigrationResult {
    questionId: string;
    from: string;
    to: string;
    outcome: "relocated" | "already-migrated";
}
export declare function migrateQuestion(stateFile: string, signal?: AbortSignal): Promise<MigrationResult>;
