import type { WeekStats } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { rows } from '../db';
import { listItems } from '../vault';
import { NoteManifest } from './notes';

/** Minutes in calls and room recordings for each of the last 7 days. Times and counts only, no content. */
export async function week(o: Owner): Promise<WeekStats> {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const since = days[0] ?? new Date();
  const calls = await rows(o.pool, z.object({ started_at: z.date(), seconds: z.coerce.number() }),
    `SELECT started_at, extract(epoch FROM (coalesce(ended_at, now()) - started_at)) AS seconds FROM calls WHERE owner_id = $1 AND started_at >= $2`, [o.ownerId, since]);
  const notes = await listItems(o, o.pool, 'note', NoteManifest);
  const room = notes.filter((n) => n.manifest.kind === 'room');
  const minutesByDay = days.map((d) => {
    const same = (t: Date) => t.toDateString() === d.toDateString();
    const secs = calls.filter((c) => same(c.started_at)).reduce((s, c) => s + c.seconds, 0) + room.filter((n) => same(new Date(n.manifest.startedAt))).reduce((s, n) => s + n.manifest.duration, 0);
    return { date: d.toISOString(), minutes: Math.round(secs / 60) };
  });
  return { minutesByDay, notes: notes.length, actionItems: notes.reduce((s, n) => s + n.manifest.actions.length, 0), roomRecordings: room.length };
}
