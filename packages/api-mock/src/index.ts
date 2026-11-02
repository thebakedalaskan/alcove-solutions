import {
  AlcoveApiError, type AlcoveApi, type AnswerPart, type CallState, type CreditPack, type Meeting, type MeetingInput, type Note,
  type NoteProgress, type NoteSummary, type Passkey, type SetupStep
} from '@alcove/api';
import { MockCallSession } from './call';
import { type DB, PER_MINUTE, demoDb, emptyDb, freshDb, load, makeNote, save, type Scenario } from './db';
import { ANSWERS, PEOPLE, demoMeetings, findPerson, makeCode } from './fixtures';
import { MockRoomRecording } from './recording';
import { sleep, uid } from './emitter';

export { ScenarioSchema, type Scenario } from './db';

export interface MockOptions {
  /** Simulated network latency in ms, [min, max]. */
  latency?: [number, number];
  /** Persist to localStorage so refreshes keep state. Default true. */
  persist?: boolean;
  /** Seconds it takes the notes service to "write" notes after a call. */
  writeSeconds?: number;
}

export interface MockControls {
  scenario(): Scenario;
  setScenario(s: Scenario): void;
  reset(): void;
}

const PACKS: CreditPack[] = [{ id: 'p10', credits: 10_000, priceUsdc: 10 }, { id: 'p50', credits: 50_000, priceUsdc: 45, badge: 'Save 10%' }, { id: 'p100', credits: 100_000, priceUsdc: 80, badge: 'Save 20%' }];

const WRITE_STEPS = (kind: 'call' | 'room', keep: 'full' | 'notes', audience: 'everyone' | 'host') => kind === 'call'
  ? ['Call ended', 'Audio and screen frames sealed in the notes server', 'Summary, decisions and action items written', keep === 'full' ? 'Transcript saved with the notes' : 'Transcript deleted', audience === 'host' ? 'Notes saved for you' : 'Notes sent to everyone in the call']
  : ['Recording stopped', 'Last audio piece sealed and uploaded', 'Transcript and speakers worked out', 'Summary, decisions and action items written', 'Saved. Only you can read it.'];

