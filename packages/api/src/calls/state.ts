import { CallTimerSchema } from './timers';
import { PersonSchema } from '../identity/people';
import { SignInProviderSchema } from '../identity/session';
import { TranscriptLineSchema } from '../notes/transcript';
import { RecordingProgressSchema } from '../recordings/capture';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { BreakoutBoardModeSchema, CallBoardSchema } from './boards';
import { CaptureStateSchema } from './capture';
import { LiveNotesSchema } from './catchup';
import { CallCodeSchema } from './entry';
import { RungSchema } from './rings';
import { NotesChoicesSchema, NotesSettingSchema } from './settings';
import { CallAttentionSchema, CallStatusSchema } from './attention';
import { CallWorkspaceSchema } from './workspace';
/* ---------- group calls: who's in the call comes from the API; mic, camera and screen are LiveKit's tracks ---------- */

/**
 * The organizer hosts. Invited people join with their accounts. Anyone else with the link asks to join: signed in, under
 * their account, or with a typed name. Someone signed in whom the organizer lets in from the link is added to the
 * invite (when the notes may go to their account), and is invited from then on.
 */
export const CallRoleSchema = z.enum(['host', 'invited', 'guest']);

export type CallRole = z.infer<typeof CallRoleSchema>;


/** What anyone with a call's link sees before joining. No account needed. */
export const CallCardSchema = z.object({
  title: z.string(),
  organizerName: z.string(),
  /** When the call starts. Means nothing while `offer` is open; once someone has picked, it's the time they picked. */
  startsAt: ISODateSchema,
  /** Someone hosts the call now (the organizer, or someone standing in for them): everyone but the organizer waits until this is true. */
  hostHere: z.boolean(),
  /**
   * Someone is hosting while the organizer is away, so they let people in. Their name goes only to the organizer, whose
   * joining takes the call back; anyone else learns only that someone is standing in.
   */
  standIn: z.object({ name: z.string().optional() }).nullable(),
  locked: z.boolean(),
  /** Notes as the call was scheduled: whether they start when it does. */
  notes: NotesSettingSchema,
  /** What the notes keep, so people know before they join. */
  choices: NotesChoicesSchema,
  /** Everyone joins with their microphone and camera off. */
  joinMuted: z.boolean(),
  /** Times offered to pick from, until someone with the link has: no joining meanwhile. How long the call is, in minutes. */
  offer: z.object({ times: z.array(ISODateSchema), minutes: z.number() }).nullable(),
  /** What's being captured now, without anyone's name; null until the organizer has started the call. */
  capture: CaptureStateSchema.nullable(),
  /** The call is over and nobody has started it again. */
  ended: z.boolean(),
  /**
   * Where the person asking stands, by their session. `invited` (or the organizer): let in without asking, and gets
   * the notes. `asks`: signed in with an account the notes may go to, so the organizer letting them in adds them to
   * the invite. `guest`: asks by name and doesn't get the notes (no account, a demo sign-in on a real organizer's
   * call, or someone standing in for the organizer would let them in).
   */
  you: z.enum(['invited', 'asks', 'guest']),
  /**
   * The ways of signing in that get this call's notes once let in: Google, and Microsoft and single sign-on too when
   * the organizer's own account is a demo one.
   */
  signInForNotes: z.array(SignInProviderSchema)
});

export type CallCard = z.infer<typeof CallCardSchema>;


/** What joining hands back: who you are in the call, and the pass for its requests. The room comes once you're let in. */
export const CallTicketSchema = z.object({
  callId: IDSchema,
  serverUrl: z.string(),
  roomName: z.string(),
  /** This connection's random LiveKit identity; a new one for every join. */
  identity: z.string(),
  role: CallRoleSchema,
  /** Sent as `x-alcove-call` on this call's requests. Never put it in a URL. */
  pass: z.string()
});

export type CallTicket = z.infer<typeof CallTicketSchema>;

export const CALL_PASS_HEADER = 'x-alcove-call' as const;


/** A call pass as a browser keeps it (sessionStorage) for coming back after a reload: parsed before it's sent anywhere. */
export const CallPassStoredSchema = z.string().min(20).max(2000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);


/**
 * The call a browser goes back to after signing in with Google from its join page (sessionStorage, in that tab only):
 * its code, as a link has it, and until when (ms).
 */
export const CallReturnStoredSchema = z.object({ code: CallCodeSchema, until: z.number() });


/** A LiveKit join token, for someone who's been let in. It only lasts until the browser connects; it carries no name. */
export const CallRoomTokenSchema = z.object({ token: z.string() });


