/**
 * Timezone-aware cron schedules for {@link "./ci.ts".cicd}.
 *
 * GitHub Actions (and Azure Pipelines) only understand **UTC** cron. This module
 * turns a `{ cron, tz }` schedule into the UTC cron(s) that fire at the intended
 * *local* wall-clock time, plus — for a zone that observes DST — a shell guard
 * that suppresses the firing at the wrong offset. A zone that changes offset
 * across the year contributes **one UTC cron per distinct offset**; all are
 * registered, and the guard lets through only the firing whose wall-clock in the
 * zone matches the schedule. A fixed-offset zone (or plain UTC) needs a single
 * cron and no guard.
 *
 * caveat: on the DST *fall-back* day the ambiguous hour occurs twice, and both
 * offsets' UTC crons then satisfy the wall-clock guard — so a schedule inside
 * that one hour can fire twice that day. Suppressing it would need per-cron
 * offset context in the guard; a once-a-year double-run is a smaller cost, so
 * make schedules idempotent (the usual guidance for cron) rather than exact.
 *
 * The grammar is a deliberate subset — numeric minute/hour/day fields (single
 * values, comma lists, ranges, and steps) — and the timezone must have a
 * whole-hour UTC offset. Anything outside that (named fields, hashes, a
 * fractional-hour zone, or a day-constrained schedule that would cross midnight
 * once shifted to UTC) raises a friendly error telling the author to write the
 * UTC cron directly. Offsets are sampled from a **pinned reference year**, so the
 * generated output is deterministic (it never churns with the current date).
 *
 * @module
 */

/** A scheduled trigger: a 5-field cron expression in an optional IANA timezone. */
export interface ScheduleEntry {
  /** A standard 5-field cron expression (`minute hour day-of-month month day-of-week`). */
  cron: string;
  /**
   * An IANA timezone (e.g. `Europe/Sofia`) the `cron` is expressed in. Omitted
   * (or `UTC`) means the cron is already UTC and is emitted verbatim.
   */
  tz?: string;
}

/** The reference year offsets are sampled from, so generated crons are deterministic. */
const REFERENCE_YEAR = 2024;

/** A cron field: every value (`*`) or an explicit, sorted, de-duplicated set. */
type Field = "*" | number[];

/** One parsed cron expression; `minute`/`hour` are expanded for shifting. */
interface ParsedCron {
  minute: Field;
  hour: Field;
  dom: Field;
  month: Field;
  dow: Field;
}

/** Raise a friendly "write the UTC cron directly" error for an unsupported schedule. */
function unsupported(reason: string): never {
  throw new Error(
    `cicd: unsupported schedule — ${reason}. ` +
      `Write the cron in UTC directly (drop the tz), or simplify it.`,
  );
}

/**
 * Expand one cron field to an explicit value set (or `"*"`), validating each part
 * against `[min, max]`. Supports a single number, comma lists, ranges (`a-b`),
 * and slash steps (a stride applied to `*` or a range). Names, hashes, and other
 * syntax are rejected.
 */
function expandField(field: string, min: number, max: number): Field {
  if (field === "*") return "*";
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const step = part.split("/");
    if (step.length > 2) unsupported(`invalid cron field "${field}"`);
    const stride = step.length === 2 ? Number(step[1]) : 1;
    if (!Number.isInteger(stride) || stride < 1) {
      unsupported(`invalid step in cron field "${field}"`);
    }
    let lo: number;
    let hi: number;
    if (step[0] === "*") {
      lo = min;
      hi = max;
    } else if (step[0].includes("-")) {
      const [a, b] = step[0].split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(step[0]);
      // A start-only step (`9/4`) is open-ended to the field max, as in Vixie
      // cron; a bare number (`9`) is just itself.
      hi = step.length === 2 ? max : lo;
    }
    if (
      !Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max ||
      lo > hi
    ) {
      unsupported(`cron field "${field}" is out of range [${min}-${max}]`);
    }
    for (let v = lo; v <= hi; v += stride) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

/** Parse and validate a 5-field cron expression. */
function parseCron(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    unsupported(`expected 5 cron fields, got ${fields.length} ("${cron}")`);
  }
  return {
    minute: expandField(fields[0], 0, 59),
    hour: expandField(fields[1], 0, 23),
    dom: expandField(fields[2], 1, 31),
    month: expandField(fields[3], 1, 12),
    // Cron day-of-week is 0-7 with both 0 and 7 meaning Sunday.
    dow: normaliseDow(expandField(fields[4], 0, 7)),
  };
}