export function createMockApi(opts: MockOptions = {}): { api: AlcoveApi; controls: MockControls } {
  const [lo, hi] = opts.latency ?? [120, 380];
  const persist = opts.persist ?? true;
  const writeMs = (opts.writeSeconds ?? 4.5) * 1000;
  let db: DB = persist ? load() : emptyDb();

  const net = () => sleep(lo + Math.random() * (hi - lo));
  const commit = () => { if (persist) save(db); };
  const clone = <T,>(v: T): T => structuredClone(v);
  const authed = () => {
    if (!db.session) throw new AlcoveApiError('unauthenticated', 'Sign in to continue.');
    return db.session;
  };
  const meeting = (id: string) => {
    const m = db.meetings.find((x) => x.id === id);
    if (!m) throw new AlcoveApiError('not-found', 'That meeting no longer exists.');
    return m;
  };
  const note = (id: string) => {
    const n = db.notes.find((x) => x.id === id);
    if (!n) throw new AlcoveApiError('not-found', 'Those notes no longer exist.');
    return n;
  };
  const summary = (n: Note): NoteSummary => ({
    id: n.id, kind: n.kind, title: n.title, startedAt: n.startedAt, duration: n.duration, people: n.people, excerpt: n.excerpt,
    openActions: n.actions.filter((a) => !a.done).length, totalActions: n.actions.length, keep: n.keep, meetingId: n.meetingId
  });
  const charge = (label: string, detail: string, seconds: number) => {
    const amount = Math.max(1, Math.round(seconds / 60)) * PER_MINUTE;
    db.credits = Math.max(0, db.credits - amount);
    db.history.unshift({ id: uid('h'), at: new Date().toISOString(), label, detail, amount: -amount });
  };
  /** A guest without an account has no local data, so the demo link always resolves to Ben's public call. */
  const DEMO_CODE = 'kpw-rnzq-hte';
  const findByCode = (code: string) => db.meetings.find((m) => m.code === code) ?? (code === DEMO_CODE ? demoMeetings().find((m) => m.code === DEMO_CODE) : undefined);
  const guestsFrom = (emails: string[]) => emails.map((e) => ({ email: e, person: findPerson(e), rsvp: 'pending' as const }));

  const api: AlcoveApi = {
    auth: {
      async getSession() { await sleep(30); return clone(db.session); },
      async signIn(provider, email) {
        await sleep(1400);
        db = freshDb(provider, email ?? (provider === 'microsoft' ? 'maya.chen@outlook.com' : provider === 'apple' ? 'maya.chen@icloud.com' : undefined));
        commit();
        return clone(authed());
      },
      async createPasskey() {
        const s = authed(); await sleep(1300);
        const pk: Passkey = { id: uid('pk'), deviceName: 'This Mac', createdAt: new Date().toISOString(), thisDevice: true };
        db.passkeys.push(pk); db.session = { ...s, hasPasskey: true }; commit();
        return clone(pk);
      },
      async signOut() { await net(); db = emptyDb(); commit(); }
    },
    account: {
      async preferences() { await net(); authed(); return clone(db.prefs); },
      async updatePreferences(p) { await net(); authed(); db.prefs = { ...db.prefs, ...p }; commit(); return clone(db.prefs); },
      async passkeys() { await net(); authed(); return clone(db.passkeys); },
      async addPasskey() {
        await sleep(900); authed();
        const pk: Passkey = { id: uid('pk'), deviceName: 'iPhone', createdAt: new Date().toISOString(), thisDevice: false };
        db.passkeys.push(pk); commit(); return clone(pk);
      },
      async calendars() { await net(); authed(); return clone(db.calendars); },
      async setCalendar(provider, connected) {
        await net(); authed();
        db.calendars = db.calendars.map((c) => (c.provider === provider ? { ...c, connected, viaSignIn: connected && c.viaSignIn } : c));
        commit(); return clone(db.calendars);
      },
      async setupSteps() {
        await net(); const s = authed();
        const name = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple', email: 'email' }[s.provider];
        const cal = db.calendars.find((c) => c.connected);
        const steps: SetupStep[] = [
          { id: 'signed-in', label: `Signed in with ${name}`, done: true },
          { id: 'passkey', label: 'Passkey saved on this device', done: s.hasPasskey },
          { id: 'calendar', label: cal ? `${{ google: 'Google', microsoft: 'Outlook', apple: 'iCloud' }[cal.provider]} Calendar connected` : 'Connect a calendar', done: !!cal },
          { id: 'first-call', label: 'Have your first call', done: db.meetings.some((m) => m.status === 'ended') || db.notes.length > 0 },
          { id: 'second-passkey', label: 'Add a passkey on a second device', done: db.passkeys.length > 1 }
        ];
        return steps;
      }
    },
    meetings: {
      async upcoming() {
        await net(); authed();
        const cutoff = Date.now() - 60 * 60_000;
        return clone(db.meetings.filter((m) => (m.status === 'scheduled' || m.status === 'live') && new Date(m.endsAt).getTime() > cutoff).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      },
      async past() {
        await net(); authed();
        return clone(db.meetings.filter((m) => m.status === 'ended').sort((a, b) => b.startsAt.localeCompare(a.startsAt)));
      },
      async get(id) { await net(); authed(); return clone(meeting(id)); },
      async byCode(code) { await net(); return clone(findByCode(code) ?? null); },
      async create(input: MeetingInput) {
        await net(); const s = authed();
        const start = new Date(input.startsAt);
        const m: Meeting = {
          id: uid('m'), title: input.title.trim() || 'Untitled call', startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + input.durationMinutes * 60_000).toISOString(), host: s.user, isHost: true,
          guests: guestsFrom(input.guests), notes: input.notes, audience: input.audience, code: makeCode(), status: 'scheduled'
        };
        db.meetings.push(m); commit(); return clone(m);
      },
      async update(id, input) {
        await net(); authed(); const m = meeting(id);
        if (!m.isHost) throw new AlcoveApiError('forbidden', 'Only the host can change this call.');
        if (input.title !== undefined) m.title = input.title.trim() || m.title;
        if (input.startsAt || input.durationMinutes) {
          const start = new Date(input.startsAt ?? m.startsAt);
          const mins = input.durationMinutes ?? (new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000;
          m.startsAt = start.toISOString(); m.endsAt = new Date(start.getTime() + mins * 60_000).toISOString();
        }
        if (input.guests) m.guests = input.guests.map((e) => m.guests.find((g) => g.email === e) ?? { email: e, person: findPerson(e), rsvp: 'pending' });
        if (input.notes) m.notes = input.notes;
        if (input.audience) m.audience = input.audience;
        commit(); return clone(m);
      },
      async setNotes(id, notes) { await net(); authed(); const m = meeting(id); m.notes = notes; commit(); return clone(m); },
      async resendInvite() { await net(); authed(); },
      async cancel(id) { await net(); authed(); const m = meeting(id); m.status = 'cancelled'; commit(); }
    },
    links: {
      async create(notes) {
        await net(); const s = authed(); const code = makeCode();
        const now = new Date();
        db.meetings.push({ id: uid('m'), title: `${s.user.name.split(' ')[0]}\u2019s call`, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3600_000).toISOString(), host: s.user, isHost: true, guests: [], notes, audience: 'everyone', code, status: 'scheduled' });
        commit();
        return { code, url: `https://alcove.app/${code}#k=${Math.random().toString(36).slice(2, 12)}`, notes };
      }
    },
    calls: {
      async createInstant() {
        await net(); const s = authed(); const code = makeCode(); const now = new Date();
        db.meetings.push({ id: uid('m'), title: `${s.user.name.split(' ')[0]}\u2019s call`, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3600_000).toISOString(), host: s.user, isHost: true, guests: [], notes: db.prefs.notesDefault === 'always' ? db.prefs.keep : db.prefs.notesDefault === 'never' ? 'off' : 'ask', audience: 'everyone', code, status: 'scheduled' });
        commit(); return { code };
      },
      async join(code, o) {
        await net();
        const m = findByCode(code);
        if (!m) throw new AlcoveApiError('not-found', 'There\u2019s no call with that code. Check the link and try again.');
        const session = db.session;
        const isGuest = !session;
        const guestName = o.name?.trim() ?? '';
        if (!session && !guestName) throw new AlcoveApiError('invalid', 'Add your name so people know who\u2019s joining.');
        const me = session ? session.user : { id: uid('g'), name: guestName, email: '' };
        const hostDecides = m.isHost && !isGuest;
        const notes = hostDecides ? (o.notes ?? (m.notes === 'ask' ? 'off' : m.notes)) : m.notes === 'ask' ? 'off' : m.notes;
        m.status = 'live'; commit();
        return new MockCallSession({
          meeting: clone(m), me, isGuest, mic: o.mic, cam: o.cam, notes, audience: o.audience ?? m.audience,
          instant: !!o.instant || (m.isHost && m.guests.length === 0),
          onLeave: async (st: CallState) => {
            await net();
            const dur = Math.max(st.elapsed, 60);
            m.status = 'ended'; m.duration = dur;
            let pendingNoteId: string | null = null;
            if (st.notes.everOn && !isGuest) {
              pendingNoteId = uid('n');
              const n = makeNote({ id: pendingNoteId, title: m.title, kind: 'call', keep: st.notes.mode, startedAt: m.startsAt, duration: dur, meetingId: m.id });
              n.audience = st.notes.audience;
              db.notes.unshift(n); m.noteId = pendingNoteId; db.writing[pendingNoteId] = Date.now();
              charge(m.title, `${Math.max(1, Math.round(dur / 60))} min of notes`, dur);
            }
            commit();
            return { meetingId: m.id, pendingNoteId, duration: dur };
          }
        });
      }
    },
    recordings: {
      async start(title) {
        await net(); authed();
        return new MockRoomRecording(title ?? 'Untitled recording', async (st) => {
          await net();
          const id = uid('n'); const dur = Math.max(st.elapsed, 60);
          db.notes.unshift(makeNote({ id, title: st.title || 'Untitled recording', kind: 'room', keep: 'full', startedAt: new Date(Date.now() - dur * 1000).toISOString(), duration: dur }));
          db.writing[id] = Date.now();
          charge(st.title || 'Room recording', `${Math.max(1, Math.round(dur / 60))} min in the room`, dur);
          commit();
          return { pendingNoteId: id, duration: dur };
        });
      }
    },
    notes: {
      async list(q) {
        await net(); authed();
        const text = q?.text?.trim().toLowerCase();
        return db.notes.filter((n) => (!q?.kind || n.kind === q.kind) && (!text || `${n.title} ${n.summary} ${(n.transcript ?? []).map((l) => l.text).join(' ')}`.toLowerCase().includes(text)))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(summary);
      },
      async get(id) { await net(); authed(); return clone(note(id)); },
      async *progress(id): AsyncIterable<NoteProgress> {
        const n = note(id);
        const steps = WRITE_STEPS(n.kind, n.keep, n.audience);
        const started = db.writing[id] ?? 0;
        for (;;) {
          const k = Math.min(steps.length, Math.floor(((Date.now() - started) / writeMs) * steps.length) + 1);
          const ready = k >= steps.length && Date.now() - started >= writeMs;
          yield { noteId: id, title: n.title, steps: steps.map((label, i) => ({ label, done: i < k })), ready };
          if (ready) { delete db.writing[id]; commit(); return; }
          await sleep(writeMs / steps.length / 2);
        }
      },
      async setActionDone(noteId, actionId, done) {
        await net(); authed();
        const a = note(noteId).actions.find((x) => x.id === actionId);
        if (a) a.done = done; commit();
      },
      async openActions() {
        await net(); const s = authed();
        return db.notes.flatMap((n) => n.actions.filter((a) => !a.done && (a.owner.person?.id === s.user.id || n.kind === 'room' && a.owner.person?.id === PEOPLE.maya.id)).map((a) => ({ ...clone(a), noteId: n.id, noteTitle: n.title }))).slice(0, 5);
      },
      async *ask(noteId, question): AsyncIterable<AnswerPart> {
        await sleep(450);
        const n = note(noteId);
        const q = question.toLowerCase();
        const keys = n.suggestedQuestions;
        const score = (k: string) => `${k} ${ANSWERS[k] ?? ''}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && q.includes(w)).length;
        const best = keys.find((k) => k.toLowerCase() === q) ?? [...keys].sort((a, b) => score(b) - score(a))[0];
        const text = (best && ANSWERS[best]) ?? 'I couldn\u2019t find that in these notes.';
        for (const piece of text.split(/(\{\d\d:\d\d\})/)) {
          const cite = /^\{(\d\d):(\d\d)\}$/.exec(piece);
          if (cite) { yield { type: 'cite', at: Number(cite[1]) * 60 + Number(cite[2]) }; continue; }
          for (const w of piece.split(/(?<=\s)/)) { if (w) { yield { type: 'text', text: w }; await sleep(38); } }
        }
      },
      async shareLink(id) { await net(); authed(); note(id); return `https://alcove.app/n/${id}`; }
    },
    credits: {
      async balance() { await net(); authed(); return { balance: db.credits, perMinute: PER_MINUTE }; },
      async history() { await net(); authed(); return clone(db.history); },
      async packs() { await net(); return clone(PACKS); },
      async purchase(packId) {
        await sleep(1200); authed();
        const pack = PACKS.find((p) => p.id === packId);
        if (!pack) throw new AlcoveApiError('invalid', 'Unknown credit pack.');
        db.credits += pack.credits;
        db.history.unshift({ id: uid('h'), at: new Date().toISOString(), label: 'Credits added', detail: `Paid ${pack.priceUsdc} USDC`, amount: pack.credits });
        commit(); return { balance: db.credits, perMinute: PER_MINUTE };
      }
    },
    stats: {
      async week() {
        await net(); authed();
        const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
        const demo = db.scenario === 'demo' ? [55, 82, 25, 41, 0, 28, 0] : [0, 0, 0, 0, 0, 0, 0];
        const minutesByDay = days.map((d, i) => {
          const live = db.meetings.filter((m) => m.status === 'ended' && new Date(m.startsAt).toDateString() === d.toDateString() && !m.id.startsWith('m-')).reduce((s, m) => s + Math.round((m.duration ?? 0) / 60), 0);
          const seeded = i === 6 && db.scenario === 'demo' ? 32 : demo[i] ?? 0;
          return { date: d.toISOString(), minutes: seeded + live };
        });
        return {
          minutesByDay, notes: db.notes.length,
          actionItems: db.notes.reduce((s, n) => s + n.actions.length, 0),
          roomRecordings: db.notes.filter((n) => n.kind === 'room').length
        };
      }
    }
  };

  const controls: MockControls = {
    scenario: () => db.scenario,
    setScenario(s) {
      db = s === 'demo' ? demoDb() : s === 'fresh' ? freshDb('google') : emptyDb();
      if (s === 'fresh' && db.session) {
        db.session = { ...db.session, hasPasskey: true };
        db.passkeys = [{ id: 'pk1', deviceName: 'This Mac', createdAt: new Date().toISOString(), thisDevice: true }];
      }
      commit();
    },
    reset() { db = emptyDb(); commit(); }
  };
  return { api, controls };
}