/**
 * The parts of a call (docs: Calls and recordings › Breakout rooms): the main room, and while breakout rooms are
 * open, each room, by its ID. Each part has its own MLS group, so its own media keys and chat.
 */
export const MAIN_PLACE = 'main' as const;

/** A part of the call as the wire names it: `main`, or a breakout room's ID. */
export const CallPlaceSchema = z.string().regex(/^(?:main|[A-Za-z0-9_-]{16,64})$/);


/**
 * The call's MLS log as this person may see it (docs: Calls and recordings › End-to-end encryption). Bodies are MLS
 * messages, base64url: the organizer's commits, a welcome for whoever was added, and chat, each in one part of the
 * call's group (`group`). Key packages come with the people the host's browser may add (`CallMlsGroup.pending`).
 */
export const CallMlsItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('welcome'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('message'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() })
]);

export type CallMlsItem = z.infer<typeof CallMlsItemSchema>;

/** One part of the call's MLS group as this browser keeps it: its epoch, and for the host's browser whom to add and take out. */
export const CallMlsGroupSchema = z.object({
  /** `main`, or a breakout room's ID. */
  id: z.string(),
  epoch: z.number(),
  /**
   * For the host's browser: who it may add to this group now, whether they need letting in first, and their latest
   * key package (base64url), however long ago it came: someone moving sends theirs before they may be added.
   */
  pending: z.array(z.object({ id: z.string(), admit: z.enum(['auto', 'ask']), keyPackage: z.string() })),
  /** For the host's browser: people in this group to take out of it (gone, removed, or sent to another part of the call). */
  departed: z.array(z.string())
});

export type CallMlsGroup = z.infer<typeof CallMlsGroupSchema>;

export const CallMlsSchema = z.object({
  /** A new generation (new MLS groups for every part of the call) starts whenever the connection that hosts changes. */
  generation: z.number(),
  /**
   * Where this person stands: let in, still waiting to be, out for now (taken out while this connection was away, so it
   * can come back in as it is: `mls/back`), or not in the call (turned away, removed, left, or their place went to
   * another tab or device). `away`: an organizer's connection that was gone long enough that someone else hosts now;
   * joining again takes the call back.
   */
  admission: z.enum(['in', 'waiting', 'out', 'denied', 'away']),
  /**
   * The connection that hosts, so commits for every group in this generation: its browser created them all, so it's at
   * leaf 0 of each, the only one whose commits count. The organizer's, or someone's standing in while the organizer is away.
   */
  committer: z.string().nullable(),
  /** The part of the call this person is in now (`main`, or the room they're in or the organizer is visiting): their media and chat use its group. */
  place: z.string(),
  /** The group this person is in, as the API counts the organizer's commits: `main`, a room's ID, or null (none yet, or between two). The organizer is in every group. */
  group: z.string().nullable(),
  /** The groups this browser keeps: the host's, every part of the call; anyone else's, the one they're in. */
  groups: z.array(CallMlsGroupSchema),
  /** This person's part of the log: the host's from the start of the generation (chat only in its part of the call, from when it got there), anyone else's from their welcome into their group. */
  items: z.array(CallMlsItemSchema),
  /** Whether there was chat in this person's part of the call while they weren't there, which their browser can't read. */
  earlierChat: z.boolean(),
  /** This browser should send a fresh key package: it's to be added to a group (a new generation, or a move to another part of the call) and has none unused. */
  keys: z.boolean(),
  /** How far the log was read (past entries for other people too), to ask from next time. */
  latest: z.number(),
  /** There's more after `latest`: ask again at once. */
  more: z.boolean()
});

export type CallMls = z.infer<typeof CallMlsSchema>;



/**
 * Sent by the server on CALL_TOPIC when the call changed: `call` (people, notes, the transcript) and `log` (its
 * MLS log: keys and chat) say what to fetch again. It carries nothing else, so LiveKit learns nothing from it.
 */
export const CALL_TOPIC = 'call' as const;

/** The server's change push on CALL_TOPIC, as above. Nothing to do with someone's nudge (`CallNudgeKind`). */
export const CallChangedSchema = z.object({ v: z.literal(1), kind: z.literal('changed'), call: z.boolean(), log: z.boolean() });

export type CallChanged = z.infer<typeof CallChangedSchema>;


