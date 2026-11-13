import { type CallNotificationsApi } from './attention/notifications';
import { type CallTimerControl } from './timers/timers';
import { type FollowUpCreate, type FollowUpPatch, type FollowUpReview } from '../notes/follow-ups';
import { type CallNudgeKind, type CallQuestionStatus, type CallStatusKind, type CallStatusMinutes } from './attention/attention';
import { type PersonalApi } from '../notes/personal';
import { type SeriesAnswerPart } from '../notes/series';
import { type AudioPiece, type ScreenPiece, type TranscriptClip } from '../recordings/capture';
import { IDSchema } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { z } from '../shared/zod';
import { type BoardCheck, type BoardOpen, type BoardVotesEach, type BreakoutBoard } from './boards/boards';
import { type CaptionLanguage } from './notes/captions';
import { type CaptureDevicePart } from './notes/capture';
import { type CallAnswer, type CallMoment, type CatchUp, type CatchUpRange, type CatchUpWindow } from './notes/catchup';
import { type CallMoveOut, type MoveMedia } from './moves/moves';
import { type CallEndResult, type CallState, type CallTicket } from './state';
import { type CallFollowUps, type CallWorkspaceSwitch, type DocFollowUpTick, type PresentStart } from './workspace/workspace';
import { CallChatMentionSchema, validChatMentions, type CallChatMention } from './chat/mentions';
import { DirectKeyAnnouncementSchema, type DirectMessagesApi } from './chat/direct-messages';
import { CallChatThreadSchema, type CallChatThread } from './chat/threads';
import { CallReactionSchema, type CallChatReaction, type CallReaction } from './chat/reactions';

/**
 * A chat message, decrypted in this browser. `from` is the sender's identity, as MLS vouches for it; `place` is the
 * part of the call it was sent in (`main`, or a breakout room's ID), whose group alone could read it. `sending`: one of
 * yours that isn't in the log yet, so nobody can react to it. `broadcast`: a reply in a thread that was also sent to
 * everyone, so it shows in the conversation as well as in its thread.
 */
export interface CallChatMessage { id: string; from: string; isMe: boolean; text: string; mentions: CallChatMention[]; thread: CallChatThread | null; broadcast: boolean; at: number; place: string; sending: boolean; failed: boolean; reactions: CallChatReaction[] }

/** The longest chat message in a call, in characters. */
export const CALL_CHAT_MAX = 4000;

/**
 * Chat and its selected recipients travel inside the MLS application message, never in server-readable metadata.
 * Existing encrypted chat has no mentions field and opens with no selected recipients. `broadcast` is only for a reply in
 * a thread; chat sent before it existed opens as not broadcast.
 */
export const CallChatTextSchema = z.object({
  text: z.string().min(1).max(CALL_CHAT_MAX), mentions: z.array(CallChatMentionSchema).max(50).default([]), thread: CallChatThreadSchema.nullable().default(null),
  broadcast: z.boolean().default(false), at: z.number()
}).refine(validChatMentions, 'Chat mentions must mark separate names in the message.')
  .refine((m) => !m.broadcast || m.thread !== null, 'Only a reply in a thread is also sent to everyone.');

/** The application payload, parsed only after authenticated decryption. */
export const CallChatPayloadSchema = z.union([
  z.object({ directKey: DirectKeyAnnouncementSchema, at: z.number() }),
  CallChatTextSchema,
  z.object({ react: z.object({ target: z.string().min(1).max(64), reaction: CallReactionSchema, on: z.boolean() }), at: z.number() })
]);
export type CallChatPayload = z.infer<typeof CallChatPayloadSchema>;

/**
 * How much longer data browsers send each other is once sealed (CallSession.sealData): a version byte, the key's ring
 * index and a 12-byte nonce in front, and AES-GCM's 16-byte tag.
 */
export const CALL_DATA_OVERHEAD = 30;

/** How many keys LiveKit's frame encryption keeps per sender (its key index is one byte); media key indices are below it. */
export const CALL_KEYRING = 256;

/**
 * The key-ring index a browser sends under while it's between two parts of the call, with a key nobody else has.
 * No epoch's keys are ever put there, so nobody can decrypt what it sends meanwhile.
 */
export const CALL_VOID_KEY_INDEX = CALL_KEYRING - 1;


