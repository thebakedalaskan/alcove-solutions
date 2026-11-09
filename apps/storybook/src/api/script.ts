import type { CallTimer } from '@alcove/api';
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
import {
  RING_SECONDS, type AiModels, type CallNudgeKind, type CallStatusKind, type CallStatusMinutes, type BoardTemplate, type BoardTimerMinutes, type BoardVotesEach, type BreakoutBoard, type CallCard, type CallReaction, type CallPage, type CaptureMode, type CapturePart, 
  type CaptureState, type LiveFollowUp, type IncomingRing, type Meeting, type Person, type RingReply
} from '@alcove/api';
import type * as Y from 'yjs';
import type { Screen } from '../media/screens';
import type { World } from '../world';
import { current, me } from './state';

/** Something said in the call: by someone in it, or by you (heard through your microphone, while it's on). */
export interface Line {
  id?: string | undefined;
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
  /** What they say they're up to as you come in, for so many minutes from then, or with no time. */
  status?: { kind: CallStatusKind; minutes?: CallStatusMinutes | undefined } | undefined;
  /** What they're sharing. */
  sharing?: Screen | undefined;
}

/** A sticky someone in the call puts on a board: on the frame with this title. */
export interface BoardWork { who: Person; frame: string; text: string }
/**
 * Something the call heard that's worth a sticky, as ideas from the call offer it: who `said` it, so many seconds `ago`, the
 * sticky's words, and the frame it fits, by its title.
 */
export interface HeardIdea { who: Person; said: string; text: string; frame?: string | undefined; ago?: number | undefined }

/**
 * A breakout room the organizer opens: its name, who goes to it (you included, as `me`), and what the people in it put on its
 * board, a sticky every few seconds, when it has one.
 */
export interface RoomPlan { name: string; people: readonly (Person | 'me')[]; work?: readonly string[] | undefined }

