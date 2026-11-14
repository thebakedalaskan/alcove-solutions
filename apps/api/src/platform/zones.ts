/*
 * Clocks in other time zones, for what a calendar says only in local time: an all-day event's dates, and a sample
 * week's working hours. Times everywhere else are UTC.
 */

/** What a clock in `zone` reads at a moment, as if it were reading UTC. */
function reading(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/** The day a moment falls on in `zone`, as `YYYY-MM-DD`. */
export const dayIn = (at: Date, zone: string): string => new Date(reading(at.getTime(), zone)).toISOString().slice(0, 10);

/**
 * The moment a clock in `zone` reads `minutes` past midnight on `day` (`YYYY-MM-DD`). The zone's offset is read twice,
 * the second time at the first answer, so clocks changing that day don't move it.
 */
export function zoned(day: string, minutes: number, zone: string): Date {
  const wanted = Date.parse(`${day}T00:00:00Z`) + minutes * 60_000;
  const first = wanted - (reading(wanted, zone) - wanted);
  return new Date(wanted - (reading(first, zone) - first));
}
