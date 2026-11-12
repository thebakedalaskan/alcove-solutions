/*
 * The stand-in backend: the whole AlcoveApi, so the compiler keeps it in step with the contract, answering from the
 * story's world (state.ts). It keeps the server's behaviour simple: it answers from the scenario, a change changes the
 * world for the rest of the story, and it doesn't reimplement search ranking, scheduling or permissions. Like the real
 * client it takes a moment to answer, refuses everything without a connection (`network`) and everything but the public
 * calls without a session (`unauthenticated`), and says `not-found` for what isn't there.
 *
 * A method nothing renders yet answers with something sensible and empty. When the contract grows, this grows with it.
 */
import { StartTopUpBodySchema, type Purchase, type TopUp } from '@alcove/api';
import { freshEntryId, PREVIEW_BASE_ADDRESS, PREVIEW_DEPOSIT_ADDRESS } from '../world/payments';
import { buyFromBalance, hoursOf, proPriceOf, withProMonths } from '../world/plans';
import { playPayment, settlePayments } from './payments';
import { DriveExportInputSchema, NOTE_LINK_DAYS, type DriveAutomatic, type DriveCallExports, type DriveExportFormat, type DriveExportInput, type DriveExportJob, type NewNoteLink, type NoteLink, type NoteLinkClaimed } from '@alcove/api';
import { disconnectedDrive } from '../world/drive-exports';
import type { BoardSortBody, DocAskBody, DocAskPart } from '@alcove/api';
import {
  ACCEPTED_FOLLOW_UP, AlcoveApiError, type FollowUpReview, type FollowUpTarget, type NoteAction, AgentAuthorizationIdSchema, AgentConnectionIdSchema, AgentDecisionInputSchema, AgentTokenInputSchema, DEFAULT_NOTES_CHOICES, searchOf, termsIn, type ActionPatch, type ActionProposal, type AlcoveApi, type AgentConnection, type AnswerPart, type Busy, type CallCard,
  type CallDocument, type CallSession, type Change, type ChangeScope, type DecisionPatch, type DecisionProposal, type ID, type Inbox, type IncomingRing,
  type FileNotes, type InstantCallInput, type Interval, type LinePatch, type Meeting, type MeetingCreate, type MeetingInput, type Note, type NoteFound, type NoteKind, type NoteProgress,
  type Patch, type Preferences, type PromoteBody, type PromotionPreview, type QuestionPatch, type RecipientRole, type RingReply, type Rsvp, type Series, type SharedAudience, type SharedWrite,
  type SeriesAnswerPart, type SeriesNote, type SignInResult, type DemoProvider, type RoomRecordingInput, type RoomRecording, type CallMoveIn, type WorkspaceItem
} from '@alcove/api';
import { isOnline } from '../browser';
import { canvasTheme } from '../world/boards';
import { changer, foundOf } from '../world/build';
import { personAt } from '../world/people';
import { session as sessionFor, type World } from '../world';
import { joinCall, type ScriptedCall } from './call';
import { Pushed, pause } from './live';
import { audioUrlFor, quietAudio, screenImage } from './media';
import { ScriptedMove } from './move';
import { personalFor } from './personal';
import { ScriptedRecording } from './recording';
import { AI_MODELS, atTheDoor } from './script';
import { current, me, nextId, openedAs } from './state';
import { agentsFor, EXPIRED_AGENT_REQUEST, forgetAgents, PREVIEW_AGENT_TOKEN, PREVIEW_MCP_ENDPOINT } from './agents';
import * as spaces from './workspaces';

/* ---------- how every answer comes back ---------- */

const refused = (code: 'not-found' | 'forbidden' | 'conflict' | 'invalid', message: string) => new AlcoveApiError(code, message, { requestId: nextId('sb-req') });
const noPayments = () => new AlcoveApiError('unavailable', 'Top-ups aren’t available right now.', { requestId: nextId('sb-req') });
const paymentRoutes = (w: World) => { if (!w.payments.routes) throw noPayments(); return w.payments.routes; };
const paymentIn = (w: World, id: string): TopUp => {
  paymentRoutes(w);
  const t = w.payments.topUps.find((x) => x.id === id);
  if (!t) throw refused('not-found', 'That top-up isn’t there any more.');
  return t;
};
/** An amount as the server's refusals say it: "$192", "$12.50". */
const dollars = (microUsd: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: microUsd % 1_000_000 === 0 ? 0 : 2 }).format(microUsd / 1_000_000);
/**
 * Refuses a purchase as the server does before anything is bought or a payment opened for it: past the most one purchase
 * buys, or at a price other than today's for that much.
 */
function checkPurchase(w: World, buys: Purchase): void {
  const o = w.payments.offers;
  if (buys.kind === 'pro') {
    if (!Number.isInteger(buys.months) || buys.months < 1 || buys.months > o.pro.maxMonths) throw refused('invalid', `Buy 1 to ${o.pro.maxMonths} months at a time.`);
    if (buys.microUsdPerMonth !== proPriceOf(o, buys.months)) throw refused('conflict', 'The price of Pro has changed. Look at it again before buying.');
    return;
  }
  if (!o.hours) throw refused('conflict', 'More notes can’t be bought right now.');
  if (!Number.isInteger(buys.packs) || buys.packs < 1 || buys.packs > o.hours.maxPacks) throw refused('invalid', `Buy up to ${hoursOf(o, o.hours.maxPacks)} hours of notes at a time.`);
  if (buys.microUsdPerPack !== o.hours.microUsd) throw refused('conflict', 'The price of more notes has changed. Look at it again before buying.');
}
/** Buys from the balance once the purchase checks out, refused with nothing charged when the balance is short. */
function buyNow(w: World, buys: Purchase) {
  checkPurchase(w, buys);
  const cost = buys.kind === 'pro' ? buys.months * buys.microUsdPerMonth : buys.packs * buys.microUsdPerPack;
  const balance = w.plan.balance.microUsd;
  if (balance < cost) {
    const what = buys.kind === 'pro' ? `${buys.months} ${buys.months === 1 ? 'month' : 'months'} of Pro` : `${hoursOf(w.payments.offers, buys.packs)} hours of notes`;
    throw refused('conflict', `Your balance is short: ${what} cost ${dollars(cost)} and your balance is ${dollars(balance)}. Add money first.`);
  }
  w.plan = buyFromBalance(w.plan, buys, w.payments.offers, freshEntryId(w));
  return w.plan;
}
const offline = () =>new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');

/** Answers after a moment, from the world as it is then, as a copy: what the app holds never changes under it. */
async function answer<T>(read: (w: World) => T, who: 'anyone' | 'signed-in' = 'signed-in'): Promise<T> {
  await pause(openedAs().latency);
  if (!isOnline()) throw offline();
  const w = current();
  if (who === 'signed-in' && !w.session) throw new AlcoveApiError('unauthenticated', 'Your session ended. Sign in again.');
  return structuredClone(read(w));
}
/** The same, for what streams: refused before the first part, like a request that never opened. */
async function* stream<T>(parts: (w: World) => T[], every = 70): AsyncIterable<T> {
  const all = await answer(parts);
  for (const p of all) { await pause(every); yield p; }
}

const noteIn = (w: World, id: string): Note => {
  const n = w.notes.find((x) => x.id === id);
  if (!n) throw refused('not-found', 'Those notes aren’t there any more.');
  return n;
};
const meetingIn = (w: World, id: string): Meeting => {
  const m = w.meetings.find((x) => x.id === id);
  if (!m) throw refused('not-found', 'That call isn’t there any more.');
  return m;
};
const byCode = (w: World, code: string): Meeting | undefined => w.meetings.find((m) => m.code === code || m.seriesCode === code);
/** Changes a note in the world and answers with it as it is now. */
const changeNote = (id: string, change: (n: Note, w: World) => Note) => answer((w) => {
  const next = change(noteIn(w, id), w);
  w.notes = w.notes.map((n) => (n.id === id ? next : n));
  return next;
});
const roleIn = (n: Note): RecipientRole => n.recipients.find((r) => r.person.email === me().email)?.role ?? 'shared';
const reviewedActions = new WeakMap<World, Map<string, FollowUpReview>>();
const taskTarget = (a: NoteAction): FollowUpTarget => ({ id: a.id, revision: a.revision, text: a.text, owner: a.owner?.person?.email ?? null, due: a.due ?? null });
const changeBy = (n: Note, what: Change['what'], extra: Partial<Change> = {}): Change => ({ by: changer(me(), roleIn(n)), at: new Date().toISOString(), what, ...extra });

