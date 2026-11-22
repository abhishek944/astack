/** The only two valid reasons a Pi task may be blocked. */
export declare const TASK_DEPENDENCIES: readonly ["user-decision", "another-agent"];
export type TaskDependency = (typeof TASK_DEPENDENCIES)[number];
export declare const DEPENDENCY_LABELS: Record<TaskDependency, string>;
export declare const DEPENDENCY_GUIDANCE = "Only a blocked task has dependentOn. When entering blocked, supply exactly one of \"user-decision\" for a user response, decision, or permission, or \"another-agent\" for another agent's output or review. Nonblocked tasks omit it and leaving blocked clears it. Do not mark a task blocked for external services, tool failures, or other obstacles that fit neither category; keep the task active, preserve safety, and report the unavailable dependency truthfully.";
export declare function isTaskDependency(value: unknown): value is TaskDependency;
export declare function dependentOnLabel(value: TaskDependency | null | undefined): string | undefined;
