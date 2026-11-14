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
export const FIXED_TIME_GRACE_MS = 10 * 60_000;

/** The host's tick. Matches T3's five second scheduler clock. */
export const TICK_MS = 5_000;

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

const TIME_OF_DAY = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

/**
 * Weekday sets are sets: order and duplicates do not matter, and every day is
 * the same as no selection. Returns a sorted list, or null for "every day".
 */
export function normalizeWeekdays(weekdays?: readonly number[] | null): number[] | null {
  if (!weekdays) return null;
  const days = new Set<number>();
  for (const day of weekdays) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) days.add(day);
  }
  if (days.size === 0 || days.size === 7) return null;
  return [...days].sort((a, b) => a - b);
}

/** Why a schedule value cannot be stored, or null when it can. */
export function scheduleError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Choose an interval or a time of day.";
  const schedule = value as { type?: unknown; everyMs?: unknown; timeOfDay?: unknown; weekdays?: unknown };
  if (schedule.type === "interval") {
    const every = schedule.everyMs;
    if (typeof every !== "number" || !Number.isFinite(every) || every <= 0) return "The interval must be longer than zero.";
    return null;
  }
  if (schedule.type === "fixed_time") {
    if (!isTimeOfDay(schedule.timeOfDay)) return "Use a 24 hour time such as 09:30.";
    const weekdays = schedule.weekdays;
    if (weekdays !== undefined) {
      if (!Array.isArray(weekdays) || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        return "Weekdays are 0 (Sunday) through 6 (Saturday).";
      }
    }
    return null;
  }
  return "Choose an interval or a time of day.";
}

export function normalizeSchedule(schedule: Schedule): Schedule {
  if (schedule.type === "interval") return { type: "interval", everyMs: schedule.everyMs };
  const weekdays = normalizeWeekdays(schedule.weekdays);
  return weekdays
    ? { type: "fixed_time", timeOfDay: schedule.timeOfDay, weekdays }
    : { type: "fixed_time", timeOfDay: schedule.timeOfDay };
}

/** True when two schedules mean the same thing, so a save need not move the next run. */
export function isSameSchedule(a: Schedule, b: Schedule): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "interval") return a.everyMs === (b as IntervalSchedule).everyMs;
  const left = normalizeSchedule(a) as FixedTimeSchedule;
  const right = normalizeSchedule(b) as FixedTimeSchedule;
  return left.timeOfDay === right.timeOfDay && (left.weekdays ?? []).join(",") === (right.weekdays ?? []).join(",");
}

/**
 * The next local wall-clock occurrence strictly after `after`.
 *
 * Local time comes from the host's zone. A wall time that does not exist
 * (spring forward) moves forward by the gap because the platform normalises
 * the constructed date; a wall time that happens twice (fall back) resolves to
 * the earlier instant. That is the documented rule for this package.
 */
export function nextFixedRunAt(schedule: FixedTimeSchedule, after: number): number | null {
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number) as [number, number];
  const weekdays = normalizeWeekdays(schedule.weekdays);
  const base = new Date(after);
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    if (weekdays && !weekdays.includes(day.getDay())) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).getTime();
    if (at > after) return at;
  }
  return null;
}

/** The next due instant strictly after `after`; interval schedules are never aligned to a grid. */
export function nextRunAt(schedule: Schedule, after: number): number | null {
  return schedule.type === "interval" ? after + schedule.everyMs : nextFixedRunAt(schedule, after);
}

/** A fixed-time run this late is skipped and re-aimed instead of fired. */
export function isMissedFixedRun(schedule: Schedule, dueAt: number, now: number): boolean {
  return schedule.type === "fixed_time" && now - dueAt > FIXED_TIME_GRACE_MS;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const spare = hours % 24;
  return spare ? `${days}d ${spare}h` : `${days}d`;
}

/** A compact human label for a schedule, used by the list, the CLI and the extension. */
export function scheduleLabel(schedule: Schedule): string {
  if (schedule.type === "interval") return `Every ${formatDuration(schedule.everyMs)}`;
  const weekdays = normalizeWeekdays(schedule.weekdays);
  if (!weekdays) return `Daily ${schedule.timeOfDay}`;
  return `${weekdays.map((day) => WEEKDAYS[day] ?? "?").join(", ")} ${schedule.timeOfDay}`;
}

export function weekdayNames(): readonly string[] {
  return WEEKDAYS;
}

/** `HH:MM` plus a date, in local time, for labels such as the next run. */
export function formatInstant(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return `today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.toDateString() === date.toDateString()) return `tomorrow ${time}`;
  return `${WEEKDAYS[date.getDay()] ?? ""} ${time}`;
}

/** The days an editor should show selected: a schedule without a list means every day. */
export function effectiveWeekdays(schedule: Schedule): number[] {
  if (schedule.type !== "fixed_time") return [];
  return normalizeWeekdays(schedule.weekdays) ?? [0, 1, 2, 3, 4, 5, 6];
}

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
export function scheduleFromDraft(draft: ScheduleDraft): Schedule {
  if (draft.mode === "interval") {
    const text = draft.intervalMinutes.trim();
    if (draft.original?.type === "interval" && draft.originalIntervalMinutes !== null && text === draft.originalIntervalMinutes) {
      return draft.original;
    }
    return { type: "interval", everyMs: Math.round(Number(text) * 60_000) };
  }
  const timeOfDay = draft.timeOfDay.trim();
  const selected = normalizeWeekdays([...draft.weekdays].sort((a, b) => a - b));
  const daily = selected === null;
  if (draft.original?.type === "fixed_time" && draft.originalTimeOfDay !== null && timeOfDay === draft.originalTimeOfDay) {
    const originalDays = normalizeWeekdays(draft.original.weekdays);
    const sameDays = daily ? originalDays === null : originalDays !== null && originalDays.join(",") === selected.join(",");
    if (sameDays) return draft.original;
  }
  return daily ? { type: "fixed_time", timeOfDay } : { type: "fixed_time", timeOfDay, weekdays: selected };
}
