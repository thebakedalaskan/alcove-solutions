import { shortDay } from '~/lib/time';

/** A day as a date tag stores it: YYYY-MM-DD, on the reader's calendar. */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today, Tomorrow or Fri 6 Nov, and Fri 5 Feb 2027 outside this year. The date is what's stored, so this goes on being right. */
export function dateLabel(iso: string, now = new Date()): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return date.getFullYear() === now.getFullYear() ? shortDay(date) : `${shortDay(date)} ${date.getFullYear()}`;
}
