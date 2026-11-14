/*
 * A call as a calendar file, made here in the browser: no calendar service, or anyone else, sees its title. It's
 * RFC 5545: times in UTC, so whatever calendar opens it shows them where it is.
 */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** Lines can be 75 bytes long, and go on after a line break and a space. A letter is never cut in two. */
function fold(line: string): string {
  const size = new TextEncoder();
  const out: string[] = [];
  let part = '';
  let bytes = 0;
  for (const ch of line) {
    const n = size.encode(ch).length;
    if (bytes + n > 74) { out.push(part); part = ''; bytes = 0; }
    part += ch;
    bytes += n;
  }
  return [...out, part].join('\r\n ');
}

export interface CalendarCall { code: string; title: string; organizerName: string; startsAt: string; minutes: number; url: string }

export function calendarFile(c: CalendarCall, now = new Date()): string {
  const start = new Date(c.startsAt);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alcove//Calls//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${c.code}@alcove`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + c.minutes * 60_000))}`,
    `SUMMARY:${text(c.title)}`, `DESCRIPTION:${text(`With ${c.organizerName}. Join at ${c.url}`)}`, `LOCATION:${text(c.url)}`, `URL:${c.url}`,
    'END:VEVENT', 'END:VCALENDAR', ''
  ].map(fold).join('\r\n');
}

/** Hands the browser the file to save or open. */
export function saveCalendarFile(c: CalendarCall) {
  const url = URL.createObjectURL(new Blob([calendarFile(c)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alcove-call.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
