/*
 * A call's script: who's in it when you come in, what they say and do and when, how the people you ring answer, and
 * what the call's link says while you wait at the door. The scripted call (call.ts) plays the server's side of it,
 * the scripted room (src/media/livekit.ts) LiveKit's: everyone else's microphones, who's speaking, what they share,
 * and your own connection. A story gives its call a script with `scriptCall` before the call is joined; any other call
 * plays the default one, where everyone invited comes in and talks it through.
 *
 * Times are seconds: in the call, from the moment you joined it (asking to join included); at the door, from when the
 * story opened. Everyone in a script is from the demo world, and everything they say is made up.
 */
import { RING_SECONDS, type CallCard, type CaptureMode, type CapturePart, type CaptureState, type IncomingRing, type Meeting, type Person, type RingReply } from '@alcove/api';
import type { Screen } from '../media/screens';
import type { World } from '../world';
import { current, me } from './state';

/** Something said in the call: by someone in it, or by you (heard through your microphone, while it's on). */
export interface Line {
  who: Person | 'me';
  text: string;
  /** What the live notes take as decided from it. */
  decides?: string | undefined;
  /** A follow-up the live notes take from it: what, whose, and by when, as said. */
  hands?: { text: string; owner?: Person | 'me' | undefined; due?: string | undefined } | undefined;
}

/** Someone in the call as you come in. */
export interface Present {
  who: Person;
  /** They organized it, so they host it. */
  organizer?: boolean | undefined;
  /** They came in with the link, by name, and don't get the notes. */
  guest?: boolean | undefined;
  /** Their microphone is on, unless this says it's off. */
  mic?: boolean | undefined;
  hand?: boolean | undefined;
  /** What they're sharing. */
  sharing?: Screen | undefined;
}

/** A breakout room the organizer opens: its name and who goes to it (you included, as `me`). */
export interface RoomPlan { name: string; people: readonly (Person | 'me')[] }

/** One thing that happens. */
export type Beat =
  | { do: 'join'; who: Person; guest?: boolean | undefined; mic?: boolean | undefined }
  | { do: 'leave'; who: Person }
  | { do: 'say'; line: Line }
  | { do: 'mic'; who: Person; on: boolean }
  | { do: 'hand'; who: Person; up: boolean }
  | { do: 'share'; who: Person; screen: Screen }
  | { do: 'stop-sharing'; who: Person }
  | { do: 'chat'; who: Person; text: string }
  /** Someone asks to join: signed in (their address shows), or by name only. */
  | { do: 'knock'; who: Person; byName?: boolean | undefined }
  | { do: 'ask-for-notes'; who: Person }
  /** The organizer, when it isn't you: notes on, off or paused, or not now to your ask. */
  | { do: 'notes'; mode: 'on' | 'off' | 'paused' }
  | { do: 'not-now' }
  /** The organizer, when it isn't you: rooms open, with a message to every room, and everyone back. */
  | { do: 'rooms'; rooms: readonly RoomPlan[]; minutes: number }
  | { do: 'message-rooms'; text: string }
  | { do: 'close-rooms' }
  /** Whoever hosts: lets you in from asking, turns you away, mutes your microphone, removes you, ends the call. */
  | { do: 'let-in' }
  | { do: 'turn-away' }
  | { do: 'mute-you' }
  | { do: 'remove-you' }
  | { do: 'end' }
  /** Your own connection: it drops and comes back after `seconds`, or drops for good. */
  | { do: 'reconnect'; seconds: number }
  | { do: 'drop' }
  /** The organizer's connection drops (someone invited hosts in their place ten seconds later), and they come back. */
  | { do: 'host-drops' }
  | { do: 'host-back' }
  /** Anything else the story needs at that moment, such as someone ringing you to another call. */
  | { do: 'run'; what: () => void };

export interface Cue { at: number; beat: Beat }

