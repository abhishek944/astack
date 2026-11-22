/** The only two valid reasons a Pi task may be blocked. */
export const TASK_DEPENDENCIES = ["user-decision", "another-agent"] as const;

export type TaskDependency = (typeof TASK_DEPENDENCIES)[number];

export const DEPENDENCY_LABELS: Record<TaskDependency, string> = {
  "user-decision": "User decision",
  "another-agent": "Another agent",
};

export const DEPENDENCY_GUIDANCE = "Only a blocked task has dependentOn. When entering blocked, supply exactly one of \"user-decision\" for a user response, decision, or permission, or \"another-agent\" for another agent's output or review. Nonblocked tasks omit it and leaving blocked clears it. Do not mark a task blocked for external services, tool failures, or other obstacles that fit neither category; keep the task active, preserve safety, and report the unavailable dependency truthfully.";

export function isTaskDependency(value: unknown): value is TaskDependency {
  return typeof value === "string" && (TASK_DEPENDENCIES as readonly string[]).includes(value);
}

export function dependentOnLabel(value: TaskDependency | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : DEPENDENCY_LABELS[value];
}