/** Collapse cron Sunday (`0` and `7`) to a single canonical `0`. */
function normaliseDow(dow: Field): Field {
  if (dow === "*") return "*";
  const set = new Set(dow.map((d) => (d === 7 ? 0 : d)));
  return [...set].sort((a, b) => a - b);
}

/** Render a {@link Field} back to cron syntax. */
function renderField(field: Field): string {
  return field === "*" ? "*" : field.join(",");
}

/** Whether a schedule constrains any day field (so a UTC day-shift can't be ignored). */
function hasDayConstraint(parsed: ParsedCron): boolean {
  return parsed.dom !== "*" || parsed.month !== "*" || parsed.dow !== "*";
}

/** A formatter that reports `tz`'s long UTC offset, or a friendly error if `tz` is unknown. */
function zoneFormatter(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    });
  } catch {
    unsupported(`unknown timezone "${tz}"`);
  }
}

/** The UTC offset `formatter`'s zone has at `date`, in whole minutes east of UTC. */
function offsetAt(formatter: Intl.DateTimeFormat, date: Date): number {
  const name =
    formatter.formatToParts(date).find((p) => p.type === "timeZoneName")
      ?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0; // "GMT" — UTC itself
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The distinct whole-minute UTC offsets `tz` uses across the reference year.
 * Every day is sampled (not just January and July), so a sub-seasonal offset
 * window — e.g. a Ramadan-based change like `Africa/Casablanca` — is not missed.
 * Deterministic: the year is pinned, so `generate-ci` output never churns.
 */
function distinctOffsets(tz: string): number[] {
  const formatter = zoneFormatter(tz);
  const offsets = new Set<number>();
  // The reference year is a leap year (366 days); sample midday to avoid the
  // exact transition instants.
  for (let day = 0; day < 366; day++) {
    offsets.add(
      offsetAt(formatter, new Date(Date.UTC(REFERENCE_YEAR, 0, 1 + day, 12))),
    );
  }
  return [...offsets].sort((a, b) => a - b);
}

/** Shift a parsed cron's hours by `offsetHours` east, returning the UTC cron string. */
function shiftToUtc(parsed: ParsedCron, offsetHours: number): string {
  if (parsed.hour === "*") {
    // Every hour shifts to every hour — no day movement, no guard concern.
    return [
      renderField(parsed.minute),
      "*",
      renderField(parsed.dom),
      renderField(parsed.month),
      renderField(parsed.dow),
    ].join(" ");
  }
  const constrained = hasDayConstraint(parsed);
  const utcHours: number[] = [];
  for (const h of parsed.hour) {
    const shifted = h - offsetHours;
    if ((shifted < 0 || shifted > 23) && constrained) {
      unsupported(
        "the schedule crosses a day boundary in UTC while constraining a day " +
          "field (day-of-week/month), which cannot be expressed as one cron",
      );
    }
    utcHours.push(((shifted % 24) + 24) % 24);
  }
  const hours = [...new Set(utcHours)].sort((a, b) => a - b);
  return [
    renderField(parsed.minute),
    hours.join(","),
    renderField(parsed.dom),
    renderField(parsed.month),
    renderField(parsed.dow),
  ].join(" ");
}

/**
 * The UTC cron string(s) a schedule compiles to: one for UTC / a fixed-offset
 * zone, and one per distinct offset for a zone that changes offset across the
 * year. Also validates the expression.
 */
export function utcCronsFor(entry: ScheduleEntry): string[] {
  const parsed = parseCron(entry.cron);
  if (entry.tz === undefined || entry.tz === "" || entry.tz === "UTC") {
    return [entry.cron.trim().replace(/\s+/g, " ")];
  }
  const offsets = distinctOffsets(entry.tz);
  const crons = new Set<string>();
  for (const offset of offsets) {
    if (offset % 60 !== 0) {
      unsupported(
        `timezone "${entry.tz}" has a non-whole-hour UTC offset`,
      );
    }
    crons.add(shiftToUtc(parsed, offset / 60));
  }
  return [...crons];
}

/** Whether a schedule needs the wall-clock guard (a zone with more than one offset). */
export function scheduleNeedsGuard(entry: ScheduleEntry): boolean {
  if (entry.tz === undefined || entry.tz === "" || entry.tz === "UTC") {
    return false;
  }
  return distinctOffsets(entry.tz).length > 1;
}

/** Whether any entry in a schedule needs the guard. */
export function anyScheduleNeedsGuard(
  schedule: readonly ScheduleEntry[],
): boolean {
  return schedule.some(scheduleNeedsGuard);
}

/** A space-padded membership list for a `case` test, or "" for `*` (always matches). */
function caseList(field: Field): string {
  return field === "*" ? "" : ` ${field.join(" ")} `;
}

/** One `case`-based membership test on `value`, or "true" when the field is `*`. */
function memberTest(value: string, field: Field): string {
  if (field === "*") return "true";
  return `case "${caseList(field)}" in *" ${value} "*) true;; *) false;; esac`;
}

/**
 * The shell body of the GitHub guard step. On a non-`schedule` event it sets
 * `run=true` (push/PR/manual always proceed); on a scheduled event it sets
 * `run=true` only when the current wall-clock in some entry's timezone matches
 * that entry's declared local firing time. Writes `run=<bool>` to `$GITHUB_OUTPUT`.
 */
export function guardShell(schedule: readonly ScheduleEntry[]): string {
  const lines = [
    'if [ "$GITHUB_EVENT_NAME" != "schedule" ]; then',
    '  echo "run=true" >> "$GITHUB_OUTPUT"; exit 0',
    "fi",
    "run=false",
  ];
  for (const entry of schedule) {
    const parsed = parseCron(entry.cron);
    const tz = entry.tz === undefined || entry.tz === "" ? "UTC" : entry.tz;
    // The tz is interpolated into `TZ='<tz>'` below, so it must be shell-safe.
    // Validate it against the timezone database (a real IANA name has no shell
    // metacharacters, and anything Intl rejects throws here) — so this exported
    // function never emits an injectable script, independent of its caller.
    if (tz !== "UTC") zoneFormatter(tz);
    // Read the wall-clock in the entry's zone; force base-10 so "08"/"09" parse.
    lines.push(
      `mm=$((10#$(TZ='${tz}' date +%M))); hh=$((10#$(TZ='${tz}' date +%H)))`,
    );
    const tests = [
      memberTest("$mm", parsed.minute),
      memberTest("$hh", parsed.hour),
    ];
    if (parsed.month !== "*") {
      lines.push(`mo=$((10#$(TZ='${tz}' date +%m)))`);
      tests.push(memberTest("$mo", parsed.month));
    }
    // Day-of-month and day-of-week are OR-combined when BOTH are restricted (a
    // firing matches if either does — standard Vixie cron); when only one is set
    // it stands alone. This must match how the provider interprets the cron.
    const dayTests: string[] = [];
    if (parsed.dow !== "*") {
      // `date +%u` is 1-7 (Mon-Sun); map to cron's 0-6 (Sun=0) for comparison.
      lines.push(`dw=$(TZ='${tz}' date +%u); [ "$dw" = 7 ] && dw=0`);
      dayTests.push(memberTest("$dw", parsed.dow));
    }
    if (parsed.dom !== "*") {
      lines.push(`dm=$((10#$(TZ='${tz}' date +%d)))`);
      dayTests.push(memberTest("$dm", parsed.dom));
    }
    if (dayTests.length === 2) {
      tests.push(`{ ${dayTests[0]} || ${dayTests[1]}; }`);
    } else if (dayTests.length === 1) {
      tests.push(dayTests[0]);
    }
    lines.push(`if ${tests.join(" && ")}; then run=true; fi`);
  }
  lines.push('echo "run=$run" >> "$GITHUB_OUTPUT"');
  return lines.join("\n");
}