export interface CallScript {
  /** Who's in the call when you come in, besides you. */
  here?: readonly Present[] | undefined;
  /** How long the call has been going when you come in, in seconds. */
  since?: number | undefined;
  /** What was said before you came in: in the transcript already, while notes were on. */
  earlier?: readonly Line[] | undefined;
  /** Notes as you find them: as the call was set up, unless this says otherwise. */
  notes?: 'on' | 'off' | 'paused' | undefined;
  /** The conversation: a line every `every` seconds (4.5 unless it says), from `from` seconds in (2 unless it says). */
  talk?: { lines: readonly Line[]; from?: number | undefined; every?: number | undefined } | undefined;
  /** What happens, when. */
  cues?: readonly Cue[] | undefined;
  /** How the people you ring answer, by address: after how long, and what. Anyone else comes in after a few seconds. */
  answers?: Readonly<Record<string, { after: number; reply: RingReply | 'missed' }>> | undefined;
  /** What the live notes sum up, once anything has been said. */
  summary?: string | undefined;
  /** While you're at the door: the organizer isn't in yet (they come this many seconds after the story opened), someone hosts in their place, or it's locked. */
  door?: { hostArrives?: number | undefined; standIn?: Person | undefined; locked?: boolean | undefined } | undefined;
}

/* ---------- writing a script ---------- */

/** These beats, `seconds` in. */
export const at = (seconds: number, ...beats: Beat[]): Cue[] => beats.map((beat) => ({ at: seconds, beat }));
export const joins = (who: Person, o: { guest?: boolean; mic?: boolean } = {}): Beat => ({ do: 'join', who, ...o });
export const leaves = (who: Person): Beat => ({ do: 'leave', who });
export const says = (who: Person | 'me', text: string, more: Omit<Line, 'who' | 'text'> = {}): Beat => ({ do: 'say', line: { who, text, ...more } });
export const unmutes = (who: Person): Beat => ({ do: 'mic', who, on: true });
export const mutes = (who: Person): Beat => ({ do: 'mic', who, on: false });
export const raisesHand = (who: Person): Beat => ({ do: 'hand', who, up: true });
export const lowersHand = (who: Person): Beat => ({ do: 'hand', who, up: false });
export const shares = (who: Person, screen: Screen): Beat => ({ do: 'share', who, screen });
export const stopsSharing = (who: Person): Beat => ({ do: 'stop-sharing', who });
export const chats = (who: Person, text: string): Beat => ({ do: 'chat', who, text });
export const knocks = (who: Person, o: { byName?: boolean } = {}): Beat => ({ do: 'knock', who, ...o });
export const asksForNotes = (who: Person): Beat => ({ do: 'ask-for-notes', who });
export const run = (what: () => void): Beat => ({ do: 'run', what });

/** A line of the conversation. */
export const line = (who: Person | 'me', text: string, more: Omit<Line, 'who' | 'text'> = {}): Line => ({ who, text, ...more });

/* ---------- the script for each call in the story ---------- */

interface Scripted { script: CallScript; opened: number }
/** Kept with the world, so a story's scripts go when its world does. */
const scripts = new WeakMap<World, Map<string, Scripted>>();
const scriptsHere = (): Map<string, Scripted> => {
  const w = current();
  const known = scripts.get(w);
  if (known) return known;
  const fresh = new Map<string, Scripted>();
  scripts.set(w, fresh);
  return fresh;
};

/** The call with this link plays `script` when it's joined. The door opens now: its times count from here. */
export function scriptCall(code: string, script: CallScript): void {
  scriptsHere().set(code, { script, opened: Date.now() });
}
export const scriptFor = (code: string): CallScript | undefined => scriptsHere().get(code)?.script;

/*
 * What the call's link says while it runs, as the server would keep it: whether someone hosts, who stands in for the
 * organizer, a lock, and what's captured. The scripted call keeps it up to date; the link's card (calls.card) reads it.
 */
export interface LinkState { hostHere: boolean; standIn: Person | null; locked: boolean; capture: CaptureState | null; ended: boolean }
const links = new WeakMap<World, Map<string, LinkState>>();
export function linkState(code: string, change: (now: LinkState | null) => LinkState): void {
  const w = current();
  const all = links.get(w) ?? new Map<string, LinkState>();
  links.set(w, all);
  all.set(code, change(all.get(code) ?? null));
}

export const part = (mode: CaptureMode, since: string | null, by: CapturePart['by']): CapturePart => ({ mode, since, by });
/** What a call captures from the start, as it was set up: notes on (or paused, or off), and shared screens not read. */
export function captureOf(mode: 'on' | 'off' | 'paused', since: string | null, organizer: string): CaptureState {
  const by = since ? { kind: 'schedule' as const, name: organizer } : null;
  const p = part(mode, mode === 'off' ? null : since, mode === 'off' ? null : by);
  return { mode, recording: p, transcript: p, ai: p, screen: part('off', null, null), gaps: [], requests: [], asked: null, room: null, away: false };
}