/**
 * The media keys for LiveKit's frame encryption, from the MLS group of the part of the call this browser is in:
 * one per sender per epoch (a key encrypts only its sender's frames, as SFrame requires), at a key-ring index for
 * that epoch. New ones with every join and leave, and every few minutes besides.
 */
export interface CallMediaKeys {
  /** The latest few epochs, oldest first: everyone's keys, by identity, to decrypt their frames with. */
  epochs: { index: number; keys: Record<string, Uint8Array> }[];
  /**
   * This browser's own key to encrypt with. For a moment after the keys move on it's still the previous
   * epoch's, so everyone has the new keys before anyone sends with them. Null while it's between two parts of
   * the call: then it sends under a key nobody else has, so nothing it sends can be heard or seen anywhere.
   */
  send: { index: number; key: Uint8Array } | null;
}


/**
 * This browser's side of the call's end-to-end encryption: the MLS group of the part of the call it's in, and what
 * that gives it. Nothing here ever leaves the browser.
 */
export interface CallCrypto {
  /**
   * joining: making keys, or getting back in; waiting: asked to be let in; in: in the group of the part of the call
   * it's in; moving: let in, and between two parts of the call (sent to a breakout room, or back from one), so it hears
   * and sends nothing until it's in the new part's group; denied: turned away; removed: no longer in the call (removed,
   * or this call went on from another tab or device); away: the organizer's connection, gone long enough that someone
   * else hosts now, so joining again takes the call back; failed: this browser's keys fell out of step, and it has to
   * join again.
   */
  status: 'joining' | 'waiting' | 'in' | 'moving' | 'denied' | 'removed' | 'away' | 'failed';
  /** The part of the call this browser is in, or is on its way to: `main`, or a breakout room's ID. */
  place: string;
  /** Who's in that part's group (LiveKit identities), from MLS itself, not from the server: the people whose media plays here. */
  members: string[];
  /** Everyone in every group this browser keeps (the organizer's keeps every part of the call's), from MLS. */
  everyone: string[];
  media: CallMediaKeys | null;
  chat: CallChatMessage[];
  /** True once there was chat in this part of the call while this browser wasn't in it, which it can't read. */
  missedChat: boolean;
}


/** A live transcript line in someone's caption language. Only the person who asked sees it. */
export const CaptionTranslationSchema = z.object({ id: IDSchema, text: z.string() });

export type CaptionTranslation = z.infer<typeof CaptionTranslationSchema>;


/** A line of a call's recording, to hear: its audio, whole pieces of the recording around it, and where in that the line is (seconds). */
export interface LineAudio { audio: Blob; from: number; seconds: number }


/**
 * Someone to send to a room: someone invited by address, so they land in it from any device, or anyone else in the call (a guest
 * with the link) by seat (`CallParticipant.seat`).
 */
export type RoomPerson = { email: string; seat?: undefined } | { seat: string; email?: undefined };

/**
 * Rooms to open: who goes where (people invited by address, anyone else in the call by seat), for how long, what they have to
 * work on, and the room the organizer goes to as they open (`visit`, by its place in `rooms`), if any.
 */
export interface BreakoutPlan { rooms: { name: string; emails: string[]; seats?: string[] | undefined }[]; minutes: number; board: BreakoutBoard; visit?: number | undefined }