/** A new call's link code, `abc-defg-hij`. */
function newCode(): string {
  const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz'.charAt(Math.floor(Math.random() * 24))).join('');
  return `${letters(3)}-${letters(4)}-${letters(3)}`;
}
const addMinutes = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

function driveChoice(w: World, input: DriveExportInput) {
  const parsed = DriveExportInputSchema.parse(input);
  const destination = parsed.destinationId === null ? null : w.drive.folders.find((folder) => folder.id === parsed.destinationId);
  if (destination === undefined) throw refused('invalid', 'Choose a folder you can write to.');
  if (parsed.enabled && (!destination || !parsed.formats.length)) throw refused('invalid', 'Choose a folder and a file type first.');
  return { enabled: parsed.enabled, destination, formats: parsed.formats };
}
/** The links to a note that still work, newest first. */
const linksTo = (w: World, noteId: string): NoteLink[] => (w.noteLinks ?? []).filter((x) => x.noteId === noteId && Date.parse(x.link.expiresAt) > Date.now()).map((x) => x.link).reverse();

/** What holds a box for writing into the shared notes to who had the notes when it opened: if anyone gets them since, it's refused. */
const audienceSeal = (n: Note) => `shared:${n.people.map((p) => p.email.toLowerCase()).sort().join(' ')}`;

/** Whether automatic exports cover a call, as the server's rule has it: on, and the call ended after they were turned on. */
function automaticFor(w: World, n: Note): DriveAutomatic {
  const s = w.drive.settings;
  if (!s.enabled || !s.destination || !s.formats.length) return 'off';
  const ended = new Date(Date.parse(n.startedAt) + n.duration * 1000).toISOString();
  return n.status !== 'recording' && ended < w.drive.enabledAt ? 'before' : 'on';
}
function driveForNote(w: World, id: string): DriveCallExports {
  const n = noteIn(w, id);
  const override = w.drive.overrides[id] ?? null;
  const effective = override ?? { enabled: w.drive.settings.enabled, destination: w.drive.settings.destination, formats: w.drive.settings.formats };
  return { noteId: id, override, effective, automatic: automaticFor(w, n), jobs: w.drive.jobs.filter((job) => job.noteId === id) };
}
/** Uploads starting at once, as the server starts them: each file Uploading, then, a moment later, with its link in Drive. */
function uploadNow(w: World, noteId: string, formats: readonly DriveExportFormat[]): DriveExportJob[] {
  const at = new Date().toISOString();
  const going = formats.map((format): DriveExportJob => ({
    id: w.drive.jobs.find((j) => j.noteId === noteId && j.format === format)?.id ?? nextId('drive'), noteId, format, status: 'uploading', reason: null, fileUrl: null, updatedAt: at, nextAt: null
  }));
  w.drive.jobs = [...going, ...w.drive.jobs.filter((j) => !going.some((x) => x.id === j.id))];
  setTimeout(() => {
    if (current() !== w) return;
    w.drive.jobs = w.drive.jobs.map((j) => (going.some((x) => x.id === j.id) && j.status === 'uploading'
      ? { ...j, status: 'uploaded', fileUrl: `https://drive.google.com/file/d/preview_${j.id}/view`, updatedAt: new Date().toISOString() } : j));
  }, 1600);
  return going;
}

/* ---------- what's waiting on you, worked out from the notes ---------- */

function inboxOf(w: World): Inbox {
  const followUps: Inbox['followUps'] = [];
  const decisions: Inbox['decisions'] = [];
  for (const n of w.notes) {
    if (n.status !== 'ready') continue;
    const from = { noteId: n.id, noteTitle: n.title, noteStartedAt: n.startedAt, role: roleIn(n) };
    for (const a of n.actions) if (!a.done && a.owner?.person?.email === me().email) followUps.push({ ...a, ...from });
    for (const d of n.decisions) {
      const mine = d.changes.some((c) => c.by.email === me().email && (c.what === 'proposed' || c.what === 'disputed'));
      // On your own notes, a confirmed decision someone says wasn't decided is yours to settle.
      const settle = d.state === 'confirmed' && d.disputes.length > 0 && from.role === 'organizer';
      if ((d.state === 'proposed' && !mine) || settle) decisions.push({ ...d, ...from });
    }
  }
  return { followUps, decisions };
}

/* ---------- searching and asking, simply ---------- */

function found(w: World, kind: NoteKind | undefined, text: string | undefined): NoteFound[] {
  const notes = w.notes.filter((n) => !kind || n.kind === kind);
  if (!text?.trim()) return notes.map(foundOf);
  const { terms, question } = searchOf(text);
  if (!terms.length) return notes.map(foundOf);
  return notes.flatMap((n) => {
    const words = [n.title, n.excerpt, n.summary, ...(n.transcript ?? []).map((l) => l.text)].join(' ');
    const hits = termsIn(words, terms);
    if (question ? hits === 0 : hits < terms.length) return [];
    const said = (n.transcript ?? []).map((l) => ({ l, k: termsIn(l.text, terms) })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k).map(({ l }) => ({
      id: l.id, at: l.at, text: l.text, ...(l.speaker ? { speaker: l.speaker } : {}), ...(l.room ? { room: l.room } : {})
    }));
    return [{ ...foundOf(n), said: said.slice(0, 3), saidCount: said.length }];
  });
}

/** An answer about one note: what it decided, what's yours, a follow-up to send, or what was said about it. */
function answerAbout(n: Note, question: string): AnswerPart[] {
  const q = question.toLowerCase();
  const cite = (at: number | undefined): AnswerPart[] => (at === undefined ? [] : [{ type: 'cite', noteId: n.id, at }]);
  if (/decid/.test(q)) {
    const ds = n.decisions.filter((d) => d.state !== 'rejected');
    if (!ds.length) return [{ type: 'text', text: 'Nothing was decided in this call.' }];
    return [{ type: 'text', text: ds.map((d) => `${d.text}${d.state === 'proposed' ? ' Nobody has confirmed it yet.' : ''}`).join(' ') }, ...ds.flatMap((d) => cite(d.at))];
  }
  if (/\b(i|me|my)\b.*\b(do|need)|what do i/.test(q)) {
    const mine = n.actions.filter((a) => a.owner?.person?.email === me().email && !a.done);
    if (!mine.length) return [{ type: 'text', text: 'Nothing from this call is yours to do.' }];
    return [{ type: 'text', text: mine.map((a) => `${a.text}${a.due ? `, ${a.due.toLowerCase()}` : ''}.`).join(' ') }, ...mine.flatMap((a) => cite(a.at))];
  }
  if (/draft|follow-up|follow up/.test(q)) {
    const open = n.actions.filter((a) => !a.done).map((a) => `${a.owner?.name.split(' ')[0] ?? 'Someone'}: ${a.text.toLowerCase()}${a.due ? ` by ${a.due}` : ''}.`);
    return [{ type: 'text', text: `Thanks, all. ${n.summary} ${open.join(' ')}`.trim() }, ...n.decisions.flatMap((d) => cite(d.at))];
  }
  const { terms } = searchOf(question);
  const lines = (n.transcript ?? []).filter((l) => termsIn(l.text, terms) > 0).slice(0, 3);
  if (!lines.length) return [{ type: 'text', text: `The call didn’t get to that. ${n.excerpt}` }];
  return [{ type: 'text', text: lines.map((l) => `${l.speaker ? `${l.speaker.name.split(' ')[0]} said: ` : ''}“${l.text}”`).join(' ') }, ...lines.flatMap((l) => cite(l.at))];
}

/** An answer across every note: what the notes that match say, citing where. */
function answerAcross(w: World, question: string): AnswerPart[] {
  const hits = found(w, undefined, question).filter((n) => n.status === 'ready');
  if (!w.notes.some((n) => n.status === 'ready')) return [{ type: 'text', text: 'There are no written notes to answer from yet.' }];
  if (!hits.length) return [{ type: 'text', text: 'None of your notes say anything about that.' }];
  const top = hits.slice(0, 3);
  return [
    { type: 'text', text: top.map((n) => `${n.title}: ${n.excerpt}`).join(' ') },
    ...top.flatMap((n): AnswerPart[] => (n.said.length ? n.said.slice(0, 2).map((l): AnswerPart => ({ type: 'cite', noteId: n.id, at: l.at })) : [{ type: 'cite', noteId: n.id, at: 0 }]))
  ];
}
/** Text arrives a few words at a time, as the model writes it; the cites come after. */
function asWritten(parts: AnswerPart[]): AnswerPart[] {
  return parts.flatMap((p) => (p.type !== 'text' ? [p] : (p.text.match(/\S+\s*/g) ?? [p.text]).reduce<string[][]>((out, word, i) => {
    if (i % 4 === 0) out.push([]);
    out.at(-1)?.push(word);
    return out;
  }, []).map((ws): AnswerPart => ({ type: 'text', text: ws.join('') }))));
}