export const CallParticipantSchema = z.object({
  /** LiveKit identity: new for every connection, a reload included. */
  id: z.string(),
  /**
   * The same across someone's reconnections to this call (a reload; for the organizer, any device), so each viewer's
   * own layout keeps them where they were. Anyone else joining from a second browser is a new person, with a new seat.
   * Random, and different in every call: it says nothing about who they are.
   */
  seat: z.string(),
  /** `isOrganizer`: the organizer's connection. Who hosts now is `CallState.host`. */
  person: PersonSchema, isMe: z.boolean(), isOrganizer: z.boolean(),
  /** A raised hand visible in your room, or to the host across rooms. (Mic, camera and screen are LiveKit's tracks, not the server's.) */
  hand: z.boolean(),
  /** What they say they're up to (Be right back, Listening only, On my phone), for everyone in the call, or null. */
  status: CallStatusSchema.nullable(),
  /**
   * Whether others may point at and mark what they share: their own choice, kept across their reconnections, on until
   * they turn it off. They can always point at their own share.
   */
  othersPoint: z.boolean()
});

export type CallParticipant = z.infer<typeof CallParticipantSchema>;


/**
 * Someone asking to be let in. Only the organizer sees them: with their account's address when they're signed in with
 * one the notes may go to (letting them in adds them to the invite), otherwise by name, without an address.
 */
export const CallAskerSchema = z.object({ id: z.string(), person: PersonSchema });

export type CallAsker = z.infer<typeof CallAskerSchema>;


export const CallNoticeSchema = z.object({
  id: IDSchema,
  /** Plain sentence shown to everyone, e.g. "You turned on notes." */
  text: z.string(),
  kind: z.enum(['notes', 'people', 'info'])
});

export type CallNotice = z.infer<typeof CallNoticeSchema>;

/** Notices a tab has shown for a call, as it keeps them (sessionStorage), so a reload doesn't show them again. */
export const CallNoticesSeenSchema = z.array(IDSchema.max(64)).max(50);


/** One breakout room: its name, the invited people sent to it, and anyone else sent to it. */
export const BreakoutRoomSchema = z.object({
  id: IDSchema, name: z.string(), people: z.array(PersonSchema),
  /**
   * Anyone else sent to it (a guest with the link), by name only, never an address, under their seat (`CallParticipant.seat`),
   * which moving them names. A guest sees the others sent to a room only while they're in the call.
   */
  guests: z.array(z.object({ seat: z.string(), person: PersonSchema })),
  /**
   * Who's in it now, by participant ID: the people sent there who are in the call, and the organizer while visiting it. Each
   * room has its own MLS group, so its own media keys and chat.
   */
  members: z.array(z.string())
});

export type BreakoutRoom = z.infer<typeof BreakoutRoomSchema>;

export const BreakoutsSchema = z.object({
  /** Rooms that are open now, or null. Times are seconds since the call started. */
  open: z.object({
    /**
     * Each room open now, whether the organizer has paused notes in it (CaptureState.room says what that holds), and whether
     * it has a board of its own open: what's on it is for the people in it, so nobody else is told more than that.
     */
    rooms: z.array(BreakoutRoomSchema.extend({ paused: z.boolean(), board: z.boolean() })),
    /** What the rooms were opened with to work on (`BreakoutBoard`): nothing, a board each, or the main board, shared. */
    board: BreakoutBoardModeSchema,
    from: z.number(),
    /** Everyone comes back at this time, unless the organizer brings them back sooner. */
    until: z.number(),
    /** The organizer's latest message to every room. */
    message: z.object({ text: z.string(), at: z.number() }).nullable()
  }).nullable(),
  /** Rooms that have closed, oldest first. Each goes into the call's notes. */
  held: z.array(z.object({ rooms: z.array(BreakoutRoomSchema), from: z.number(), to: z.number() }))
});

export type Breakouts = z.infer<typeof BreakoutsSchema>;


/**
 * Who hosts the call (docs: Calls and recordings › Host hand-off): the organizer, or while the organizer is away
 * (their connection dropped, or they left it to someone), someone invited standing in for them. Whoever hosts lets
 * people in, keeps the call's keys moving and takes its notes; only the organizer changes what the notes capture.
 */
export const CallHostSchema = z.object({
  /** The participant who hosts now. Null for the moment between a host's connection dropping and someone taking over. */
  id: z.string().nullable(),
  /** Whoever hosts is standing in for the organizer, who takes the call back by joining again. */
  standIn: z.boolean(),
  /** The organizer, as you see them: whom a stand-in hosts for, even while the organizer isn't in the call. */
  organizer: PersonSchema,
  /**
   * For whoever hosts: who could take over from them, best first. People invited to the call who are in it, never a
   * guest, the main room before breakout rooms, then whoever came first. Empty for everyone else.
   */
  next: z.array(z.string())
});

export type CallHost = z.infer<typeof CallHostSchema>;

/** A share going on in the call: its ID, whose it is (participant ID), and whether the presenter said it goes in the notes. */
export const CallShareSchema = z.object({ id: IDSchema, participant: z.string(), keep: z.boolean() });

