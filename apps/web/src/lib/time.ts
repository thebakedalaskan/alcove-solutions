/* Dates and times as the app shows them: 24-hour clock, day before month. */
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const weekday = (d: Date) => WEEKDAY[d.getDay()] ?? '';
const month = (d: Date) => MONTH[d.getMonth()] ?? '';
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** Whole days from today to `d`: 0 today, 1 tomorrow, -1 yesterday. */
export const daysFromToday = (d: Date, now = new Date()) => Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);

export const hm = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** "Tue 3 Nov" */
export const shortDay = (d: Date) => `${weekday(d).slice(0, 3)} ${d.getDate()} ${month(d).slice(0, 3)}`;
/** "Tuesday, 3 November" */
export const longDay = (d: Date) => `${weekday(d)}, ${d.getDate()} ${month(d)}`;
/** "Today, Tue 3 Nov", "Tomorrow, Wed 4 Nov" or "Thursday, 5 Nov". */
export function dayChoice(d: Date, now = new Date()): string {
  const n = daysFromToday(d, now);
  if (n === 0) return `Today, ${shortDay(d)}`;
  if (n === 1) return `Tomorrow, ${shortDay(d)}`;
  return `${weekday(d)}, ${d.getDate()} ${month(d).slice(0, 3)}`;
}
/** For lists of notes: "Today", "Yesterday" or "Fri 30 Oct". */
export function noteDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = daysFromToday(d, now);
  return n === 0 ? 'Today' : n === -1 ? 'Yesterday' : shortDay(d);
}
/** "Monday 2 November · 10:00 to 10:31" */
export function noteWhen(startedAt: string, seconds: number): string {
  const a = new Date(startedAt);
  const b = new Date(a.getTime() + seconds * 1000);
  return `${weekday(a)} ${a.getDate()} ${month(a)} · ${hm(a)} to ${hm(b)}`;
}
/** Groups for the notes list: "This week", "Last week", then month names. */
export function noteGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = -daysFromToday(d, now);
  const dow = (now.getDay() + 6) % 7;
  if (n <= dow) return 'This week';
  if (n <= dow + 7) return 'Last week';
  return d.getFullYear() === now.getFullYear() ? month(d) : `${month(d)} ${d.getFullYear()}`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
/** "6 h 40 min", "25 min" */
export function hoursAndMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
/** "4:05" for positions in a recording. */
export const position = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
