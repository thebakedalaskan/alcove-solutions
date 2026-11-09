/* Dates and times as the app shows them: 24-hour clock, day before month. */
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** "Tuesday" */
export const weekday = (d: Date) => WEEKDAY[d.getDay()] ?? '';
const month = (d: Date) => MONTH[d.getMonth()] ?? '';
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** Whole days from today to `d`: 0 today, 1 tomorrow, -1 yesterday. */
export const daysFromToday = (d: Date, now = new Date()) => Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);

export const hm = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** "10:04:12": to the second, for moments that can fall within one minute. */
export const hms = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** "Tue 3 Nov" */
export const shortDay = (d: Date) => `${weekday(d).slice(0, 3)} ${d.getDate()} ${month(d).slice(0, 3)}`;
/** "3 Nov" */
export const dayMonth = (d: Date) => `${d.getDate()} ${month(d).slice(0, 3)}`;
/** When something went: "16:40" today, "Thu 17:55" in the week before, then "3 Nov". */
export const wentAt = (iso: string, now = new Date()): string => { const d = new Date(iso); const n = -daysFromToday(d, now); return n <= 0 ? hm(d) : n < 7 ? `${weekday(d).slice(0, 3)} ${hm(d)}` : dayMonth(d); };
/** "Tuesday 3 November" */
export const longDay = (d: Date) => `${weekday(d)} ${d.getDate()} ${month(d)}`;
/** For lists of notes: "Today", "Yesterday" or "Fri 30 Oct". */
export function noteDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = daysFromToday(d, now);
  return n === 0 ? 'Today' : n === -1 ? 'Yesterday' : shortDay(d);
}
/** When a note's call was: "Today at 09:30", "Yesterday at 09:30" or "Fri 30 Oct at 09:30". */
export const noteAt = (iso: string, now = new Date()): string => `${noteDay(iso, now)} at ${hm(iso)}`;
/** "Tue 3 Nov · 09:30–09:54 · 24 min" */
export function noteWhen(startedAt: string, seconds: number): string {
  const a = new Date(startedAt);
  const b = new Date(a.getTime() + seconds * 1000);
  return `${shortDay(a)} · ${hm(a)}–${hm(b)} · ${hoursAndMinutes(Math.max(1, Math.round(seconds / 60)))}`;
}
/** Groups for the notes list, by day: "Today", "Yesterday", "This week", "Last week", then month names. */
export function noteGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = -daysFromToday(d, now);
  const dow = (now.getDay() + 6) % 7;
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n <= dow) return 'This week';
  if (n <= dow + 7) return 'Last week';
  return d.getFullYear() === now.getFullYear() ? month(d) : `${month(d)} ${d.getFullYear()}`;
}

/** Minutes from now until `iso`, rounded up; negative once it has started. */
export const minutesUntil = (iso: string, now = Date.now()) => Math.ceil((new Date(iso).getTime() - now) / 60_000);
/** "in 12 min", "in 1 h 30 min" */
export function untilLabel(minutes: number): string {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
}
/** How long ago: "just now", "12 min ago", "2 h ago", "yesterday", the weekday this past week ("Friday"), else "Tue 27 Oct". */
export function agoLabel(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const days = -daysFromToday(new Date(iso), new Date(now));
  if (days === 0) return `${Math.floor(mins / 60)} h ago`;
  if (days === 1) return 'yesterday';
  return days < 7 ? weekday(new Date(iso)) : shortDay(new Date(iso));
}
/** "6 h 40 min", "25 min" */
export function hoursAndMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
/** "4:05" for positions in a recording. */
export const position = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** The day something happened, after a "·": "today", "yesterday", "Mon" in the past week, else "27 Oct" (and the year if it isn't this one). */
export function pastDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = -daysFromToday(d, now);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 7) return weekday(d).slice(0, 3);
  return `${d.getDate()} ${month(d).slice(0, 3)}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/**
 * The same clock time here a week after `iso`, a week further each time until it's still to come.
 * Moving the date keeps the clock time when summer time starts or ends in between; adding 168 hours wouldn't.
 */
export function weekOn(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  do { d.setDate(d.getDate() + 7); } while (d.getTime() <= now);
  return d.toISOString();
}
/** Where the browser is, such as "Europe/London": the days in an answer about a series are read in it. */
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
