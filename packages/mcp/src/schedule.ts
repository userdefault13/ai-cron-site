// cron-parser v4 is CommonJS; under NodeNext ESM only the default export resolves.
import cronParser from "cron-parser";

const { parseExpression } = cronParser;

export interface ParsedSchedule {
	/** Standard 5-field cron expression, UTC. */
	cron: string;
	/** How the input was understood, in plain English. */
	explanation: string;
	/** Set when a timezone was applied and the result may drift across DST. */
	warning?: string;
}

const DOW: Record<string, number> = {
	sunday: 0,
	sun: 0,
	monday: 1,
	mon: 1,
	tuesday: 2,
	tue: 2,
	tues: 2,
	wednesday: 3,
	wed: 3,
	thursday: 4,
	thu: 4,
	thurs: 4,
	friday: 5,
	fri: 5,
	saturday: 6,
	sat: 6,
};

const DOW_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

/**
 * Looks like a 5-field cron expression rather than English. Each field must be
 * numeric/wildcard punctuation or a 3-letter day/month name — otherwise a phrase
 * like "every 3 days at 6am", which is also five words, is mistaken for cron.
 */
const CRON_FIELD = /^(?:[\d*/,\-?]+|[a-z]{3}(?:[-,][a-z]{3})*)$/i;
function looksLikeCron(input: string): boolean {
	const fields = input.split(/\s+/);
	return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

/** Pulls "at 9am" / "at 09:30" / "at 14:00" / "at noon" out of a phrase. */
function extractTime(input: string): { hour: number; minute: number } | null {
	if (/\bnoon|midday\b/.test(input)) return { hour: 12, minute: 0 };
	if (/\bmidnight\b/.test(input)) return { hour: 0, minute: 0 };
	const m = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
	if (!m) return null;
	let hour = Number(m[1]);
	const minute = m[2] ? Number(m[2]) : 0;
	const meridiem = m[3];
	if (meridiem === "pm" && hour < 12) hour += 12;
	if (meridiem === "am" && hour === 12) hour = 0;
	if (hour > 23 || minute > 59) return null;
	return { hour, minute };
}

/**
 * Current UTC offset of an IANA timezone, in minutes (positive = ahead of UTC).
 * Uses the offset in effect right now, so a DST change later shifts the job by an hour.
 */
function tzOffsetMinutes(timezone: string): number {
	const now = new Date();
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(now);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
	const asUtc = Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour") % 24,
		get("minute"),
		get("second"),
	);
	return Math.round((asUtc - now.getTime()) / 60_000 / 15) * 15;
}

