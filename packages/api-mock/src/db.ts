import { CalendarConnectionSchema, CreditEventSchema, MeetingSchema, NoteSchema, PasskeySchema, PreferencesSchema, SessionSchema, type CalendarConnection, type Note, type NotesKeep, type Session } from '@alcove/api';
import { z } from 'zod';
import { PEOPLE, callNoteBody, demoMeetings, roomNoteBody } from './fixtures';

export const ScenarioSchema = z.enum(['signed-out', 'fresh', 'demo']);
export type Scenario = z.infer<typeof ScenarioSchema>;

const DBSchema = z.object({
  v: z.literal(3),
  scenario: ScenarioSchema,
  session: SessionSchema.nullable(),
  passkeys: z.array(PasskeySchema),
  prefs: PreferencesSchema,
  calendars: z.array(CalendarConnectionSchema),
  meetings: z.array(MeetingSchema),
  notes: z.array(NoteSchema),
  credits: z.number(),
  history: z.array(CreditEventSchema),
  /** noteId -> epoch ms when writing started. Notes are "ready" a few seconds later. */
  writing: z.record(z.string(), z.number())
});
export type DB = z.infer<typeof DBSchema>;

const KEY = 'alcove-mock-db';
export const PER_MINUTE = 25;
const nowIso = () => new Date().toISOString();

const calendars = (provider?: string): CalendarConnection[] => [
  { provider: 'google', connected: provider === 'google', viaSignIn: provider === 'google' },
  { provider: 'microsoft', connected: provider === 'microsoft', viaSignIn: provider === 'microsoft' },
  { provider: 'apple', connected: provider === 'apple', viaSignIn: provider === 'apple' }
];

export function makeNote(o: { id: string; title: string; kind: Note['kind']; keep: NotesKeep; startedAt: string; duration: number; meetingId?: string }): Note {
  const body = o.kind === 'call' ? callNoteBody() : roomNoteBody();
  const sentences = body.summary.split(/(?<=\.)\s/);
  return {
    ...body, ...o,
    actions: body.actions.map((x) => ({ ...x, id: `${o.id}-${x.id}` })),
    transcript: o.keep === 'full' ? body.transcript : null,
    excerpt: sentences.slice(0, 2).join(' '),
    openActions: body.actions.filter((a) => !a.done).length,
    totalActions: body.actions.length
  };
}

export function emptyDb(): DB {
  return {
    v: 3, scenario: 'signed-out', session: null, passkeys: [], prefs: { notesDefault: 'ask', keep: 'full' },
    calendars: calendars(), meetings: [], notes: [], credits: 0, history: [], writing: {}
  };
}

export function freshDb(provider: Session['provider'], email?: string): DB {
  const user = { ...PEOPLE.maya, email: email ?? PEOPLE.maya.email };
  return {
    ...emptyDb(), scenario: 'fresh',
    session: { user, provider, hasPasskey: false, createdAt: nowIso() },
    calendars: calendars(provider),
    credits: 10_000,
    history: [{ id: 'h0', at: nowIso(), label: 'Welcome credits', detail: 'Added when you signed up', amount: 10_000 }]
  };
}

export function demoDb(): DB {
  const meetings = demoMeetings();
  const byId = (id: string) => { const m = meetings.find((x) => x.id === id); if (!m) throw new Error(`Demo fixture ${id} is missing`); return m; };
  const harbor = byId('m-harbor');
  const legal = byId('m-legal');
  const room = new Date(Date.now() - 26 * 3600_000);
  return {
    ...emptyDb(), scenario: 'demo',
    session: { user: PEOPLE.maya, provider: 'google', hasPasskey: true, createdAt: new Date(Date.now() - 21 * 86400_000).toISOString() },
    passkeys: [{ id: 'pk1', deviceName: 'MacBook Pro', createdAt: new Date(Date.now() - 21 * 86400_000).toISOString(), thisDevice: true }],
    calendars: calendars('google'),
    meetings,
    notes: [
      makeNote({ id: 'n-harbor', title: harbor.title, kind: 'call', keep: 'full', startedAt: harbor.startsAt, duration: 32 * 60, meetingId: harbor.id }),
      makeNote({ id: 'n-board', title: 'Board prep with Dana', kind: 'room', keep: 'full', startedAt: room.toISOString(), duration: 28 * 60 }),
      makeNote({ id: 'n-legal', title: legal.title, kind: 'call', keep: 'notes', startedAt: legal.startsAt, duration: 25 * 60, meetingId: legal.id })
    ],
    credits: 8_500,
    history: [
      { id: 'h3', at: harbor.startsAt, label: 'Harbor pilot review', detail: '32 min of notes', amount: -800 },
      { id: 'h2', at: room.toISOString(), label: 'Board prep with Dana', detail: '28 min in the room', amount: -700 },
      { id: 'h1', at: new Date(Date.now() - 21 * 86400_000).toISOString(), label: 'Welcome credits', detail: 'Added when you signed up', amount: 10_000 }
    ]
  };
}

export function load(): DB {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) { const db = DBSchema.safeParse(JSON.parse(raw)); if (db.success) return db.data; }
  } catch { /* storage unavailable */ }
  return emptyDb();
}
export function save(db: DB) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable */ }
}
