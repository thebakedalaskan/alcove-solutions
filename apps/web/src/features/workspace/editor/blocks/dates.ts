import { shortDay } from '~/lib/time';

/** Today, Tomorrow or Fri 6 Nov. The date is what's stored, so this goes on being right. */
export function dateLabel(iso: string, now = new Date()): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : shortDay(date);
}