/* ---------- series ---------- */

function seriesIn(w: World, id: string): Series {
  const notes = w.notes.filter((n) => n.seriesId === id && n.status !== 'recording');
  const latest = notes[0];
  if (!latest) throw refused('not-found', 'That series isn’t there any more.');
  const next = w.meetings.filter((m) => m.seriesId === id && m.status === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const later = (noteId: string) => notes.findIndex((n) => n.id === noteId);
  return {
    id, title: next?.title ?? latest.title, organizer: latest.recipients[0]?.person ?? me(), isOrganizer: latest.recipients[0]?.person.email === me().email,
    ...(next ? { next } : {}), recurring: false, ...(next?.repeat ? { repeat: next.repeat } : {}),
    notes: notes.map((n): SeriesNote => ({ id: n.id, title: n.title, startedAt: n.startedAt, duration: n.duration, status: n.status, ...(n.meetingId ? { meetingId: n.meetingId } : {}), ...(n.received ? { received: n.received } : {}) })),
    older: 0,
    decisions: notes.flatMap((n) => n.decisions.filter((d) => d.state !== 'rejected').map((d) => ({ ...d, noteId: n.id }))),
    questions: notes.flatMap((n) => n.questions.filter((q) => q.state === 'open').map((q) => ({ ...q, noteId: n.id, later: later(n.id), stale: later(n.id) >= 2 }))),
    answered: [],
    actions: notes.flatMap((n) => n.actions.filter((a) => !a.done).map((a) => ({ ...a, noteId: n.id, later: later(n.id), stale: later(n.id) >= 2 })))
  };
}

/* ---------- calls ---------- */

/** Someone's working day, the same every time for the same address and day: two or three calls and lunch. */
function workday(email: string, day: Date): Interval[] {
  let h = 7;
  for (const c of `${email}${day.toDateString()}`) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  const roll = (sides: number) => { h = (h * 16807) % 2147483647; return h % sides; };
  const at = (half: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, half * 30).toISOString();
  const lunch = 6 + roll(3);
  const blocks: Interval[] = [{ from: at(lunch), to: at(lunch + 2) }];
  for (let i = 0, n = 2 + roll(2); i < n; i++) { const from = roll(14); blocks.push({ from: at(from), to: at(from + 1 + roll(2)) }); }
  return blocks;
}
function busyFor(w: World, emails: string[], range: { from: string; to: string }): Busy {
  const days: Date[] = [];
  for (let d = new Date(range.from); d.getTime() <= Date.parse(range.to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d);
  const inside = (i: Interval) => i.to > range.from && i.from < range.to;
  const mine: Interval[] = [...w.meetings.filter((m) => m.status !== 'ended').map((m) => ({ from: m.startsAt, to: m.endsAt })), ...w.calendar.events.map((e) => ({ from: e.startsAt, to: e.endsAt }))];
  const domain = w.session?.user.email.split('@')[1] ?? '';
  // With no calendar connected (or Google's access withdrawn) your own calls are all that's known, as the server says.
  if (w.calendar.source === 'none' || w.calendar.needsAccess) {
    return { source: 'none', you: w.meetings.filter((m) => m.status !== 'ended').map((m) => ({ from: m.startsAt, to: m.endsAt })).filter(inside), people: emails.map((email) => ({ email, busy: null })) };
  }
  return {
    source: 'sample',
    you: mine.filter(inside),
    people: emails.map((email) => ({ email, busy: email.endsWith(`@${domain}`) ? days.flatMap((d) => workday(email, d)).filter(inside) : null }))
  };
}
function cardOf(w: World, code: string): CallCard {
  const m = byCode(w, code);
  if (!m) throw refused('not-found', 'That call link doesn’t lead anywhere.');
  return {
    title: m.title, organizerName: m.organizer.name, startsAt: m.startsAt, hostHere: !m.isOrganizer || m.status === 'live', standIn: null, locked: false, notes: m.notes,
    choices: m.choices, joinMuted: m.joinMuted, offer: m.offer ? { times: m.offer.times, minutes: Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000) } : null,
    capture: null, ended: m.status === 'ended', you: 'invited', signInForNotes: ['google']
  };
}
/** What the link says as the call stands: the call's script and the call itself say who's there (script.ts). */
const doorOf = (w: World, code: string): CallCard => {
  const m = byCode(w, code);
  return m ? atTheDoor(cardOf(w, code), m) : cardOf(w, code);
};
function documentsFor(w: World, ids: string[] | undefined): CallDocument[] {
  const all = w.documents.workspaces.flatMap((s) => s.documents);
  return (ids ?? []).flatMap((id) => { const d = all.find((x) => x.id === id); return d ? [{ id, kind: d.kind, by: d.by, name: d.name }] : []; });
}
/**
 * A workspace made for a call, as it's scheduled or its notes are filed: named after it, with you its admin and everyone invited
 * in it to edit. `folder`: the call's folder at its top, holding its note.
 */
function spaceFor(w: World, call: { title: string; at: string; people: number }, folder?: { name: string; noteId: string } | undefined): string {
  const id = nextId('ws');
  const now = new Date().toISOString();
  const items: WorkspaceItem[] = folder ? [{
    id: nextId('folder').padEnd(22, '0'), kind: 'folder', name: folder.name, parent: null, by: null, createdAt: now, editedAt: now, trashedAt: null, trashedBy: null,
    restricted: false, role: 'edit', call: { startedAt: call.at, on: false, here: false, noteId: folder.noteId }
  }] : [];
  w.workspaces.push({ id, name: call.title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled', role: 'admin', people: call.people, items, createdAt: now, call: { title: call.title, at: call.at } });
  return id;
}
/** What a call's folder is called: the call, and the day it started, 'Design review · 4 Nov'. */
const folderName = (title: string, at: string) => `${title} · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(at))}`;

function meetingFrom(w: World, input: MeetingCreate): Meeting {
  const id = nextId('m');
  const guests = input.guests.map(personAt);
  const startsAt = input.offer?.[0] ?? input.startsAt;
  const repeat = input.repeat ? { rule: input.repeat.rule, until: input.repeat.until, timeZone: input.repeat.timeZone } : undefined;
  // One of yours you can edit in, or a new one made now, or none until someone picks one in the call.
  const picked = input.workspaceId ? w.workspaces.find((x) => x.id === input.workspaceId && (x.role === 'admin' || x.role === 'edit')) : undefined;
  if (input.workspaceId && !picked) throw refused('not-found', 'That workspace isn’t there, or you can’t make things in it.');
  const workspaceId = picked ? picked.id : input.newWorkspace ? spaceFor(w, { title: input.title, at: startsAt, people: guests.length + 1 }) : null;
  return {
    id, title: input.title, startsAt, endsAt: addMinutes(startsAt, input.durationMinutes), organizer: me(), isOrganizer: true, guests, guestCount: guests.length,
    notes: input.notes, choices: input.choices ?? DEFAULT_NOTES_CHOICES, code: newCode(), status: 'scheduled', instant: false, joinMuted: input.joinMuted ?? false,
    documents: documentsFor(w, input.documents), workspaceId, rsvps: { yes: 0, maybe: 0, no: 0, waiting: guests.length }, rsvp: null,
    ...(input.offer ? { offer: { times: input.offer } } : { calendarUrl: `https://calendar.example.com/events/${id}` }),
    ...(repeat ? { repeat, seriesId: nextId('series'), seriesCode: newCode() } : {})
  };
}

/** Everything ringing you, as one tab's stream has it: a ring nobody answers leaves by itself when it runs out. */
class Rings extends Pushed<IncomingRing[]> {
  constructor(rings: IncomingRing[]) {
    super(rings);
    for (const r of rings) this.runsOut(r);
  }
  ring(r: IncomingRing): void {
    this.update((rs) => [...rs.filter((x) => x.id !== r.id), r]);
    this.runsOut(r);
  }
  private runsOut(r: IncomingRing): void {
    this.after(Math.max(0, Date.parse(r.expiresAt) - Date.now()), () => this.update((rs) => rs.filter((x) => x.id !== r.id || x.expiresAt !== r.expiresAt)));
  }
}
const ringing = new Set<Rings>();
/** Someone rings you while the story is open: the card drops in on whatever page is open. */
export function ringYou(r: IncomingRing): void {
  const w = current();
  w.rings = [...w.rings.filter((x) => x.id !== r.id), r];
  for (const store of ringing) store.ring(structuredClone(r));
}
const calls = new Set<ScriptedCall>();
const recordings = new Set<ScriptedRecording>();
const moves = new Set<ScriptedMove>();
/** Whatever the last story left open stops: its calls, its recordings, its rings, a move on its way. */
export function stopLive(): void {
  for (const c of calls) c.close();
  calls.clear();
  for (const r of recordings) r.forget();
  recordings.clear();
  for (const r of ringing) r.close();
  ringing.clear();
  for (const m of moves) m.close();
  moves.clear();
}

/* ---------- what the API runs on ---------- */

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
/** As a deployment inside a TEE answers: bound to this browser's nonce, so the app reports receipt of hosting hardware evidence. */
async function attest(nonce: string) {
  const commit = 'storybook';
  const reportData = hex(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(`alcove-attestation/v1\n${nonce}\n${commit}`)));
  return answer(() => ({ tee: 'dstack' as const, nonce, build: { commit }, reportData, quote: 'storybook', eventLog: '[]', appId: 'storybook', instanceId: 'storybook' }), 'anyone');
}

/* ---------- the stand-in ---------- */

export const standIn: AlcoveApi = {
  auth: {
    getSession: () => answer((w) => w.session, 'anyone'),
    // No provider in Storybook: the button previews waiting/cancellation; return pages have their own stories.
    signInUrl: (_provider, opts) => opts?.popup ? 'about:blank' : '#signing-in-with-google',
    signIn: (provider: DemoProvider, opts) => answer((w): SignInResult => {
      const email = provider === 'sso' ? opts?.email?.trim().toLowerCase() : undefined;
      const s = sessionFor(email ? { user: personAt(email), ownerId: `o-${email}`, provider: 'sso', sample: true } : { provider: 'microsoft', sample: true });
      w.session = s;
      return { session: s, isNew: w.notes.length === 0 };
    }, 'anyone'),
    signOut: () => answer((w) => { w.session = null; })
  },
  account: {
    preferences: () => answer((w) => w.prefs),
    updatePreferences: (patch: Patch<Preferences>) => answer((w) => {
      const p = w.prefs;
      w.prefs = {
        notesDefault: patch.notesDefault ?? p.notesDefault, notesLanguage: patch.notesLanguage ?? p.notesLanguage,
        addToCalendar: patch.addToCalendar ?? p.addToCalendar, showOtherMeetings: patch.showOtherMeetings ?? p.showOtherMeetings, recordOffline: patch.recordOffline ?? p.recordOffline,
        sounds: patch.sounds ?? p.sounds, notifications: patch.notifications ?? p.notifications, pinned: patch.pinned ?? p.pinned, groups: patch.groups ?? p.groups, model: patch.model === undefined ? p.model : patch.model
      };
      return w.prefs;
    }),
    delete: () => answer((w) => { forgetAgents(w); w.session = null; w.notes = []; w.meetings = []; })
  },
  drive: {
    get: () => answer((w) => w.drive.settings),
    connect: () => answer(() => ({ url: new URL('#google-drive-consent', location.href).href })),
    pickFolder: () => answer(() => ({ url: new URL('#google-drive-folder-selection', location.href).href })),
    disconnect: () => answer((w) => { w.drive = disconnectedDrive(); return w.drive.settings; }),
    folders: () => answer((w) => w.drive.folders),
    update: (input) => answer((w) => {
      const next = driveChoice(w, input);
      if (next.enabled && !w.drive.settings.enabled) w.drive.enabledAt = new Date().toISOString();
      w.drive.settings = { ...w.drive.settings, ...next };
      return w.drive.settings;
    }),
    jobs: () => answer((w) => w.drive.jobs),
    forNote: (id) => answer((w) => driveForNote(w, id)),
    setForNote: (id, input) => answer((w) => {
      noteIn(w, id);
      if (input === null) delete w.drive.overrides[id];
      else {
        const choice = driveChoice(w, input);
        w.drive.overrides[id] = choice;
        if (choice.enabled) uploadNow(w, id, choice.formats);
      }
      return driveForNote(w, id);
    }),
    retry: (id) => answer((w) => {
      const job = w.drive.jobs.find((j) => j.id === id);
      if (!job) throw refused('not-found', 'That export is no longer there.');
      if (w.drive.settings.connection.status !== 'connected') throw refused('conflict', 'Reconnect Google Drive first.');
      const [next] = uploadNow(w, job.noteId, [job.format]);
      return next ?? job;
    })
  },
  agents: {
    list: () => answer((w) => agentsFor(w).connections.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))),
    endpoint: () => answer(() => ({ endpoint: PREVIEW_MCP_ENDPOINT })),
    createToken: (input) => answer((w) => {
      const parsed = AgentTokenInputSchema.parse(input);
      const held = agentsFor(w);
      const now = Date.now();
      const connection: AgentConnection = {
        id: nextId('agent').padEnd(22, '_'), name: parsed.name, kind: 'token', scopes: parsed.scopes,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + parsed.expiresInDays * 86_400_000).toISOString(), lastUsedAt: null
      };
      held.save([...held.connections, connection]);
      return { connection, token: PREVIEW_AGENT_TOKEN, endpoint: PREVIEW_MCP_ENDPOINT };
    }),
    revoke: (id) => answer((w) => {
      AgentConnectionIdSchema.parse(id);
      const held = agentsFor(w);
      held.save(held.connections.filter((connection) => connection.id !== id));
    }),
    authorization: (requestId) => answer((w) => {
      AgentAuthorizationIdSchema.parse(requestId);
      if (requestId === EXPIRED_AGENT_REQUEST) throw refused('not-found', 'This connection request has expired.');
      if (!w.session) throw new AlcoveApiError('unauthenticated', 'Sign in to Alcove first.');
      return { ownerId: w.session.ownerId, accountEmail: w.session.user.email, clientName: 'Workspace assistant', scopes: ['notes:read', 'meetings:read', 'calendar:read'], expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    }),
    decide: (requestId, decision) => answer((w) => {
      AgentAuthorizationIdSchema.parse(requestId);
      if (requestId === EXPIRED_AGENT_REQUEST) throw refused('not-found', 'This connection request has expired.');
      if (decision.ownerId !== w.session?.ownerId) throw refused('conflict', 'Your account changed. Review this connection again.');
      // Story accounts have descriptive IDs, so compare those directly while parsing the actual permission choices.
      const allow = AgentDecisionInputSchema.shape.allow.parse(decision.allow);
      const scopes = AgentDecisionInputSchema.shape.scopes.parse(decision.scopes);
      const requested = new Set(['notes:read', 'meetings:read', 'calendar:read']);
      if (scopes.some((scope) => !requested.has(scope)) || new Set(scopes).size !== scopes.length || (allow && !scopes.length)) throw refused('invalid', 'Choose only permissions this agent requested.');
      return { redirectUrl: `https://agent.example/callback?${allow ? 'code=storybook-preview' : 'error=access_denied'}` };
    })
  },
  people: {
    search: (query: string) => answer((w) => {
      const q = query.trim().toLowerCase();
      const pool = [...(w.team?.members ?? []).map((m) => ({ person: m.person, source: 'team' as const, onAlcove: m.onAlcove })),
        ...w.notes.flatMap((n) => n.people).filter((p, i, all) => p.email !== me().email && all.findIndex((o) => o.email === p.email) === i && !w.team?.members.some((m) => m.person.email === p.email))
          .map((person) => ({ person, source: 'met' as const, onAlcove: false }))];
      const hits = pool.filter((s) => !q || s.person.name.toLowerCase().includes(q) || s.person.email.includes(q)).slice(0, 8);
      const typed = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q) && !hits.some((h) => h.person.email === q) ? [{ person: personAt(q), source: 'new' as const, onAlcove: false }] : [];
      return [...typed, ...hits].slice(0, 8);
    }),
    team: () => answer((w) => w.team),
    inviteToTeam: (emails: string[]) => answer((w) => {
      if (!w.team) throw refused('invalid', 'You don’t have a team.');
      const asked = emails.map((e) => e.trim().toLowerCase());
      w.team = { ...w.team, members: w.team.members.map((m) => (asked.includes(m.person.email) ? { ...m, invited: true } : m)) };
      return w.team;
    })
  },
  meetings: {
    upcoming: () => answer((w) => w.meetings.filter((m) => m.status !== 'ended' && (Date.parse(m.endsAt) > Date.now() || m.status === 'live' || !!m.offer)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))),
    past: () => answer((w) => w.meetings.filter((m) => m.status === 'ended').sort((a, b) => b.startsAt.localeCompare(a.startsAt))),
    get: (id: ID) => answer((w) => meetingIn(w, id)),
    byCode: (code: string) => answer((w) => byCode(w, code) ?? null),
    create: (input: MeetingCreate) => answer((w) => { const m = meetingFrom(w, input); w.meetings.push(m); return m; }),
    /**
     * An ended call's notes, filed by its organizer when it had no workspace: in one of theirs they can edit in, or a new one.
     * The call's folder goes at the top, holding its note, and the workspace is the call's, and its series' later calls'.
     */
    file: (id: ID, to: FileNotes) => answer((w) => {
      const m = meetingIn(w, id);
      if (!m.isOrganizer) throw refused('not-found', 'That meeting isn’t there.');
      if (m.status !== 'ended') throw refused('conflict', 'This call isn’t over yet.');
      const noteId = m.noteId ?? w.notes.find((n) => n.meetingId === id)?.id;
      if (!noteId) throw refused('conflict', 'This call has no notes to file.');
      if (m.workspaceId && w.workspaces.some((x) => x.id === m.workspaceId)) throw refused('conflict', 'These notes are in a workspace already.');
      const folder = { name: folderName(m.title, m.startsAt), noteId };
      let workspaceId: string;
      if ('workspaceId' in to) {
        const there = w.workspaces.find((x) => x.id === to.workspaceId && (x.role === 'admin' || x.role === 'edit'));
        if (!there) throw refused('not-found', 'That workspace isn’t there, or you can’t make things in it.');
        const now = new Date().toISOString();
        there.items = [{
          id: nextId('folder').padEnd(22, '0'), kind: 'folder', name: folder.name, parent: null, by: null, createdAt: now, editedAt: now, trashedAt: null, trashedBy: null,
          restricted: false, role: 'edit', call: { startedAt: m.startsAt, on: false, here: false, noteId }
        }, ...there.items];
        workspaceId = there.id;
      } else workspaceId = spaceFor(w, { title: m.title, at: m.startsAt, people: m.guests.length + 1 }, folder);
      const next: Meeting = { ...m, workspaceId };
      w.meetings = w.meetings.map((x) => (x.id === id || (m.seriesId && x.seriesId === m.seriesId && x.startsAt > m.startsAt) ? { ...x, workspaceId } : x));
      return next;
    }),
    update: (id: ID, input: Patch<MeetingInput>, _opts?: { scope?: ChangeScope | undefined }) => answer((w) => {
      const m = meetingIn(w, id);
      const startsAt = input.startsAt ?? m.startsAt;
      const minutes = input.durationMinutes ?? Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000);
      const guests = input.guests ? input.guests.map(personAt) : m.guests;
      const next: Meeting = {
        ...m, title: input.title ?? m.title, startsAt, endsAt: addMinutes(startsAt, minutes), guests, guestCount: guests.length, notes: input.notes ?? m.notes,
        choices: input.choices ?? m.choices, joinMuted: input.joinMuted ?? m.joinMuted, documents: input.documents ? documentsFor(w, input.documents) : m.documents
      };
      w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
      return next;
    }),
    cancel: (id: ID) => answer((w) => { meetingIn(w, id); w.meetings = w.meetings.filter((m) => m.id !== id); }),
    answer: (id: ID, rsvp: Rsvp) => answer((w) => {
      const m = meetingIn(w, id);
      const next = { ...m, rsvp };
      w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
      return next;
    }),
    scheduleNext: (id: ID, startsAt: string) => answer((w) => {
      const m = meetingIn(w, id);
      const seriesId = m.seriesId ?? nextId('series');
      const next: Meeting = { ...m, id: nextId('m'), code: newCode(), startsAt, endsAt: addMinutes(startsAt, (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000), status: 'scheduled', seriesId, rsvp: null };
      w.meetings = [...w.meetings.map((x) => (x.id === id ? { ...x, seriesId } : x)), next];
      w.notes = w.notes.map((n) => (n.meetingId === id ? { ...n, seriesId } : n));
      return next;
    })
  },
  calendar: {
    get: () => answer((w) => ({ ...w.calendar, events: w.calendar.events.filter((e) => Date.parse(e.endsAt) > Date.now()) })),
    busy: (emails: string[], range) => answer((w) => busyFor(w, emails, range)),
    connectUrl: () => '#connecting-google-calendar',
    disconnect: () => answer((w) => { w.calendar = { source: 'google', needsAccess: true, events: [] }; return w.calendar; }),
    adopt: (eventId: ID, notes) => answer((w) => {
      const e = w.calendar.events.find((x) => x.id === eventId);
      if (!e) throw refused('not-found', 'That event isn’t on your calendar any more.');
      const m = meetingFrom(w, { title: e.title, startsAt: e.startsAt, durationMinutes: (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60_000, guests: e.guests.map((g) => g.email), notes: notes ?? w.prefs.notesDefault });
      w.meetings.push(m);
      w.calendar = { ...w.calendar, events: w.calendar.events.filter((x) => x.id !== eventId) };
      return m;
    })
  },
  calls: {
    // As the server makes one: an hour from now, and scheduled until someone joins, so the lobby can ring people.
    startNow: (input?: InstantCallInput) => answer((w) => {
      const m = { ...meetingFrom(w, { title: input?.title ?? `${me().name.split(' ')[0] ?? 'Your'}’s call`, startsAt: new Date().toISOString(), durationMinutes: 60, guests: input?.guests ?? [], notes: input?.notes ?? w.prefs.notesDefault, documents: input?.documents ?? [] }), instant: true };
      w.meetings.push(m);
      return { code: m.code };
    }),
    card: (code: string) => answer((w) => doorOf(w, code), 'anyone'),
    pick: (code: string, at: string) => answer((w) => {
      const m = byCode(w, code);
      if (!m?.offer) throw refused('conflict', 'Someone has picked a time already.');
      const { offer: _offer, ...settled } = { ...m, startsAt: at, endsAt: addMinutes(at, (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000) };
      w.meetings = w.meetings.map((x) => (x.id === m.id ? settled : x));
      return doorOf(w, code);
    }, 'anyone'),
    series: (code: string) => answer((w) => { const m = byCode(w, code); return m?.seriesId && w.notes.some((n) => n.seriesId === m.seriesId) ? seriesIn(w, m.seriesId) : null; }),
    join: async (code: string, opts: { name?: string | undefined }): Promise<CallSession> => {
      const m = await answer((w) => {
        const found = byCode(w, code);
        if (!found) throw refused('not-found', 'That call link doesn’t lead anywhere.');
        if (found.status === 'ended') throw refused('conflict', 'This call has ended.');
        return found;
      }, 'anyone');
      const live = joinCall(m, opts);
      calls.add(live);
      current().meetings = current().meetings.map((x) => (x.id === m.id ? { ...x, status: 'live' } : x));
      return live;
    },
    openMove: (): Promise<CallMoveIn> => Promise.reject(refused('not-found', 'That link has run out or was used. Make a new one on the other device.')),
    // The move this browser holds the claim to, if the world has one (`move`): the other device's side isn't here.
    resumeMove: async (claim: string): Promise<CallMoveIn> => {
      const spec = await answer((w) => {
        if (w.move?.claim !== claim) throw refused('not-found', 'That move isn’t there any more. Make a new one on the other device.');
        return w.move;
      }, 'anyone');
      const move = new ScriptedMove(spec);
      moves.add(move);
      return move;
    }
  },
  rings: {
    live: () => {
      const store = new Rings(structuredClone(current().rings.filter((r) => Date.parse(r.expiresAt) > Date.now())));
      ringing.add(store);
      return store;
    },
    answer: (id: ID, _reply: RingReply) => answer((w) => {
      if (!w.rings.some((r) => r.id === id)) throw refused('not-found', 'That ring is over.');
      w.rings = w.rings.filter((r) => r.id !== id);
      for (const r of ringing) r.update((rs) => rs.filter((x) => x.id !== id));
    })
  },
  documents: { list: () => answer((w) => w.documents) },
  recordings: {
    start: async (input?: RoomRecordingInput): Promise<RoomRecording> => {
      await answer(() => null);
      const recording = new ScriptedRecording(input ?? {});
      recordings.add(recording);
      return recording;
    }
  },
  notes: {
    list: (query) => answer((w) => found(w, query?.kind, query?.text)),
    get: (id: ID) => answer((w) => noteIn(w, id)),
    progress: (id: ID): AsyncIterable<NoteProgress> => progressOf(id),
    audioUrl: (id: ID, segment: number) => {
      const seconds = current().notes.find((n) => n.id === id)?.audio.find((a) => a.index === segment)?.seconds ?? 60;
      return audioUrlFor(`${id}:${segment}`, seconds);
    },
    audio: (id: ID, segment: number) => answer((w) => noteIn(w, id).audio.find((a) => a.index === segment)?.seconds ?? 60).then(quietAudio),
    // The stand-in keeps no video of a share: it answers with silence as long as the share's part of the recording, which
    // the replay loads, goes along and plays in step as it would a video, on a dark stage with no picture.
    screenVideoUrl: (id: ID, share: ID, segment: number) => {
      const part = current().notes.find((n) => n.id === id)?.shares.find((s) => s.id === share)?.segments.find((g) => g.segment === segment);
      return audioUrlFor(`${id}:${share}:${segment}`, part ? part.until - part.at : 60);
    },
    screenUrl: (id: ID, frameId: ID) => screenImage(current().notes.find((n) => n.id === id)?.screens.find((s) => s.id === frameId)),
    proposeDecision: (noteId: ID, p: DecisionProposal) => changeNote(noteId, (n) => ({
      ...n, decisions: [...n.decisions, { id: nextId('d'), text: p.text, state: 'proposed', lines: p.lines ?? [], against: [], disputes: [], changes: [changeBy(n, 'proposed')], evidence: { moments: [], flags: p.lines?.length ? [] : ['missing'] } }]
    })),
    proposeAction: (noteId: ID, p: ActionProposal) => changeNote(noteId, (n) => {
      const owner = p.owner ? personAt(p.owner) : undefined;
      return {
        ...n, totalActions: n.totalActions + 1, openActions: n.openActions + 1,
        actions: [...n.actions, {
          ...ACCEPTED_FOLLOW_UP, revision: nextId('revision'), id: nextId('a'), text: p.text, ...(owner ? { owner: { name: owner.name, person: owner } } : {}), takenOn: false, ...(p.due ? { due: p.due } : {}),
          done: false, lines: p.lines ?? [], against: [], changes: [changeBy(n, 'proposed')], from: null, evidence: { moments: [], flags: p.lines?.length ? [] : ['missing'] }
        }]
      };
    }),
    reviewAction: (noteId: ID, review: FollowUpReview) => changeNote(noteId, (n, w) => {
      let history = reviewedActions.get(w);
      if (!history) { history = new Map(); reviewedActions.set(w, history); }
      const key = `${noteId}:${review.id}`;
      const previous = history.get(key);
      if (previous) {
        if (previous.revision === review.revision && previous.decision === review.decision) return n;
        throw refused('conflict', 'That suggestion has already been reviewed.');
      }
      const room = n.rooms.find((r) => r.suggestions.some((a) => a.id === review.id));
      const suggestions = room?.suggestions ?? n.suggestions;
      const actions = room?.actions ?? n.actions;
      const proposal = suggestions.find((a) => a.id === review.id);
      if (!proposal || proposal.revision !== review.revision) throw refused('conflict', 'That suggestion changed. Close review and open it again.');
      const target = proposal.target;
      const actual = target ? actions.find((a) => a.id === target.id) : undefined;
      if (target && (!actual || JSON.stringify(taskTarget(actual)) !== JSON.stringify(target))) throw refused('conflict', 'That follow-up changed. Close review and open it again.');
      const pending = suggestions.filter((a) => a.id !== review.id);
      const accepted: NoteAction = { ...proposal, ...ACCEPTED_FOLLOW_UP, id: target?.id ?? proposal.id, revision: nextId('revision'), takenOn: false, done: actual?.done ?? false, reviewed: { by: changer(me(), roleIn(n)), at: new Date().toISOString(), decision: review.decision }, changes: [...proposal.changes, changeBy(n, 'accepted')] };
      const next = review.decision === 'dismiss' ? actions : target ? actions.map((a) => a.id === target.id ? accepted : a) : [...actions, accepted];
      history.set(key, review);
      return {
        ...n,
        ...(room ? { rooms: n.rooms.map((r) => r.id === room.id ? { ...r, actions: next, suggestions: pending } : r) } : { actions: next, suggestions: pending }),
        ...(!room ? { totalActions: next.length, openActions: next.filter((a) => !a.done).length } : {})
      };
    }),
    updateDecision: (noteId: ID, decisionId: ID, p: DecisionPatch) => changeNote(noteId, (n) => ({
      ...n, decisions: n.decisions.map((d) => {
        if (d.id !== decisionId) return d;
        const state = p.state ?? (p.text !== undefined && d.state === 'confirmed' ? 'proposed' : d.state);
        const changes = [...d.changes, ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: d.text, after: p.text })] : []), ...(p.state ? [changeBy(n, p.state)] : []),
          ...(p.dispute !== undefined ? [changeBy(n, p.dispute ? 'disputed' : 'undisputed')] : [])];
        const disputes = p.dispute === true ? [...d.disputes, { by: changer(me(), roleIn(n)), at: new Date().toISOString() }] : p.dispute === false ? d.disputes.filter((x) => x.by.email !== me().email) : d.disputes;
        return { ...d, text: p.text ?? d.text, state, changes, disputes };
      })
    })),
    updateAction: (noteId: ID, actionId: ID, p: ActionPatch) => changeNote(noteId, (n) => {
      const actions = n.actions.map((a) => {
        if (a.id !== actionId) return a;
        const owner = p.owner === null ? undefined : p.owner ? personAt(p.owner) : a.owner?.person;
        const changes = [...a.changes, ...(p.takeOn ? [changeBy(n, 'took-on')] : []), ...(p.done !== undefined ? [changeBy(n, p.done ? 'done' : 'undone')] : []),
          ...(p.owner !== undefined ? [changeBy(n, p.owner === null ? 'declined' : 'reassigned')] : []), ...(p.due !== undefined ? [changeBy(n, 'due', { after: p.due ?? '' })] : []),
          ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: a.text, after: p.text })] : [])];
        const { owner: _was, due: _due, ...rest } = a;
        const due = p.due === null ? undefined : p.due ?? a.due;
        return {
          ...rest, revision: nextId('revision'), text: p.text ?? a.text, done: p.done ?? a.done, takenOn: p.takeOn ? true : p.owner !== undefined || (a.owner?.person?.email !== me().email && (p.text !== undefined || p.due !== undefined)) ? false : a.takenOn,
          ...(owner ? { owner: { name: owner.name, person: owner } } : {}), ...(due ? { due } : {}), changes
        };
      });
      return { ...n, actions, openActions: actions.filter((a) => !a.done).length };
    }),
    updateQuestion: (noteId: ID, questionId: ID, p: QuestionPatch) => changeNote(noteId, (n) => ({
      ...n, questions: n.questions.map((q) => (q.id !== questionId ? q : {
        ...q, text: p.text ?? q.text, state: p.state ?? q.state,
        changes: [...q.changes, ...(p.state ? [changeBy(n, p.state === 'answered' ? 'answered' : 'reopened')] : []), ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: q.text, after: p.text })] : [])]
      }))
    })),
    updateRevisit: (noteId: ID) => answer((w) => noteIn(w, noteId)),
    inbox: () => answer(inboxOf),
    correctLine: (noteId: ID, lineId: ID, p: LinePatch) => changeNote(noteId, (n) => ({
      ...n, transcript: n.transcript?.map((l) => {
        if (l.id !== lineId) return l;
        const speaker = p.speaker === null ? undefined : p.speaker ? n.people.find((x) => x.id === p.speaker) : l.speaker?.person;
        const { unsure: _unsure, speaker: _speaker, ...rest } = l;
        return {
          ...rest, text: p.text ?? l.text, ...(speaker ? { speaker: { name: speaker.name, person: speaker } } : {}),
          changes: [...(l.changes ?? []), changeBy(n, p.confirm ? 'confirmed' : p.text !== undefined ? 'reworded' : 'reassigned', p.text !== undefined ? { before: l.text, after: p.text } : {})]
        };
      }) ?? null
    })),
    rewrite: (noteId: ID, o?: { model?: string | null | undefined }) => changeNote(noteId, (n, w) => {
      w.writing = {
        id: noteId, seconds: 5,
        written: () => {
          const was = noteIn(current(), noteId);
          return { ...was, writingAgain: false, writtenAt: new Date().toISOString(), model: o?.model === undefined ? was.model : o.model };
        }
      };
      return { ...n, writingAgain: true };
    }),
    cancelRewrite: (noteId: ID) => changeNote(noteId, (n, w) => {
      if (n.status !== 'ready') throw refused('conflict', 'The first notes are still being written.');
      if (w.writing?.id === noteId) w.writing = null;
      return { ...n, writingAgain: false };
    }),
    ask: (noteId: ID, question: string) => stream((w) => asWritten(answerAbout(noteIn(w, noteId), question))),
    askAll: (question: string) => stream((w) => asWritten(answerAcross(w, question))),
    share: (id: ID, to: { emails: string[]; group?: string | undefined }) => changeNote(id, (n) => {
      const at = new Date().toISOString();
      const fresh = to.emails.map(personAt).filter((p) => !n.people.some((x) => x.email === p.email));
      return {
        ...n, people: [...n.people, ...fresh], sharedWith: [...n.sharedWith, ...fresh.map((p) => p.email)],
        recipients: [...n.recipients, ...fresh.map((person) => ({ person, role: 'shared' as const, by: me(), ...(to.group ? { group: to.group } : {}), at }))],
        groupShares: to.group ? [{ by: me(), group: to.group, at }, ...n.groupShares.filter((g) => !(g.by.email === me().email && g.group === to.group))] : n.groupShares
      };
    }),
    personal: (id: ID) => personalFor(id),
    previewAddition: (id: ID, entryId: ID) => answer((w): PromotionPreview => {
      const n = noteIn(w, id);
      const e = (w.personal[id] ?? []).find((x) => x.id === entryId);
      if (!e) throw refused('not-found', 'That isn’t in your notes any more.');
      const text = e.kind === 'note' ? e.text : e.kind === 'bookmark' ? e.label : e.answer;
      const moments = e.kind === 'bookmark' ? (e.moment ? [e.moment] : []) : e.kind === 'answer' ? e.moments : [];
      return { entryId, text, moments, destination: { noteId: id, title: n.title }, audience: n.people, seal: `seal-${entryId}` };
    }),
    addToShared: (id: ID, entryId: ID, body: PromoteBody) => changeNote(id, (n, w) => {
      const e = (w.personal[id] ?? []).find((x) => x.id === entryId);
      const additionId = nextId('x');
      const at = new Date().toISOString();
      const moments = e?.kind === 'bookmark' ? (e.moment ? [e.moment] : []) : e?.kind === 'answer' ? e.moments : [];
      w.personal[id] = (w.personal[id] ?? []).map((x) => (x.id === entryId ? { ...x, shared: { additionId, at } } : x));
      return { ...n, additions: [...n.additions, { id: additionId, text: body.text, by: me(), at, moments, removable: true }] };
    }),
    links: (id: ID) => answer((w) => { noteIn(w, id); return linksTo(w, id); }),
    createLink: (id: ID) => answer((w): NewNoteLink => {
      const n = noteIn(w, id);
      if (n.status === 'recording') throw refused('invalid', 'These notes can be shared once the call ends.');
      const at = new Date();
      const link: NoteLink = { id: nextId('link'), by: me(), at: at.toISOString(), expiresAt: new Date(at.getTime() + NOTE_LINK_DAYS * 86_400_000).toISOString(), revocable: true };
      // 22 letters and digits, as a real secret is, and made up: it opens nothing outside Storybook.
      const secret = `Vandelay${String(Date.now()).slice(-6)}${link.id.replace(/\D/g, '').padStart(8, '0')}`.slice(0, 22).padEnd(22, '0');
      w.noteLinks = [...(w.noteLinks ?? []), { link, noteId: id, secret }];
      return { link, secret };
    }),
    revokeLink: (id: ID, linkId: ID) => answer((w) => {
      noteIn(w, id);
      w.noteLinks = (w.noteLinks ?? []).filter((x) => x.link.id !== linkId);
      return linksTo(w, id);
    }),
    claimLink: (secret: string) => answer((w): NoteLinkClaimed => {
      const found = (w.noteLinks ?? []).find((x) => x.secret === secret && Date.parse(x.link.expiresAt) > Date.now());
      if (!found) throw refused('not-found', 'This link has run out or been revoked. Ask whoever sent it for a new one.');
      // Notes you don't have yet join yours, as shared by whoever made the link.
      if (found.note && !w.notes.some((n) => n.id === found.noteId)) w.notes = [found.note, ...w.notes];
      return { noteId: found.noteId };
    }),
    sharedAudience: (id: ID) => answer((w): SharedAudience => {
      const n = noteIn(w, id);
      if (n.status !== 'ready') throw refused('conflict', 'These notes are still being written. You can add this once they are.');
      return { audience: n.people, seal: audienceSeal(n) };
    }),
    writeShared: (id: ID, body: SharedWrite) => changeNote(id, (n) => {
      if (n.status !== 'ready') throw refused('conflict', 'These notes are still being written. You can add this once they are.');
      if (body.seal !== audienceSeal(n)) throw refused('conflict', 'Someone got these notes since you started writing. Look at who reads it now, then post it.');
      return { ...n, additions: [...n.additions, { id: nextId('x'), text: body.text, by: me(), at: new Date().toISOString(), moments: [], removable: true }] };
    }),
    takeBack: (id: ID, additionId: ID) => changeNote(id, (n, w) => {
      w.personal[id] = (w.personal[id] ?? []).map((x) => (x.shared?.additionId === additionId ? { ...x, shared: null } : x));
      return { ...n, additions: n.additions.filter((a) => a.id !== additionId) };
    }),
    delete: (id: ID) => answer((w) => { noteIn(w, id); w.notes = w.notes.filter((n) => n.id !== id); })
  },
  series: {
    get: (id: ID) => answer((w) => seriesIn(w, id)),
    ask: (id: ID, question: string): AsyncIterable<SeriesAnswerPart> => stream((w) => {
      const s = seriesIn(w, id);
      const parts = answerAcross({ ...w, notes: w.notes.filter((n) => n.seriesId === id) }, question);
      return parts.flatMap((p): SeriesAnswerPart[] => {
        if (p.type === 'text') return [p];
        if (p.type !== 'cite') return [];
        const n = s.notes.find((x) => x.id === p.noteId);
        return n ? [{ type: 'source', noteId: n.id, title: n.title, startedAt: n.startedAt, at: p.at }] : [];
      });
    })
  },
  workspaces: {
    list: () => answer(spaces.workspaceList),
    create: (name: string) => answer((w) => {
      const id = nextId('ws');
      w.workspaces.push({ id, name, role: 'admin', people: 1, items: [], createdAt: new Date().toISOString(), call: null });
      return { id };
    }),
    get: (id: ID) => answer(() => spaces.treeFor(id)),
    presenterNotes: {
      frames: (_id: ID, boardId: ID) => answer(() => ({ frames: spaces.presenterFrameNotes(boardId) })),
      setFrame: (_id: ID, boardId: ID, frame: string, text: string) => answer(() => { spaces.keepFrameNotes(boardId, frame, text); })
    },
    media: {
      upload: async (id: ID, documentId: ID, file: File, o) => { await answer(() => null); return spaces.upload(id, documentId, file, o); },
      // A `download` needs nothing more here: the URL is this page's own, so the link the app follows saves it under its name.
      url: async (id: ID, documentId: ID, mediaId: ID) => { await answer(() => null); return spaces.urlOf(id, documentId, mediaId); },
      picture: async (id: ID, documentId: ID, mediaId: ID, o) => { await answer(() => null); return spaces.pictureOf(id, documentId, mediaId, o); },
      preview: async (id: ID, documentId: ID, mediaId: ID, o) => { await answer(() => null); return spaces.previewOf(id, documentId, mediaId, o); },
      attach: (id: ID, documentId: ID, mediaId: ID) => answer(() => spaces.attach(id, documentId, mediaId)),
      list: (id: ID) => answer(() => spaces.mediaIn(id)),
      remove: (id: ID, documentId: ID, mediaId: ID, o) => answer(() => spaces.removeMedia(id, documentId, mediaId, o))
    },
    ask: (_id: ID, _documentId: ID, body: DocAskBody) => (async function* (): AsyncIterable<DocAskPart> {
      if (body.action === 'checklist') { for (const line of body.text.split(/[.\n]+/).map((x) => x.trim()).filter(Boolean)) yield { type: 'todo', text: line }; return; }
      yield { type: 'text', text: body.text.split(/(?<=\.)\s/)[0] ?? body.text };
    })(),
    /**
     * Sorts stickies the way the notes model might: the canvas's ideas into the canvas's three themes, and anything else by its
     * first word, those that start with the same word one theme, named for it.
     */
    sortStickies: (_id: ID, _documentId: ID, body: BoardSortBody) => answer(() => {
      const themes = new Map<string, string[]>();
      for (const s of body.stickies) {
        const word = s.text.trim().split(/\s+/)[0] ?? '';
        const name = canvasTheme(s.text) ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        themes.set(name, [...(themes.get(name) ?? []), s.id]);
      }
      return { themes: [...themes].map(([name, ids]) => ({ name, ids })) };
    }),
    rename: (id: ID, name: string) => answer(() => { spaces.treeOf(id).name = name; }),
    remove: (id: ID) => answer(() => spaces.removeWorkspace(id)),
    people: (id: ID) => answer(() => spaces.peopleIn(id)),
    addPerson: (id: ID, email: string, role) => answer(() => spaces.addPerson(id, email, role)),
    setRole: (id: ID) => answer(() => { spaces.treeOf(id); }),
    removePerson: (id: ID) => answer(() => { spaces.treeOf(id); }),
    items: {
      get: (id: ID, itemId: ID) => answer(() => {
        const item = spaces.treeOf(id).items.find((i) => i.id === itemId);
        if (!item) throw refused('not-found', 'That isn’t there, or you can’t open it.');
        return item;
      }),
      create: (id: ID, input) => answer(() => spaces.createItem(id, input)),
      rename: (id: ID, itemId: ID, name: string) => answer(() => spaces.renameItem(id, itemId, name)),
      move: (id: ID, itemId: ID, to) => answer(() => spaces.moveItem(id, itemId, to)),
      duplicate: (id: ID, itemId: ID) => answer(() => spaces.duplicateItem(id, itemId)),
      trash: (id: ID, itemId: ID) => answer(() => spaces.trashItem(id, itemId)),
      restore: (id: ID, itemId: ID) => answer(() => spaces.restoreItem(id, itemId)),
      deleteForever: (id: ID, itemId: ID) => answer(() => spaces.deleteItem(id, itemId))
    },
    share: {
      list: (id: ID, documentId: ID) => answer(() => spaces.shareOf(id, documentId)),
      set: (_id: ID, documentId: ID, to, role) => answer(() => spaces.shareWith(documentId, to, role)),
      remove: (_id: ID, documentId: ID, entryId: ID) => answer(() => spaces.unshare(documentId, entryId)),
      restrict: (id: ID, documentId: ID, restricted: boolean) => answer(() => spaces.restrict(id, documentId, restricted))
    },
    mention: (id: ID, documentId: ID, tag) => answer(() => spaces.mention(id, documentId, tag)),
    ids: (id: ID, emails: string[]) => answer(() => spaces.idsIn(id, emails)),
    mentions: () => answer(() => spaces.mentionsEverywhere()),
    mentionSeen: (_id: ID, mentionId: ID) => answer(() => spaces.seeMention(mentionId)),
    live: (id: ID) => spaces.liveWorkspace(id),
    document: async (id: ID, documentId: ID) => { await answer(() => null); return spaces.openDocument(id, documentId); },
    saveCopy: (id: ID, input) => answer(() => spaces.saveCopy(id, input)),
    versions: (id: ID, documentId: ID) => answer(() => spaces.versionsOf(id, documentId)),
    version: (id: ID, documentId: ID, versionId: ID) => answer(() => spaces.versionOf(id, documentId, versionId)),
    restoreVersion: (id: ID) => answer(() => { spaces.treeOf(id); }),
    searchText: (id: ID) => spaces.searchText(id)
  },
  plans: {
    // The payments playing out catch up with the clock whenever the plan or a payment is read (api/payments.ts).
    plan: () => answer((w) => { settlePayments(w); return w.plan; }),
    offers: () => answer((w) => w.payments.offers),
    buyPro: (months, microUsdPerMonth) => answer((w) => buyNow(w, { kind: 'pro', months, microUsdPerMonth })),
    refundPro: () => answer((w) => {
      const now = Date.now();
      const later = w.plan.pro.months.filter((m) => Date.parse(m.from) > now);
      if (!later.length) throw refused('conflict', 'There’s no month of Pro to refund that hasn’t started. A month that has started isn’t refunded.');
      const back = later.reduce((sum, m) => sum + m.microUsd, 0);
      const { balance } = w.plan;
      const entry = { id: freshEntryId(w), at: new Date(now).toISOString(), label: `Pro refunded, ${later.length} ${later.length === 1 ? 'month' : 'months'}`, microUsd: back };
      const refunded = { ...w.plan, balance: { microUsd: balance.microUsd + back, history: [entry, ...balance.history] } };
      w.plan = withProMonths(refunded, w.plan.pro.months.filter((m) => Date.parse(m.from) <= now), now);
      return w.plan;
    }),
    setRenew: (renew) => answer((w) => { w.plan = { ...w.plan, pro: { ...w.plan.pro, renew } }; return w.plan; }),
    dismissNotice: (id) => answer((w) => {
      if (!w.plan.notices.some((n) => n.id === id)) throw refused('not-found', 'That notice isn’t there any more.');
      w.plan = { ...w.plan, notices: w.plan.notices.filter((n) => n.id !== id) };
      return w.plan;
    }),
    routes: () => answer(paymentRoutes),
    buyHours: (packs, microUsdPerPack) => answer((w) => buyNow(w, { kind: 'hours', packs, microUsdPerPack })),
    startTopUp: (routeId, microUsd, buys) => answer((w) => {
      const choices = paymentRoutes(w);
      StartTopUpBodySchema.parse({ routeId, microUsd, buys: buys ?? null });
      const route = choices.routes.find((r) => r.id === routeId);
      if (!route) throw refused('invalid', 'That way to pay isn’t offered.');
      if (microUsd < Number(route.minimum) * 1_000_000) throw refused('invalid', `The least you can add with ${route.token} on ${route.chainName} is $${route.minimum}.`);
      // What it's for is checked first, as a purchase from the balance is, but for the balance: a refusal opens nothing.
      if (buys) checkPurchase(w, buys);
      // A token is added as a dollar. A payment to buy something is open for a day, as the server's are.
      const amount = String(microUsd / 1_000_000);
      const t: TopUp = {
        id: nextId('sb-top-up'), route, address: buys ? PREVIEW_BASE_ADDRESS : PREVIEW_DEPOSIT_ADDRESS, memo: null,
        expiresAt: new Date(Date.now() + (buys ? 86_400_000 : 3_600_000)).toISOString(), state: 'waiting',
        asked: { amount }, received: null,
        purchase: buys ? { buys, outcome: 'waiting', why: null } : null
      };
      w.payments.topUps.unshift(t);
      playPayment(w, t);
      return t;
    }),
    topUp: (id) => answer((w) => { settlePayments(w); return paymentIn(w, id); }),
    cancelTopUp: (id) => answer((w) => {
      settlePayments(w);
      const t = paymentIn(w, id);
      if (t.state !== 'waiting') throw refused('conflict', 'This top-up can’t be cancelled any more: a payment has already reached it.');
      const cancelled: TopUp = { ...t, state: 'cancelled', address: null, memo: null };
      w.payments.topUps = w.payments.topUps.map((x) => x.id === id ? cancelled : x);
      return cancelled;
    }),
    topUps: () => answer((w) => { paymentRoutes(w); settlePayments(w); return w.payments.topUps; })
  },
  models: { list: () => answer(() => AI_MODELS) },
  trust: { attestation: attest },
  featureFlags: { on: () => answer((w) => w.featureFlags ?? []) },
  diagnostics: { report: () => Promise.resolve() }
};