/** Without names: someone asking to join isn't told who changed what. */
const nameless = (c: CaptureState): CaptureState => {
  const part = (p: CaptureState['recording']) => ({ ...p, by: p.by ? { kind: p.by.kind } : null });
  return { ...c, recording: part(c.recording), transcript: part(c.transcript), ai: part(c.ai), screen: part(c.screen), requests: [], asked: null, room: null, gaps: [] };
};

/**
 * The link's card as the call stands now: whether the organizer is there yet (the script's door, then the call
 * itself), who's hosting in their place, a lock, what's captured, and where the person asking stands.
 */
export function atTheDoor(card: CallCard, m: Meeting): CallCard {
  const w = current();
  const scripted = scripts.get(w)?.get(m.code);
  const live = links.get(w)?.get(m.code);
  const door = scripted?.script.door;
  const arrived = door?.hostArrives === undefined || !scripted ? true : Date.now() - scripted.opened >= door.hostArrives * 1000;
  const standIn = live ? live.standIn : door?.standIn ?? null;
  const invited = m.isOrganizer || m.guests.some((g) => g.email === me().email);
  return {
    ...card,
    hostHere: live ? live.hostHere : scripted ? arrived : card.hostHere,
    standIn: standIn ? { ...(m.isOrganizer ? { name: standIn.name } : {}) } : null,
    locked: live?.locked ?? door?.locked ?? card.locked,
    // A call going on before you're in it (someone hosts it): what it captures, as the script has it.
    capture: live?.capture ? nameless(live.capture) : scripted && (m.status === 'live' || standIn) ? nameless(captureOf(scripted.script.notes ?? m.notes, m.startsAt, m.organizer.name)) : card.capture,
    ended: card.ended || (live?.ended ?? false),
    you: invited && w.session ? 'invited' : w.session ? 'asks' : 'guest'
  };
}

/* ---------- the call nobody scripted ---------- */

const DEFAULT_TALK: readonly [number, string, Omit<Line, 'who' | 'text'>?][] = [
  [1, 'Can everyone see the board? I’ve put the three options side by side.'],
  [0, 'Yes. Let’s start with the empty states, since they block the launch.'],
  [1, 'The team page needs one before the flag goes on. I’d keep it to one line.'],
  [2, 'Agreed. And the arch, not a picture of a person.'],
  [0, 'Then let’s decide it: one line and the empty arch, for every list.', { decides: 'Every list gets one line and the empty arch when it’s empty.' }],
  [1, 'I’ll send the copy for each of them by Friday.', { hands: { text: 'Send the copy for each empty state', due: 'Friday' } }]
];

/**
 * A call joined without a script: everyone invited to a scheduled call comes in, one at a time (a call started just
 * now has nobody until the people rung answer), and they talk the launch through while notes are on.
 */
export function defaultScript(m: Meeting): CallScript {
  const you = me();
  const organizer = m.isOrganizer ? null : m.organizer;
  const others = m.guests.filter((g) => g.email !== you.email);
  const first = organizer ?? others[0];
  const second = organizer ? others[0] : others[1] ?? others[0];
  const whoSays = (k: number): Person | 'me' | undefined => (k === 0 ? 'me' : k === 1 ? first : second);
  return {
    here: organizer ? [{ who: organizer, organizer: true }] : [],
    cues: m.instant ? [] : others.flatMap((p, i) => at(1.5 + i * 1.8, joins(p))),
    // With nobody else coming, nothing is said. A call started just now waits for the people rung.
    talk: first ? {
      from: m.instant ? 12 : 4, every: 5,
      lines: DEFAULT_TALK.flatMap(([k, text, more]) => { const who = whoSays(k); return who ? [line(who, text, more)] : []; })
    } : undefined,
    summary: 'The empty states block the launch, so every list gets one line and the empty arch.'
  };
}

/** A ring for you, from someone in the demo world, to the call with `code`: it lasts as long as a ring does. */
export function ringFrom(from: Person, code: string, title: string, notes: 'on' | 'off' = 'on', seconds = RING_SECONDS): IncomingRing {
  return { id: `ring-${code}`, code, title, from, notes, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
}
