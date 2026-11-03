/* Small pure helpers shared by implementations and the UI. */
export const NOTES_LABEL = { on: 'Notes on', off: 'No notes' } as const;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutesLabel(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