/** How a note's writing is going: its steps as they're done, and then it's ready, as the note in the world now is. */
async function* progressOf(id: string): AsyncIterable<NoteProgress> {
  const first = await answer((w) => noteIn(w, id));
  const w = current();
  const writing = w.writing?.id === id ? w.writing : null;
  const room = first.kind === 'room';
  const steps = (done: number, ready: boolean): NoteProgress => ({
    noteId: id, title: first.title, ready,
    steps: [
      { label: room ? 'Recording stopped' : 'Call ended', done: done > 0 },
      { label: `${Math.max(1, Math.round(first.duration / 60))} min of audio saved, encrypted`, done: done > 1 },
      { label: first.transcript?.length ? `Transcript of ${first.transcript.length} lines` : 'Nothing was transcribed', done: done > 2 },
      { label: ready ? 'Notes written' : 'Writing the summary, decisions and follow-ups', done: ready }
    ]
  });
  if (!writing) { yield steps(4, first.status === 'ready'); return; }
  const each = (writing.seconds * 1000) / 4;
  for (let done = 1; done <= 3; done++) {
    yield steps(done, false);
    await pause(each);
    if (w.writing !== writing) { yield steps(4, true); return; }
  }
  const written = writing.written();
  w.notes = w.notes.map((n) => (n.id === id ? written : n));
  w.writing = null;
  yield steps(4, true);
}