/** One thing that happens. */
export type Beat =
  | { do: 'join'; who: Person; guest?: boolean | undefined; mic?: boolean | undefined }
  /** Someone leaves on purpose (Leave): what they present ends for good, said at once, as the server says it (`ended`). */
  | { do: 'leave'; who: Person }
  /**
   * Someone's page reloads: their connection drops, so they're gone from the people and what they present is hidden, with
   * nothing said to have ended, and they're back `seconds` later, in the same seat and part of the call, presenting it as it was,
   * with the same key.
   */
  | { do: 'reload'; who: Person; seconds: number }
  | { do: 'say'; line: Line }
  | { do: 'mic'; who: Person; on: boolean }
  | { do: 'hand'; who: Person; up: boolean }
  /** Someone asks a question for the room, with votes already on it; `anonymous`: it names nobody. */
  | { do: 'question'; who: Person; text: string; votes?: number; anonymous?: boolean | undefined }
  /** Someone nudges you: only you see it, and the same nudge from several people within a minute is one note. */
  | { do: 'nudge'; who: Person; kind: CallNudgeKind }
  /** Someone sets their status, for so many minutes, or clears it (null). */
  | { do: 'status'; who: Person; status: CallStatusKind | null; minutes?: CallStatusMinutes | undefined }
  | { do: 'share'; who: Person; screen: Screen }
  | { do: 'stop-sharing'; who: Person }
  | { do: 'chat'; who: Person; text: string; tagged: readonly (Person | 'me')[] }
  | { do: 'unavailable-chat'; text: string }
  /** A reply in the thread of the latest message with `to`'s text; `broadcast`: also sent to everyone, so it shows in the chat too. */
  | { do: 'reply'; who: Person; text: string; to: string; tagged: readonly (Person | 'me')[]; broadcast?: boolean | undefined }
  /** Someone reacts to the latest chat message with this text. */
  | { do: 'react'; who: Person; text: string; reaction: CallReaction }
  /** Someone reacts to the latest message with this text in your private conversation with them. */
  | { do: 'react-privately'; who: Person; text: string; reaction: CallReaction }
  /** Someone asks to join: signed in (their address shows), or by name only. */
  | { do: 'knock'; who: Person; byName?: boolean | undefined }
  | { do: 'ask-for-notes'; who: Person }
  /** The organizer, when it isn't you: notes on, off or paused, or not now to your ask. */
  | { do: 'notes'; mode: 'on' | 'off' | 'paused' }
  | { do: 'not-now' }
  /** The organizer, when it isn't you: rooms open (with a board each, or one they share), with a message to every room, and everyone back. */
  | { do: 'rooms'; rooms: readonly RoomPlan[]; minutes: number; board?: BreakoutBoard | undefined }
  | { do: 'message-rooms'; text: string }
  | { do: 'close-rooms' }
  /**
   * The organizer, when it isn't you, moves someone, or you (`me`), to the open room with this name, or back to the main room
   * (null): what they present where they were ends there, said at once.
   */
  | { do: 'move-to-room'; who: Person | 'me'; room: string | null }
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
  /**
   * Someone in the call goes to a document in the call's workspace (null: its list), typing there or not, or to one of the
   * call's own pages (`page`), which only the people in the call are told.
   */
  | { do: 'goes-to'; who: Person; document: string | null; typing?: boolean | undefined; page?: CallPage | undefined }
  /**
   * Someone presents the board open in the main room, from a frame, or the workspace as everyone views it; moves the board on;
   * and stops, for them alone, everyone following keeping it open on their own, or for everyone (`close`), which closes a board
   * in the call too, as the server lets them. The organizer, when it isn't you, closes what's presented in the main room for
   * everyone, whoever presents it: yours too, which is how you can tell it was them.
   */
  | { do: 'present'; who: Person; section?: number | undefined }
  | { do: 'present-workspace'; who: Person }
  | { do: 'move-presenting'; section: number }
  | { do: 'stop-presenting'; close?: boolean | undefined }
  | { do: 'close-presenting' }
  /** The organizer, when it isn't you, stops what someone shares, for everyone: yours (`me`), or anyone else's. */
  | { do: 'stop-share'; who: Person | 'me' }
  /** Someone plays a video in a document of the call's workspace for everyone, and stops it. */
  | { do: 'play'; who: Person; document: string; media: string }
  | { do: 'stop-playing' }
  /** Someone who can open nothing in the call's workspace asks the organizer to see it. */
  | { do: 'ask-to-see'; who: Person }
  /** The organizer, when it isn't you, says not now to your ask to see the workspace. */
  | { do: 'not-now-to-see' }
  /** Someone tags you in a document of the call's workspace, on a line. */
  | { do: 'tag-you'; who: Person; document: string; block?: string | undefined }
  /**
   * A board in the call (user-flows 6, A board in the call). Someone makes a new one, the board in the main room, from a
   * template, made in the call's home and filled as the server fills it, with what `draw` puts on it, or one you can't open
   * (`closedToYou`), which opens on their stage alone until they present it; adds a sticky to one of the frames of the board where you are, by the frame's title, which puts their
   * pointer by it; and whoever opened it closes it, unless someone else presents it. `standing` opens it here with no
   * connection to it (`offline`), or with Alcove refusing what's added here (`failed`), while the call carries on.
   */
  | { do: 'open-board'; who: Person; template: BoardTemplate; closedToYou?: boolean | undefined; draw?: ((doc: Y.Doc) => void) | undefined; standing?: 'offline' | 'failed' | undefined }
  | { do: 'add-sticky'; who: Person; frame: string; text: string }
  | { do: 'close-board' }
  /**
   * The board where you are leaves the call for everyone, as the server takes it out: someone moves it to Trash in the Drive, or
   * the folder it's in (`folder`: the call's folder, where the server makes a call's board, for one that's in none), or deletes
   * the workspace it's kept in. Its own connection says which, Trash or deleted, and what presented it ends.
   */
  | { do: 'trash-board'; folder?: boolean | undefined }
  | { do: 'delete-board-workspace' }
  /**
   * The board's timer and vote, run by someone else: a timer (`left`: seconds still to go, for one near its end), a vote on a
   * frame by its title (null: every sticky), ended with everyone else's votes by what each sticky says, and cleared.
   */
  | { do: 'start-timer'; who: Person; minutes: BoardTimerMinutes; left?: number | undefined }
  | { do: 'stop-timer' }
  | { do: 'start-vote'; who: Person; frame: string | null; per: BoardVotesEach }
  | { do: 'end-vote'; votes: Readonly<Record<string, number>>; voters: number }
  | { do: 'clear-vote' }
  /** Ideas from the call: what it heard worth a sticky, offered to whoever can add to the board where you are, while notes are on. */
  | { do: 'heard'; ideas: readonly HeardIdea[] }
  /** Anything else the story needs at that moment, such as someone ringing you to another call. */
  | { do: 'run'; what: () => void };