/** Shifts an hour:minute in `timezone` to the equivalent UTC hour:minute. */
function toUtc(hour: number, minute: number, timezone: string) {
	const offset = tzOffsetMinutes(timezone);
	let total = hour * 60 + minute - offset;
	let dayShift = 0;
	while (total < 0) {
		total += 1440;
		dayShift -= 1;
	}
	while (total >= 1440) {
		total -= 1440;
		dayShift += 1;
	}
	return { hour: Math.floor(total / 60), minute: total % 60, dayShift };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Turns a cron expression *or* a plain-English phrase into a validated UTC cron
 * expression. Small models reliably produce phrases like "every 5 minutes" but
 * not always correct cron, so both are accepted.
 */
export function parseSchedule(input: string, timezone?: string): ParsedSchedule {
	const raw = input.trim();
	if (!raw) throw new Error("schedule is empty");

	if (looksLikeCron(raw)) {
		assertValidCron(raw);
		return { cron: raw, explanation: `cron expression ${raw} (UTC)` };
	}

	const text = raw.toLowerCase().replace(/\s+/g, " ").replace(/^run /, "").trim();
	const time = extractTime(text);
	let warning: string | undefined;

	// "at <something we could not read>" must fail loudly — silently defaulting to
	// midnight would schedule the job at the wrong time without anyone noticing.
	if (!time && /\bat\b/.test(text))
		throw new Error(
			`could not read a time of day out of "${raw}". Write it as "at 14:00", "at 9am" or "at noon".`,
		);
	if (/\bevery \d+ weeks?\b/.test(text))
		throw new Error(
			'cron cannot express multi-week intervals. Use a weekday instead, e.g. "every monday at 09:00".',
		);

	// Apply the timezone to any explicit time-of-day; interval schedules are tz-free.
	let hour = time?.hour ?? 0;
	let minute = time?.minute ?? 0;
	let dayShift = 0;
	if (time && timezone) {
		try {
			const shifted = toUtc(time.hour, time.minute, timezone);
			hour = shifted.hour;
			minute = shifted.minute;
			dayShift = shifted.dayShift;
			warning = `${pad(time.hour)}:${pad(time.minute)} ${timezone} was converted to ${pad(hour)}:${pad(minute)} UTC using the offset in effect today. cron402 schedules are always UTC, so this run time shifts by an hour when ${timezone} enters or leaves daylight saving.`;
		} catch {
			throw new Error(
				`unknown timezone "${timezone}" — use an IANA name like "America/New_York", or omit it and give the time in UTC`,
			);
		}
	}
	const at = time ? ` at ${pad(hour)}:${pad(minute)} UTC` : " at 00:00 UTC";

	const build = (cron: string, explanation: string): ParsedSchedule => {
		assertValidCron(cron);
		return warning ? { cron, explanation, warning } : { cron, explanation };
	};

	// every minute
	if (/^(every minute|each minute|every 1 minutes?|minutely)$/.test(text))
		return build("* * * * *", "every minute");

	// every N minutes
	const mins = text.match(/^every (\d+) (?:minutes?|mins?)$/);
	if (mins) {
		const n = Number(mins[1]);
		if (n < 1 || n > 59)
			throw new Error(
				"minute intervals must be 1-59 — for anything longer use hours, e.g. 'every 2 hours'",
			);
		return build(`*/${n} * * * *`, `every ${n} minute(s)`);
	}

	// hourly / every N hours
	if (/^(hourly|every hour|each hour|every 1 hours?)$/.test(text))
		return build(`${minute} * * * *`, `every hour at minute ${minute}`);
	const hours = text.match(/^every (\d+) (?:hours?|hrs?)$/);
	if (hours) {
		const n = Number(hours[1]);
		if (n < 1 || n > 23)
			throw new Error("hour intervals must be 1-23 — for anything longer use days");
		return build(`${minute} */${n} * * *`, `every ${n} hour(s)`);
	}

	// weekdays
	if (
		/(every )?(weekday|weekdays|business days?|mon(day)?[ -]?(to|through|-)[ -]?fri(day)?)/.test(
			text,
		)
	)
		return build(`${minute} ${hour} * * 1-5`, `every weekday (Mon-Fri)${at}`);

	// a named day of the week
	for (const [name, num] of Object.entries(DOW)) {
		if (new RegExp(`\\b(every |each |on )?${name}s?\\b`).test(text)) {
			const day = (((num + dayShift) % 7) + 7) % 7;
			return build(`${minute} ${hour} * * ${day}`, `every ${DOW_NAMES[day]}${at}`);
		}
	}

	// daily / every N days
	if (/^(daily|every day|each day|every 1 days?|nightly|every night|every morning)/.test(text))
		return build(`${minute} ${hour} * * *`, `every day${at}`);
	const days = text.match(/^every (\d+) days?/);
	if (days) {
		const n = Number(days[1]);
		if (n < 1 || n > 31) throw new Error("day intervals must be 1-31");
		return build(`${minute} ${hour} */${n} * *`, `every ${n} day(s)${at}`);
	}

	// weekly / monthly
	if (/^(weekly|every week|each week)/.test(text))
		return build(`${minute} ${hour} * * 0`, `every Sunday${at}`);
	if (/^(monthly|every month|each month)/.test(text))
		return build(`${minute} ${hour} 1 * *`, `on the 1st of every month${at}`);

	// bare "at 09:00" means daily at that time
	if (time && /^at /.test(text)) return build(`${minute} ${hour} * * *`, `every day${at}`);

	throw new Error(
		`could not understand the schedule "${raw}". Use a 5-field cron expression (e.g. "*/5 * * * *") or one of these phrases: "every minute", "every 15 minutes", "every 2 hours", "every day at 09:00", "every weekday at 8am", "every monday at 17:30", "weekly", "monthly".`,
	);
}

/** Parses with a friendly error, and keeps cron-parser's generic return type intact. */
function openInterval(cron: string) {
	try {
		return parseExpression(cron, { tz: "UTC" });
	} catch {
		throw new Error(
			`"${cron}" is not a valid 5-field cron expression (minute hour day-of-month month day-of-week, UTC)`,
		);
	}
}

export function assertValidCron(cron: string): void {
	const interval = openInterval(cron);
	// Reject sub-minute schedules — cron402's floor is one fire per minute.
	const first = interval.next().getTime();
	const second = interval.next().getTime();
	if (second - first < 60_000)
		throw new Error("the minimum interval on cron402 is 1 minute — this schedule fires faster");
}

/** The next `count` fire times for a cron expression, as UTC ISO strings. */
export function nextRuns(cron: string, count = 5): string[] {
	const interval = openInterval(cron);
	const out: string[] = [];
	for (let i = 0; i < count; i++) out.push(interval.next().toISOString());
	return out;
}
