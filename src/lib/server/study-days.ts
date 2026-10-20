type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const boundaryCache = new Map<string, number>();

function rememberBoundary(key: string, instant: number): Date {
  if (boundaryCache.size >= 4096) boundaryCache.clear();
  boundaryCache.set(key, instant);
  return new Date(instant);
}

function formatter(timezone: string) {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    formatters.set(timezone, value);
  }
  return value;
}

function localParts(timestamp: number, timezone: string): LocalDateTime {
  const parts = formatter(timezone).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function wallValue(value: LocalDateTime): number {
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second
  );
}

function wallTimeToInstant(target: LocalDateTime, timezone: string): Date {
  const key = `${timezone}:${target.year}-${target.month}-${target.day}`;
  const cached = boundaryCache.get(key);
  if (cached !== undefined) return new Date(cached);
  const wall = wallValue(target);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 3) {
    const sample = wall + hours * 60 * 60 * 1000;
    offsets.add(wallValue(localParts(sample, timezone)) - sample);
  }
  const candidates = [...offsets].map((offset) => {
    const instant = wall - offset;
    return { instant, local: wallValue(localParts(instant, timezone)) };
  });
  const exact = candidates
    .filter(({ local }) => local === wall)
    .sort((left, right) => left.instant - right.instant);
  if (exact.length) {
    return rememberBoundary(key, exact[0].instant);
  }

  // A local clock gap has no exact instant; choose its first representable time after 04:00.
  const afterGap = candidates
    .filter(({ local }) => local > wall)
    .sort(
      (left, right) => left.local - right.local || left.instant - right.instant
    );
  if (afterGap.length) {
    return rememberBoundary(key, afterGap[0].instant);
  }
  throw new RangeError(`Could not resolve study day in ${timezone}`);
}

/** Resolve the start of the current or an adjacent 04:00 local study day. */
export function studyDayStart(
  now: Date | number,
  timezone: string,
  offsetDays = 0
): Date {
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp) || !Number.isInteger(offsetDays))
    throw new RangeError('Invalid study day input');
  const local = localParts(timestamp, timezone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (local.hour < 4) date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return wallTimeToInstant(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: 4,
      minute: 0,
      second: 0
    },
    timezone
  );
}