export interface Cue { at: number; beat: Beat }

export interface CallScript {
  /** A stable opaque call ID only for the explicit manual cross-tab browser-receipt scene. */
  notificationId?: string | undefined;
  privateSendFails?: boolean | undefined;
  privateMessages?: readonly { from: Person; text: string; after?: number; replyTo?: string; tagged?: readonly (Person | 'me')[] }[] | undefined;
  /** First sends fail in their original conversation, so a journey can show deliberate retry. */
  chatFailures?: number | undefined;
  /** The call's timer as you find it: one that's running starts its clock as you come in, `elapsedMs` already gone. */
  timer?: CallTimer | undefined;
  /** Who's in the call when you come in, besides you. */
  here?: readonly Present[] | undefined;
  /** How long the call has been going when you come in, in seconds. */
  since?: number | undefined;
  /** What was said before you came in: in the transcript already, while notes were on. */
  earlier?: readonly Line[] | undefined;
  /** Notes as you find them: as the call was set up, unless this says otherwise. */
  notes?: 'on' | 'off' | 'paused' | undefined;
  /** The AI model the call's notes use: the default unless this says otherwise. */
  model?: string | null | undefined;
  /** The conversation: a line every `every` seconds (4.5 unless it says), from `from` seconds in (2 unless it says). */
  talk?: { lines: readonly Line[]; from?: number | undefined; every?: number | undefined } | undefined;
  /** What happens, when. */
  cues?: readonly Cue[] | undefined;
  /** How the people you ring answer, by address: after how long, and what. Anyone else comes in after a few seconds. */
  answers?: Readonly<Record<string, { after: number; reply: RingReply | 'missed' }>> | undefined;
  /** Actual tasks and pending proposals already present when the story opens. */
  followUps?: readonly LiveFollowUp[] | undefined;
  /** What the live notes sum up, once anything has been said. */
  summary?: string | undefined;
  /** The call's workspace as you come in: what's been brought to the call, and where people are in it. */
  workspace?: ScriptWorkspace | undefined;
  /**
   * What the others do on a board once one's open, whoever opens it: the stickies they put on it, one every `every` seconds
   * (1.2 unless it says), and how they vote when a vote ends, by what each sticky says, and how many of them do.
   */
  board?: { work?: readonly BoardWork[] | undefined; every?: number | undefined; votes?: Readonly<Record<string, number>> | undefined; voters?: number | undefined } | undefined;
  /** While you're at the door: the organizer isn't in yet (they come this many seconds after the story opened), someone hosts in their place, or it's locked. */
  door?: { hostArrives?: number | undefined; standIn?: Person | undefined; locked?: boolean | undefined } | undefined;
}

/**
 * The call's workspace as you come in. Its home is the meeting's (`Meeting.workspaceId`, chosen when it was scheduled), else
 * a new one, made the first time anyone opens Workspace. `brought` are documents in it brought to the call, by ID, and
 * `where` is who's in it, on which document or page of the call's, once it's settled.
 */
export interface ScriptWorkspace {
  brought?: readonly string[] | undefined;
  where?: readonly { who: Person; document: string | null; typing?: boolean | undefined; page?: CallPage | undefined }[] | undefined;
}

/* ---------- writing a script ---------- */