export type CallShare = z.infer<typeof CallShareSchema>;


export const CallStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  attention: CallAttentionSchema,
  callId: IDSchema,
  meetingId: IDSchema,
  code: z.string(),
  title: z.string(),
  startedAt: ISODateSchema,
  /** Seconds since the call started. */
  elapsed: z.number(),
  phase: z.enum(['in-call', 'ended']),
  participants: z.array(CallParticipantSchema),
  locked: z.boolean(),
  /**
   * Whether people may point at and mark shared screens (docs: Calls and recordings › Pointing at shared screens): the
   * organizer's switch, on until they turn it off. Pointers and marks go from browser to browser, encrypted end to end.
   */
  pointing: z.boolean(),
  /** The participant the organizer put on everyone's main stage, or null. */
  spotlight: IDSchema.nullable(),
  breakouts: BreakoutsSchema,
  /** What's being captured now and how it got there: the same for everyone in the call. Only the organizer changes it. */
  capture: CaptureStateSchema,
  /** The note this call is writing. */
  notes: z.object({
    /** True once notes have been on at any point, so the call produces a note. */
    everOn: z.boolean(),
    noteId: IDSchema.nullable(),
    /** Server clock start of the current recording segment, including host handoffs. Null before notes begin. */
    segmentStartedAt: ISODateSchema.nullable().default(null),
    recording: RecordingProgressSchema
  }),
  /** People asking to join, for whoever hosts to let in or turn away; empty for everyone else. */
  waiting: z.array(CallAskerSchema),
  /** Encrypted chat message IDs read by this person; empty until admitted. */
  chatRead: z.array(z.string()),
  /** People the organizer rang who aren't in the call, and how each answered; empty for everyone else. */
  ringing: z.array(RungSchema),
  /**
   * Connections that left but are still in the call's group for a moment, while the host's browser takes them
   * out: whose they were, and that person's connection now (`now`) when they're still in the call, back from a reload
   * or moved to another device. Shown as who they are, never as a stranger, and never twice.
   */
  leaving: z.array(z.object({ id: z.string(), seat: z.string(), person: PersonSchema, now: z.string().nullable() })),
  /** Who hosts now: the organizer, or someone standing in while the organizer is away. */
  host: CallHostSchema,
  /** The call's MLS group generation; browsers already in the call rejoin when it changes. */
  generation: z.number(),
  /**
   * What's been said while notes were on, transcribed as the call goes: the latest lines, oldest first, from the part
   * of the call you're in now only. What's said in one breakout room never shows in another, or in the main room.
   */
  transcript: z.array(TranscriptLineSchema),
  /** The shared live notes of the part of the call you're in, written only from what you may read. Nothing for someone waiting to be let in. */
  liveNotes: LiveNotesSchema,
  /** The workspace the call uses, as you may know it. Nothing that names anything for someone waiting to be let in, or who can't open it. */
  workspace: CallWorkspaceSchema,
  /** The board open in the part of the call you're in, as you may know it. Nothing for someone waiting to be let in. */
  board: CallBoardSchema,
  /** The call's timer, the same for everyone in the call, or null while none runs. Nothing for someone waiting to be let in. */
  timer: CallTimerSchema.nullable(),
  notices: z.array(CallNoticeSchema),
  /**
   * The shares going on now that the server knows of, by whose they are (a participant ID; each person shares one
   * screen at a time), and whether each is kept for the notes: only those say they're read for the notes.
   */
  shares: z.array(CallShareSchema),
  /** Only the organizer can turn notes on or off, pause and resume them. */
  isOrganizer: z.boolean(),
  /** You host now (the organizer, or standing in for them): you let people in, mute, remove and lock, and can end the call. */
  isHost: z.boolean(),
  /**
   * Your role in the call as it stands. It can differ from the ticket's: someone signed in whom the organizer let in
   * from the link joined as a guest and is invited now. A guest sees people by name only.
   */
  role: CallRoleSchema
});

export type CallState = z.infer<typeof CallStateSchema>;

/** What the server answers when a share starts: its ID, whether it's kept for the notes, and the call as it is now. */
export const ShareStartedSchema = z.object({ share: IDSchema, keep: z.boolean(), state: CallStateSchema });

export type ShareStarted = z.infer<typeof ShareStartedSchema>;


export const CallEndResultSchema = z.object({
  meetingId: IDSchema,
  /** Present when notes were on at some point. */
  pendingNoteId: IDSchema.nullable(),
  duration: z.number()
});

export type CallEndResult = z.infer<typeof CallEndResultSchema>;