export interface CallSession extends LiveStore<CallState> {
  /** Content-free candidates from this exact connection’s current authorized snapshots. */
  readonly notifications: CallNotificationsApi;
  /** Recipient-only encrypted messages, kept apart from room chat and every shared capture surface. */
  readonly direct: DirectMessagesApi;
  /** Whoever hosts: starts the call's timer for everyone, pauses, resumes, adds time to or stops it. Resolves once the server has. */
  controlTimer(input: CallTimerControl): Promise<void>;
  /** Who you are in the call, and this person's pass for the call's requests. */
  readonly ticket: CallTicket;
  /** The call's encryption as this browser sees it. */
  readonly crypto: LiveStore<CallCrypto>;
  /**
   * Your own notes on this call, with this browser's account: only you read them. For the organizer and everyone on the
   * invite, once notes have been on; someone with only the link has no account to keep them under.
   */
  readonly personal: PersonalApi;
  /** A LiveKit token, once you're let in. Rejected before that. */
  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }>;
  /**
   * Fetches the call and its MLS log again (other people's chat, notes changes, transcript lines and keys arrive this way), or
   * only what the server's change push (`CallChanged`) says changed.
   */
  refresh(what?: { call: boolean; log: boolean } | undefined): Promise<void>;
  /**
   * Encrypted in this browser for everyone in the group of the part of the call you're in. Nobody who comes later can read it.
   * `broadcast`, with a thread: the reply shows in the conversation as well as in its thread.
   */
  sendChat(text: string, mentions?: readonly CallChatMention[], thread?: CallChatThread | null, broadcast?: boolean): Promise<void>;
  /** Retry the same failed encrypted message in its original conversation, never as a new room message. */
  retryChat(messageId: string): Promise<void>;
  /** Mark readable chat messages as read for this person's seat, shared with their other clients. */
  readChat(ids: readonly string[]): Promise<void>;
  /**
   * Adds (`on`) or takes back your reaction to a chat message (by its ID, once it's in the log), encrypted like chat
   * for everyone in the group of the part of the call you're in.
   */
  react(messageId: string, reaction: CallReaction, on: boolean): Promise<void>;
  /**
   * Seals data this browser sends straight to the others in the call through LiveKit (pointers and marks on shared
   * screens): AES-GCM under a key derived from its own media key for the epoch it sends in, bound to `topic` and to who
   * sends it. Only someone holding that key (the people in the call's group) can open it. Null while there's no key.
   */
  sealData(topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * Opens data `from` someone in the call, with their media key for the epoch it was sealed in (one of the last few). Null
   * when it doesn't open: not sealed by them, for another topic, from too long ago, or changed on the way.
   */
  openData(topic: string, from: string, sealed: Uint8Array): Promise<Uint8Array | null>;
  /** Whoever hosts: lets someone who asked into the call (their browser is added to the group). */
  admit(identity: string): Promise<void>;
  /** Whoever hosts: turns someone away. */
  deny(identity: string): Promise<void>;
  /** Organizer only: rings teammates, or people already invited, by address. Anyone rung is added to the invite; ringing someone again starts over. */
  ring(emails: string[]): Promise<void>;
  /** Organizer only. Everyone in the call sees the change. Resolves once it's made, so capture can wait for it. */
  setNotes(on: boolean): Promise<void>;
  /**
   * Organizer only: holds every kind of capture until resume(). Nothing is recorded, transcribed or sent to the AI
   * meanwhile, and the server refuses whatever arrives. Resolves once the server has paused.
   */
  pause(): Promise<void>;
  /** Organizer only: carries on capturing, on a new segment. Nothing else ever resumes it: not a reconnect, a room or a new device. */
  resume(): Promise<void>;
  /** Anyone but the organizer, while notes are off or paused: asks the organizer for notes, like raising a hand, or takes the ask back. */
  requestNotes(up: boolean): Promise<void>;
  /** Organizer only: says not now to an ask for notes. Whoever asked is told. Saying yes is turning notes on, or resuming. */
  declineNotes(requestId: string): Promise<void>;
  /** Whoever hosts, whose browser takes the notes: what it can't capture now (no microphone, or no way to record or listen), or none. */
  setUnavailable(parts: CaptureDevicePart[]): Promise<void>;
  /**
   * Organizer only: the model for this call's notes (an ID from `models.list()`), or the default model (null).
   * Everyone sees it in `capture.model`. Resolves once the server has it.
   */
  setModel(model: string | null): Promise<void>;
  /**
   * The presenter's own browser, once they've picked what to share: starts a share, and says whether it goes in the
   * notes. `keep` says whether it does: never from a breakout room, and `notes` is refused while notes are off. Everyone
   * sees it in `shares`.
   */
  startShare(o: { notes: boolean }): Promise<{ share: string; keep: boolean }>;
  /** The presenter's own browser: one piece of a kept share's video, encrypted and kept with the call's audio. */
  appendScreen(piece: ScreenPiece): Promise<void>;
  /** The presenter's own browser: one of its shares ended, so its video and what it showed stop there in the notes. */
  shareEnded(share: string): Promise<void>;
  /** Raises or lowers your hand for your room and the host. Resolves once confirmed. */
  setHand(up: boolean): Promise<void>;
  /** Host only: lowers this exact raised hand, so an older click cannot lower a new raise. */
  lowerHand(entryId: string): Promise<void>;
  /**
   * Posts a question for the people here now; reuse the ID to retry the same words. `anonymous`: nobody is told who asked,
   * whoever hosts included, and only you see that it's yours (`CallQuestion.own`).
   */
  postQuestion(id: string, text: string, anonymous?: boolean): Promise<void>;
  /** Takes back a question you asked, anonymously or not: it goes for everyone. Only whoever asked it can. */
  withdrawQuestion(id: string): Promise<void>;
  /** One vote per signed-in account, or per guest call person, within the original audience. */
  voteQuestion(id: string, on: boolean): Promise<void>;
  /** Host only, and only for a question in their original audience. */
  resolveQuestion(id: string, status: CallQuestionStatus): Promise<void>;
  /** Host only: pins an accessible open question, replacing the room's pin; null clears it. */
  pinQuestion(id: string | null): Promise<void>;
  /**
   * A nudge to someone else in your room (`to`, their participant ID): only they see it. The same nudge from several people
   * within a minute reaches them as one note with a count, and the same again from you then changes nothing. Resolves once
   * the server has it.
   */
  nudge(to: string, kind: CallNudgeKind): Promise<void>;
  /**
   * Your status, for everyone in the call (`participants[].status`), or none (null): it goes `minutes` from now, and with no
   * `minutes` a time already set stays. Resolves once the server has it.
   */
  setStatus(status: CallStatusKind | null, minutes?: CallStatusMinutes | undefined): Promise<void>;
  /** Whether others may point at and mark what you share; everyone sees it. Resolves once the server has it. */
  letOthersPoint(on: boolean): Promise<void>;
  /** Organizer only: whether anyone may point at and mark shared screens in this call. Resolves once the server has it. */
  setPointing(on: boolean): Promise<void>;
  /** Whoever hosts: puts one participant on everyone's main stage, or nobody (null). */
  setSpotlight(participantId: string | null): void;
  /** Organizer only: splits the people in the call into rooms for a while, and goes to one of them as they open if the plan says so. */
  openRooms(plan: BreakoutPlan): void;
  /** Whoever hosts: brings everyone back from the rooms now. */
  closeRooms(): void;
  /** Organizer only: a message every room sees. */
  messageRooms(text: string): void;
  /** Organizer only: goes to one of the open rooms, or back to the main room (null). Everyone in that room sees and hears them. */
  visitRoom(roomId: string | null): void;
  /** Organizer only: renames an open room. */
  renameRoom(roomId: string, name: string): void;
  /** Organizer only: sends someone to another open room, or back to the main room (null). Their keys move with them. */
  moveToRoom(who: RoomPerson, roomId: string | null): void;
  /**
   * Organizer only: pauses notes in one open room while the call's notes are on, or carries on there (`paused` false).
   * Nothing said in a paused room is transcribed or sent to the AI, and the server refuses whatever arrives for it.
   * Resolves once the server has done it.
   */
  pauseRoom(roomId: string, paused: boolean): Promise<void>;
  /** Live transcript lines in `language`, for you alone. Each line is translated once and kept sealed until the call ends. */
  translate(lineIds: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  /**
   * Hear it, during the call: the recording of one line of its transcript (`line`, in the note `note`), for anyone in the
   * call, but only a line they may read, said while they were there: a guest with the link never hears what was said while
   * they were away. `not-found` for anything else, a call that doesn't keep its recording included. After the call it's
   * the note's audio, for people with the note.
   */
  hear(note: string, line: string): Promise<LineAudio>;
  /** Whoever hosts: encrypts and stores one piece of the notes recording. */
  appendAudio(piece: AudioPiece): Promise<void>;
  /**
   * Whoever hosts: transcribes a few seconds of speech into the live transcript, under whoever said it. The host's
   * browser hears everyone it plays, each on their own: `speaker` is the participant ID of the person heard (this
   * browser's own for its microphone). Only while notes are on.
   */
  transcribe(clip: TranscriptClip, speaker: string): Promise<void>;
  /**
   * Says this browser is showing the live notes, until the function it returns is called. While anything here is, the
   * notes of the part of the call it's in are kept up to date: at most every 30 seconds while there's something new,
   * in one run however many browsers are watching. The notes themselves arrive with the call (`CallState.liveNotes`).
   */
  watchNotes(): () => void;
  /**
   * Anyone in the call who gets the notes: ticks a follow-up of the live notes, or takes the tick back, for everyone in
   * that part of the call. It stays ticked through every refresh, and is done in the note when the call ends. A guest
   * with the link is refused, and notes written for a narrower view (`read.whileHere`) can't be ticked. Resolves once the
   * server has it.
   */
  tickFollowUp(id: string, done: boolean): Promise<void>;
  /**
   * Anyone in the call who gets the notes: adds an actual follow-up in your own words, with an invited owner or nobody
   * and an optional date, for everyone in that part of the call. It's ticked with `tickFollowUp`, comes with the call (`CallState.liveNotes.added`), and keeps its identity in
   * the note when the call ends. The same words again add nothing. Refused where ticking is, and where notes have never been on.
   */
  addFollowUp(input: FollowUpCreate): Promise<void>;
  updateFollowUp(id: string, patch: FollowUpPatch): Promise<void>;
  reviewFollowUp(review: FollowUpReview): Promise<void>;
  /**
   * Opening Workspace, for anyone in the call: the first time, it settles the call's home (the meeting's, else a new one
   * named after the call and the day, where this browser is), with the call's folder in it, and the next call in a series
   * finds its new agenda. Resolves with `workspace` up to date, which for someone who can't open it says it's private.
   */
  openWorkspace(): Promise<void>;
  /** Organizer only: what viewing another workspace would mean, for the sheet that asks. Changes nothing. */
  previewWorkspace(workspaceId: string): Promise<CallWorkspaceSwitch>;
  /**
   * Organizer only: everyone views and edits a workspace the organizer can edit in, or the call's home again. The notes and
   * transcript still go to the home. Nobody is interrupted; what's being presented and played stops.
   */
  setWorkspace(workspaceId: string): Promise<void>;
  /**
   * Organizer only: makes a workspace for this call, named after it unless it's given a name, and everyone views it. As the
   * call's home does, it has everyone invited in it to edit (a guest without an account isn't), and it follows the invite.
   */
  newWorkspace(name?: string | undefined): Promise<void>;
  /** Anyone who can open it: brings a document in the call's workspace to the call, or takes it off (`brought` false). */
  bringDocument(documentId: string, brought: boolean): Promise<void>;
  /**
   * Anyone who can open it: presents the workspace everyone views, or the board open where you are, to the part of the call
   * you're in, as a new presentation (`CallPresent.key`). One at a time there: refused while someone else presents either, and
   * starting while you present one presents this in its place.
   */
  startPresenting(what: PresentStart): Promise<void>;
  /** Whoever started it, or the organizer: everyone goes to another of the board's frames. */
  movePresenting(section: number): Promise<void>;
  /**
   * Whoever started it, or the organizer: it ends for whoever presented it, and everyone following keeps it open on their own;
   * or for everyone (`close`), which closes a board in the call too. Everyone there is told which (`CallWorkspace.ended`).
   */
  stopPresenting(close: boolean): Promise<void>;
  /** Anyone who can open the document: plays a video in it for the part of the call they're in, from `positionMs`. */
  startPlaying(documentId: string, mediaId: string, positionMs?: number | undefined): Promise<void>;
  /** Whoever started it, or the organizer: it holds at `positionMs`. */
  pausePlaying(positionMs: number): Promise<void>;
  /** Whoever started it, or the organizer: it carries on from where it holds. */
  resumePlaying(): Promise<void>;
  /** Whoever started it, or the organizer: it goes to `positionMs`, playing or held as it was. */
  seekPlaying(positionMs: number): Promise<void>;
  /** Whoever started it, or the organizer. Nothing about the video changes. */
  stopPlaying(): Promise<void>;
  /**
   * Anyone invited, not a guest: opens a board for everyone in the part of the call they're in, in place of whatever's open
   * there. A new one is saved in the call's home, named after the call; a saved one, from whichever workspace it's in, needs
   * `edit` on it. Refused while someone else presents a board there, as nothing takes theirs off everyone's stage. Resolves
   * once it's open, with `board` up to date.
   */
  openBoard(from: BoardOpen): Promise<void>;
  /** Whoever opened it, or the organizer: closes it for everyone. Nothing is deleted, and nobody loses what the call gave them. */
  closeBoard(): Promise<void>;
  /** What opening a saved board would mean: who here can't open it, and whether you may let them in. For someone who could bring it. Changes nothing. */
  boardCheck(workspaceId: string, documentId: string): Promise<BoardCheck>;
  /**
   * Says this browser has the board open, until the function it returns is called. While anything here does, and notes are
   * on, what was said in the part of the call it's in is looked at for ideas worth putting on the board: at most once a
   * minute, in one run however many browsers are looking. The ideas arrive with the call (`CallState.board.ideas`).
   */
  watchIdeas(): () => void;
  /** Ideas from the call that were added to the board, or put aside: they go for everyone in that part of the call. */
  ideasDone(ids: string[]): Promise<void>;
  /**
   * Anyone who can edit the board open here: a vote on one of its frames, or on every sticky on it with no frame, with `per`
   * votes each. Nobody is told a count until it ends. Never on top of another, nor of one whose results haven't been cleared.
   */
  startVote(frame: string | null, per: BoardVotesEach): Promise<void>;
  /** Anyone who can edit the board, while the vote is on: a vote for a sticky it's on, one a sticky, up to `per`. Only you are told. */
  castVote(sticky: string): Promise<void>;
  /** Takes your vote for a sticky back, while the vote is on. */
  takeBackVote(sticky: string): Promise<void>;
  /** Whoever started it, or the organizer, or while neither is in the call anyone who can edit the board: it ends, and everyone is told every count at once. */
  endVote(): Promise<void>;
  /** The same people, once it's ended: the results go, for everyone. */
  clearVote(): Promise<void>;
  /** The call's follow-ups as you may read them, kept up to date while something here says it's showing them (`watchFollowUps`). */
  readonly followUps: LiveStore<CallFollowUps | null>;
  /** Says this browser is showing the follow-ups, until the function it returns is called. */
  watchFollowUps(): () => void;
  /** Ticks a to-do in a document from the follow-ups, or takes the tick back, as ticking it in the document does. Needs `edit`. */
  tickDocumentFollowUp(tick: DocFollowUpTick): Promise<void>;
  /** What was said in `range`, for you alone: decided, proposed, still open and next, each with the moments it comes from. */
  catchUp(range: CatchUpRange): Promise<CatchUp>;
  /** Asks about what was said in `range`, for you alone, with the moments the answer comes from. */
  askSoFar(question: string, range: CatchUpRange): Promise<CallAnswer>;
  /** What you can catch up on: when you came in, your latest time away, and for a guest the stretches they were here. */
  catchUpWindow(): Promise<CatchUpWindow>;
  /** A moment of the live transcript from a catch-up or an answer, with what was said around it. Your access is checked again. */
  moment(lineId: string): Promise<CallMoment>;
  /**
   * Asks across the earlier calls in this call's series, for you alone, from the notes your account has now, with the
   * calls and moments the answer comes from. `timeZone` as in series.ask. Needs a sign-in, and waits while notes are paused.
   */
  askEarlier(question: string, timeZone: string): Promise<SeriesAnswerPart[]>;
  /* Host controls, for whoever hosts (refused for anyone else). */
  /** Mutes one of someone's tracks; they unmute themselves. */
  mute(identity: string, trackSid: string): Promise<void>;
  /**
   * Organizer only: stops what someone shares (their screen and its sound), for everyone, by their seat. Everyone else is told
   * who stopped it. Refused when they share nothing.
   */
  stopShare(seat: string): Promise<void>;
  /** Disconnects someone. They can come back with the link unless the call is locked. Nobody removes the organizer. */
  remove(identity: string): Promise<void>;
  /** While locked, nobody new can join except the organizer. */
  lock(on: boolean): Promise<void>;
  /** Stops ringing someone (their `Rung.id`). A ring that's already over needs no stopping. */
  stopRing(ringId: string): Promise<void>;
  /** Hides a notice on this screen only. */
  dismissNotice(id: string): void;
  /** Starts moving your place in the call to another device, with your microphone and camera as they are now. */
  startMove(media: MoveMedia): Promise<CallMoveOut>;
  /** Whoever hosts leaving ends the call for everyone and returns how it ended; anyone else just leaves (null). */
  leave(): Promise<CallEndResult | null>;
  /**
   * Whoever hosts leaves, and the call goes on with `to` hosting (someone invited who's in the call, among
   * `CallState.host.next`) until the organizer is back. Refused when they can't host now.
   */
  handOff(to: string): Promise<void>;
  /** Stops keeping up with the call here, without leaving it: the call ended, or this person is out of it. */
  close(): void;
  /**
   * The page is going away (closed, reloaded or left for another): stops here and tells the server this connection
   * has gone, without waiting for an answer, so nobody waits on it. Whoever hosts doesn't say so: their reload comes
   * back still hosting, and if they don't come back someone else hosts, or the call ends when nobody can.
   */
  closing(): void;
}