/** These beats, `seconds` in. */
export const at = (seconds: number, ...beats: Beat[]): Cue[] => beats.map((beat) => ({ at: seconds, beat }));
export const joins = (who: Person, o: { guest?: boolean; mic?: boolean } = {}): Beat => ({ do: 'join', who, ...o });
/** Someone leaves on purpose: what they present ends, said at once. */
export const leaves = (who: Person): Beat => ({ do: 'leave', who });
/** Someone's page reloads: gone from the people for `seconds`, what they present hidden meanwhile, then back as it was, with the same key. */
export const reloads = (who: Person, seconds: number): Beat => ({ do: 'reload', who, seconds });
/** The organizer, when it isn't you, moves someone, or you, to the open room with this name, or back to the main room (null). */
export const movesToRoom = (who: Person | 'me', room: string | null): Beat => ({ do: 'move-to-room', who, room });
export const says = (who: Person | 'me', text: string, more: Omit<Line, 'who' | 'text'> = {}): Beat => ({ do: 'say', line: { who, text, ...more } });
export const unmutes = (who: Person): Beat => ({ do: 'mic', who, on: true });
export const mutes = (who: Person): Beat => ({ do: 'mic', who, on: false });
export const raisesHand = (who: Person): Beat => ({ do: 'hand', who, up: true });
export const lowersHand = (who: Person): Beat => ({ do: 'hand', who, up: false });
export const nudges = (who: Person, kind: CallNudgeKind): Beat => ({ do: 'nudge', who, kind });
export const setsStatus = (who: Person, status: CallStatusKind | null, minutes?: CallStatusMinutes): Beat => ({ do: 'status', who, status, minutes });
export const shares = (who: Person, screen: Screen): Beat => ({ do: 'share', who, screen });
export const stopsSharing = (who: Person): Beat => ({ do: 'stop-sharing', who });
export const chats = (who: Person, text: string, tagged: readonly (Person | 'me')[] = []): Beat => ({ do: 'chat', who, text, tagged });
export const replies = (who: Person, to: string, text: string, tagged: readonly (Person | 'me')[] = []): Beat => ({ do: 'reply', who, to, text, tagged });
/** A reply in a thread that's also sent to everyone. */
export const repliesToEveryone = (who: Person, to: string, text: string): Beat => ({ do: 'reply', who, to, text, tagged: [], broadcast: true });
/** Someone asks a question for the room. */
export const asks = (who: Person, text: string, o: { votes?: number; anonymous?: boolean } = {}): Beat => ({ do: 'question', who, text, ...o });
export const reacts = (who: Person, text: string, reaction: CallReaction): Beat => ({ do: 'react', who, text, reaction });
export const reactsPrivately = (who: Person, text: string, reaction: CallReaction): Beat => ({ do: 'react-privately', who, text, reaction });
export const knocks = (who: Person, o: { byName?: boolean } = {}): Beat => ({ do: 'knock', who, ...o });
export const asksForNotes = (who: Person): Beat => ({ do: 'ask-for-notes', who });
export const run = (what: () => void): Beat => ({ do: 'run', what });
export const goesTo = (who: Person, document: string | null, o: { typing?: boolean; page?: CallPage } = {}): Beat => ({ do: 'goes-to', who, document, ...o });
/** Someone in the call opens one of the call's own pages: Notes, Follow-ups or the Transcript. */
export const opensPage = (who: Person, page: CallPage): Beat => ({ do: 'goes-to', who, document: null, page });
/** Someone presents the board open in the main room, from a frame. */
export const presentsBoard = (who: Person, section?: number): Beat => ({ do: 'present', who, section });
/** Someone presents the workspace, as everyone in the call views it. */
export const presentsWorkspace = (who: Person): Beat => ({ do: 'present-workspace', who });
export const movesPresenting = (section: number): Beat => ({ do: 'move-presenting', section });
/** Whoever's presenting stops: for them alone, or for everyone (`close`). */
export const stopsPresenting = (close = false): Beat => ({ do: 'stop-presenting', close });
/** The organizer, when it isn't you, closes what's presented in the main room for everyone, whoever presents it, you included. */
export const closesPresenting = (): Beat => ({ do: 'close-presenting' });
/** The organizer stops what someone shares, yours or theirs, for everyone. */
export const stopsShare = (who: Person | 'me'): Beat => ({ do: 'stop-share', who });
export const plays = (who: Person, document: string, media: string): Beat => ({ do: 'play', who, document, media });
export const asksToSee = (who: Person): Beat => ({ do: 'ask-to-see', who });
export const tagsYou = (who: Person, document: string, block?: string): Beat => ({ do: 'tag-you', who, document, block });
/** Someone makes the board here from a template (on their stage alone until they present it), or one you can't open, or one that stands badly here. */
export const opensBoard = (who: Person, template: BoardTemplate, o: { closedToYou?: boolean; draw?: (doc: Y.Doc) => void; standing?: 'offline' | 'failed' } = {}): Beat => ({ do: 'open-board', who, template, ...o });
/** Someone adds a sticky to the frame with this title on the board that's open. */
export const addsSticky = (who: Person, frame: string, text: string): Beat => ({ do: 'add-sticky', who, frame, text });
/** Whoever opened the board where you are closes it for everyone there, unless someone else presents it. */
export const closesBoard = (): Beat => ({ do: 'close-board' });
/** Someone moves the board where you are to Trash in the Drive, or the folder it's in (`folder`): it leaves the call, and its connection says it's in Trash. */
export const trashesBoard = (o: { folder?: boolean } = {}): Beat => ({ do: 'trash-board', ...o });
/** Someone deletes the workspace the board where you are is kept in: it leaves the call, and its connection says it was deleted. */
export const deletesBoardWorkspace = (): Beat => ({ do: 'delete-board-workspace' });
export const hears = (...ideas: HeardIdea[]): Beat => ({ do: 'heard', ideas });
/** Someone starts the board's timer: `left` seconds to go, if it started a while ago. */
export const startsTimer = (who: Person, minutes: BoardTimerMinutes, left?: number): Beat => ({ do: 'start-timer', who, minutes, left });
export const stopsTimer = (): Beat => ({ do: 'stop-timer' });
/** Someone starts a vote on the frame with this title (null: on every sticky), with `per` votes each. */
export const startsVote = (who: Person, frame: string | null, per: BoardVotesEach = 3): Beat => ({ do: 'start-vote', who, frame, per });
/** The vote ends: everyone else's votes, by what each sticky says, and how many of them voted. Yours count too. */
export const endsVote = (votes: Readonly<Record<string, number>>, voters: number): Beat => ({ do: 'end-vote', votes, voters });
export const clearsVote = (): Beat => ({ do: 'clear-vote' });

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

