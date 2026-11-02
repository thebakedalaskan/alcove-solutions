export const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const dayKey = (iso: string) => new Date(iso).toDateString();
export const isToday = (iso: string) => dayKey(iso) === new Date().toDateString();

export function dayLabel(iso: string): string {
  const d = new Date(iso); const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t.getTime()) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: diff > 0 && diff < 7 ? 'long' : 'short', month: diff > 0 && diff < 7 ? undefined : 'short', day: diff > 0 && diff < 7 ? undefined : 'numeric' });
}
export const fullDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const longToday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function minutesBetween(a: string, b: string) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000); }

export function untilLabel(iso: string): string {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

export const hoursOfNotes = (credits: number, perMinute = 25) => {
  const h = credits / perMinute / 60;
  return h >= 1 ? `${h.toFixed(1).replace('.0', '')} hours` : `${Math.round(h * 60)} minutes`;
};
export { minutesLabel } from '@alcove/api';
