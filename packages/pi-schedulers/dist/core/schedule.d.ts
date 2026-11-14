/**
 * Schedule model, validation and next-run math.
 *
 * Behaviour is adapted from the MIT-licensed t3code scheduler
 * (`apps/server/src/scheduledTasks/Schedule.ts` and
 * `packages/contracts/src/scheduledTask.ts`): the interval / fixed-time union,
 * local weekday selection, the ten minute missed-run grace, and schedule
 * equality that ignores weekday order and duplicates. T3's sixty second
 * interval floor is deliberately not ported, the millisecond clock is the
 * caller's, and there is no webhook variant. See THIRD_PARTY_NOTICES.md.
 *
 * Pure: no I/O, no clock reads, no timers.
 */
/** How late a fixed-time run may start and still count as that occurrence. */
export declare const FIXED_TIME_GRACE_MS: number;
/** The host's tick. Matches T3's five second scheduler clock. */
export declare const TICK_MS = 5000;
export interface IntervalSchedule {
    type: "interval";
    everyMs: number;
}
export interface FixedTimeSchedule {
    type: "fixed_time";
    /** Local wall clock, zero padded `HH:MM`. */
    timeOfDay: string;
    /** `0` is Sunday. Omitted, empty or all seven means every day. */
    weekdays?: number[];
}
export type Schedule = IntervalSchedule | FixedTimeSchedule;
export declare function isTimeOfDay(value: unknown): value is string;
/**
 * Weekday sets are sets: order and duplicates do not matter, and every day is
 * the same as no selection. Returns a sorted list, or null for "every day".
 */
export declare function normalizeWeekdays(weekdays?: readonly number[] | null): number[] | null;
/** Why a schedule value cannot be stored, or null when it can. */
export declare function scheduleError(value: unknown): string | null;
export declare function normalizeSchedule(schedule: Schedule): Schedule;
/** True when two schedules mean the same thing, so a save need not move the next run. */
export declare function isSameSchedule(a: Schedule, b: Schedule): boolean;
/**
 * The next local wall-clock occurrence strictly after `after`.
 *
 * Local time comes from the host's zone. A wall time that does not exist
 * (spring forward) moves forward by the gap because the platform normalises
 * the constructed date; a wall time that happens twice (fall back) resolves to
 * the earlier instant. That is the documented rule for this package.
 */
export declare function nextFixedRunAt(schedule: FixedTimeSchedule, after: number): number | null;
/** The next due instant strictly after `after`; interval schedules are never aligned to a grid. */
export declare function nextRunAt(schedule: Schedule, after: number): number | null;
/** A fixed-time run this late is skipped and re-aimed instead of fired. */
export declare function isMissedFixedRun(schedule: Schedule, dueAt: number, now: number): boolean;
export declare function formatDuration(ms: number): string;
/** A compact human label for a schedule, used by the list, the CLI and the extension. */
export declare function scheduleLabel(schedule: Schedule): string;
export declare function weekdayNames(): readonly string[];
/** `HH:MM` plus a date, in local time, for labels such as the next run. */
export declare function formatInstant(at: number, now?: number): string;
/** The days an editor should show selected: a schedule without a list means every day. */
export declare function effectiveWeekdays(schedule: Schedule): number[];
export interface ScheduleDraft {
    mode: "interval" | "fixed_time";
    intervalMinutes: string;
    timeOfDay: string;
    /** Selected day buttons; empty or all seven means every day. */
    weekdays: readonly number[];
    /** The stored schedule this draft started from, if any. */
    original: Schedule | null;
    /** The exact text the interval field was initialised with. */
    originalIntervalMinutes: string | null;
    /** The exact text the time field was initialised with. */
    originalTimeOfDay: string | null;
}
/**
 * Turn editor fields into a schedule without changing one the user did not
 * touch: an untouched interval keeps its exact millisecond value (so `1s` stays
 * `1000`, not `1200`), and an untouched daily schedule keeps its shape (no
 * weekday list) instead of gaining a Mon-Fri list from the form's defaults.
 */
export declare function scheduleFromDraft(draft: ScheduleDraft): Schedule;