/** The models to choose from: two in a secure enclave, two that are not. The first is the default. */
const DEFAULT_AI_MODEL = { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', name: 'DeepSeek V4.1 Flash 1017', private: true };
export const AI_MODELS: AiModels = {
  default: DEFAULT_AI_MODEL,
  models: [
    DEFAULT_AI_MODEL,
    { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', private: true },
    { id: 'anthropic/claude-haiku-5-5', name: 'Claude Haiku 5.5', private: false },
    { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', private: false }
  ]
};
/** The model a story picks for a call or an account that isn't in a secure enclave. */
export const UNENCRYPTED_MODEL = 'anthropic/claude-haiku-5-5';
/** Whether a model (null: the default) runs in a secure enclave. */
export const modelIsPrivate = (model: string | null): boolean => (model === null ? AI_MODELS.default : AI_MODELS.models.find((m) => m.id === model))?.private ?? true;

export const part = (mode: CaptureMode, since: string | null, by: CapturePart['by']): CapturePart => ({ mode, since, by });
/** What a call captures from the start, as it was set up: notes on (or paused, or off), and shared screens not read. */
export function captureOf(mode: 'on' | 'off' | 'paused', since: string | null, organizer: string, model: string | null = null): CaptureState {
  const by = since ? { kind: 'schedule' as const, name: organizer } : null;
  const p = part(mode, mode === 'off' ? null : since, mode === 'off' ? null : by);
  return { mode, recording: p, transcript: p, ai: p, screen: part('off', null, null), gaps: [], requests: [], asked: null, room: null, away: false, model, modelPrivate: modelIsPrivate(model), allowScreens: true };
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
    capture: live?.capture ? nameless(live.capture) : scripted && (m.status === 'live' || standIn) ? nameless(captureOf(scripted.script.notes ?? m.notes, m.startsAt, m.organizer.name, scripted.script.model ?? null)) : card.capture,
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
