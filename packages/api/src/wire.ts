/*
 * HTTP wire shapes shared by @alcove/api-http and the server. These are transport details, not
 * domain types: the app never sees them.
 */
import { z } from './zod';
import { BoardNewSchema, BoardObjectIdSchema, BoardSavedSchema, BoardTimerMinutesSchema, BoardVotesEachSchema, BreakoutBoardSchema } from './callBoards';
import { PlayMediaSchema, PlayPositionSchema, PresentKindSchema, PresentSectionSchema } from './callWorkspace';
import { CaptureDevicePartSchema } from './capture';
import { CallPlaceSchema } from './live';
import { CatchUpRangeSchema } from './catchup';
import { CaptionLanguageSchema, IDSchema, ISODateSchema, RsvpSchema, isTimeZone } from './types';
import { RingReplySchema } from './rings';
import { DocumentRoleSchema, ItemIdSchema } from './workspaces';
/**
 * Providers that still sign in a demo identity until they're connected: Microsoft is always Art
 * Vandelay, and single sign-on is whoever's work email is typed. Google is real: the browser goes
 * to `AlcoveApi.auth.signInUrl('google')` instead.
 */
export const DemoProviderSchema = z.enum(['microsoft', 'sso']);
export type DemoProvider = z.infer<typeof DemoProviderSchema>;

export const SignInBodySchema = z.object({
  provider: DemoProviderSchema,
  /** The work email typed for single sign-on. */
  email: z.string().trim().max(254).optional()
});
export type SignInBody = z.infer<typeof SignInBodySchema>;

/** Search terms travel in a POST body so they never appear in URLs or access logs. */
export const PeopleSearchBodySchema = z.object({ query: z.string().max(200) });
export const TeamInviteBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50) });
/**
 * Sharing notes: up to 50 addresses, and the group's name when they're one of the sharer's groups
 * (the app sends the group's addresses; the group itself stays in the sharer's preferences).
 */
export const ShareInputSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50),
  group: z.string().trim().min(1).max(40).optional()
});

/**
 * Words people type for a note: on one line, whitespace collapsed, so nothing typed can pass for another line of a
 * transcript or a list where a prompt reads it.
 */
const oneLine = (max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(max));

/** One state change in a call, sent as POST /calls/:id/actions. The server answers with the new CallState. */
const CallStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notes'), on: z.boolean() }),
  /** The organizer holds every kind of capture, while notes are on, until they resume. */
  z.object({ type: z.literal('pause') }),
  /** The organizer carries on after a pause, on a new segment. Nothing else resumes it. */
  z.object({ type: z.literal('resume') }),
  /** Anyone in the call but the organizer asks for notes while they're off or paused (up), or takes the ask back. */
  z.object({ type: z.literal('request-notes'), up: z.boolean() }),
  /** The organizer says not now to an ask for notes, and whoever asked is told. Saying yes is turning notes on, or resuming. */
  z.object({ type: z.literal('decline-notes'), requestId: z.string().min(1).max(64) }),
  /** The host's browser says what it can't capture now (none, when it can again): everyone sees it, so nobody is told they're captured when they aren't. */
  z.object({ type: z.literal('unavailable'), parts: z.array(CaptureDevicePartSchema).max(2) }),
  /** The organizer has shared screens read for the notes, or stops it. Only while notes are on or paused; turning notes off stops it too. */
  z.object({ type: z.literal('screens'), on: z.boolean() }),
  /** Anyone in the call: a raised hand, which everyone sees. */
  z.object({ type: z.literal('hand'), up: z.boolean() }),
  /** Anyone in the call: whether others may point at and mark what they share. On until they turn it off. */
  z.object({ type: z.literal('others-point'), on: z.boolean() }),
  /** Anyone in the call who gets the notes: ticks a follow-up of the live notes of the part of the call they're in, or takes the tick back. Done for everyone there. */
  z.object({ type: z.literal('follow-up'), id: z.string().min(1).max(64), done: z.boolean() }),
  /** Anyone in the call who gets the notes: adds a follow-up nobody said to the part of the call they're in, in their own words, for themselves. Shared and ticked like the rest, and it goes into the note. */
  z.object({ type: z.literal('follow-up-add'), text: oneLine(300) }),
  /** The organizer: whether anyone may point at and mark shared screens in this call. On until they turn it off. */
  z.object({ type: z.literal('pointing'), on: z.boolean() }),
  /**
   * The organizer rings teammates, or people invited who've said yes, into the call: a card on whatever page they have open, for 45 seconds.
   * Everyone rung is added to the invite, so they get the notes and come in without asking. Ringing someone again starts over.
   */
  z.object({ type: z.literal('ring'), emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(20) }),
  /** The organizer stops ringing someone: their card goes, and so does their arch. They stay on the invite. */
  z.object({ type: z.literal('stop-ring'), ringId: z.string().min(1).max(64) }),
  /** Turns away someone asking to join. Letting someone in is the host's browser adding them to the call's MLS group. */
  z.object({ type: z.literal('deny'), identity: z.string().min(1).max(64) }),
  /* The organizer's host controls. Mute has no remote unmute; remove only disconnects; lock keeps everyone new out. */
  z.object({ type: z.literal('mute'), identity: z.string().min(1).max(64), trackSid: z.string().min(1).max(64) }),
  z.object({ type: z.literal('remove'), identity: z.string().min(1).max(64) }),
  z.object({ type: z.literal('lock'), on: z.boolean() }),
  /** Puts someone in the call on everyone's main stage, or nobody. */
  z.object({ type: z.literal('spotlight'), participantId: z.string().max(64).nullable() }),
  z.object({
    type: z.literal('rooms-open'),
    rooms: z.array(z.object({ name: z.string().trim().min(1).max(40), emails: z.array(z.string().trim().toLowerCase().max(254)).max(50) })).min(2).max(8),
    minutes: z.number().int().min(1).max(60),
    /** What the rooms have to work on: the panel's Board row. */
    board: BreakoutBoardSchema
  }),
  z.object({ type: z.literal('rooms-close') }),
  z.object({ type: z.literal('rooms-message'), text: z.string().trim().min(1).max(300) }),
  /** The organizer going to one of the open rooms, or back to the main room (null): the people in that room see and hear them. */
  z.object({ type: z.literal('rooms-visit'), roomId: z.string().max(64).nullable() }),
  z.object({ type: z.literal('rooms-rename'), roomId: z.string().max(64), name: z.string().trim().min(1).max(40) }),
  /** Sends an invited person to another open room, or back to the main room (null). Their keys move with them: out of the old room's group, into the new one's. */
  z.object({ type: z.literal('rooms-move'), email: z.string().trim().toLowerCase().max(254), roomId: z.string().max(64).nullable() }),
  /** The organizer pausing notes in one open room while the call's are on, or carrying on there: the call's notes are unchanged. */
  z.object({ type: z.literal('rooms-pause'), roomId: z.string().max(64), paused: z.boolean() }),
  /**
   * Anyone in the call, opening Workspace: the first time, the call's home is settled, with the call's folder in it, and the
   * next call in a series gets its agenda. `timeZone`, where the browser is: the day a new home and folder are named after.
   */
  z.object({ type: z.literal('workspace-open'), timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.').optional() }),
  /**
   * The organizer has everyone view and edit a workspace they can edit in, or the call's home again. Its notes and transcript
   * still go to its home. Being organizer opens nothing, so anyone not in it sees that it's private.
   */
  z.object({ type: z.literal('workspace-set'), workspaceId: ItemIdSchema }),
  /** The organizer makes a workspace, with just them in it, and everyone views it. It's named after the call unless it's given a name. */
  z.object({ type: z.literal('workspace-new'), name: z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(120)).optional() }),
  /** Anyone who can open it brings a document in the call's workspace to the call, or takes it off. */
  z.object({ type: z.literal('workspace-bring'), documentId: ItemIdSchema, brought: z.boolean() }),
  /** Anyone in the call but the organizer asks to see the workspace, or takes the ask back. It names nothing. */
  z.object({ type: z.literal('workspace-ask'), up: z.boolean() }),
  /** The organizer answers an ask by opening one document to whoever asked: a seat entry, until the call ends or Share takes it back. */
  z.object({ type: z.literal('workspace-grant'), askId: z.string().min(1).max(64), documentId: ItemIdSchema, role: DocumentRoleSchema }),
  /** The organizer says not now to an ask, and whoever asked is told. */
  z.object({ type: z.literal('workspace-decline'), askId: z.string().min(1).max(64) }),
  /** Anyone who can open it presents a document or board in the call's workspace to the part of the call they're in. */
  z.object({ type: z.literal('present-start'), kind: PresentKindSchema, id: ItemIdSchema, section: PresentSectionSchema.default(0) }),
  /** Whoever started it, or the organizer. */
  z.object({ type: z.literal('present-move'), section: PresentSectionSchema }),
  z.object({ type: z.literal('present-stop') }),
  /** Anyone who can open the document plays a video in it for the part of the call they're in. */
  z.object({ type: z.literal('play-start'), documentId: ItemIdSchema, mediaId: PlayMediaSchema, positionMs: PlayPositionSchema.default(0) }),
  /** Whoever started it, or the organizer: it holds where it says, for everyone. */
  z.object({ type: z.literal('play-pause'), positionMs: PlayPositionSchema }),
  z.object({ type: z.literal('play-resume') }),
  z.object({ type: z.literal('play-seek'), positionMs: PlayPositionSchema }),
  z.object({ type: z.literal('play-stop') }),
  /** Whoever opened the board open here, or the organizer: it closes for everyone there, and nothing is deleted. */
  z.object({ type: z.literal('board-close') }),
  /** Anyone in the part of the call the ideas are from: they were added to the board, or put aside, so they go for everyone there. */
  z.object({ type: z.literal('board-ideas-done'), ids: z.array(IDSchema).min(1).max(20) }),
  /**
   * The timer on the board open here, the same for everyone there: 3, 5 or 10 minutes from now, from anyone who can edit the
   * board. While one is still running, only whoever started it or the organizer can start it over. Null stops it, which is for
   * them too.
   */
  z.object({ type: z.literal('board-timer'), minutes: BoardTimerMinutesSchema.nullable() })
]);
/**
 * A vote on the board open here, a step at a time. Starting one, and voting, are for anyone who can edit the board; ending it
 * and clearing it after are for whoever started it, or the organizer.
 */
const BoardVoteStepSchema = z.discriminatedUnion('step', [
  /** On a frame, or with no frame on every sticky on the board, with 3, 5 or 10 votes each. Never on top of another. */
  z.object({ type: z.literal('board-vote'), step: z.literal('start'), frame: BoardObjectIdSchema.nullable(), per: BoardVotesEachSchema }),
  /** A vote for a sticky it's on, while it's on: one a sticky, up to your votes each. Only you are told. */
  z.object({ type: z.literal('board-vote'), step: z.literal('cast'), sticky: BoardObjectIdSchema }),
  /** Your vote for that sticky taken back, while it's on. */
  z.object({ type: z.literal('board-vote'), step: z.literal('take-back'), sticky: BoardObjectIdSchema }),
  /** Everyone is told every count at once. */
  z.object({ type: z.literal('board-vote'), step: z.literal('end') }),
  /** Once it's ended: the results go, for everyone. */
  z.object({ type: z.literal('board-vote'), step: z.literal('done') })
]);
/**
 * Anyone invited opens a board for the part of the call they're in, a new one or a saved one. Two shapes of one action, and a
 * vote's steps, so they sit beside the union that tells actions apart by `type`.
 */
export const CallActionSchema = z.union([CallStepSchema, BoardNewSchema.extend({ type: z.literal('board-open') }), BoardSavedSchema.extend({ type: z.literal('board-open') }), BoardVoteStepSchema]);
export type CallAction = z.infer<typeof CallActionSchema>;

/*
 * End-to-end encrypted calls (docs: Calls and recordings › End-to-end encryption). Every browser in a call is
 * an MLS client; the API only orders and relays MLS messages, which it can't read. Bodies are base64url.
 */
export const Mls = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).max(max);
/** A connection's participant ID in a call: its random LiveKit identity. */
export const CallIdentity = z.string().regex(/^p_[A-Za-z0-9_-]{22}$/);
/** Joining by link: devices to start with, a name for guests, and this browser's MLS key package. */
export const CallJoinBodySchema = z.object({
  mic: z.boolean(), cam: z.boolean(), name: z.string().max(200).optional(),
  /** This connection's random identity, chosen by the browser because its key package names it. */
  identity: CallIdentity,
  keyPackage: Mls(8192),
  /** The pass from this browser's last connection to the call, if it had one: someone let in before is let in again without asking. */
  previous: z.string().max(2000).optional()
});
/** What watching the live notes did: true when this look refreshed them, so a browser reads the call again straight away. */
export const NotesWatchedSchema = z.object({ refreshed: z.boolean() });
/** What looking for ideas from the call did: true when this look found some, so a browser reads the call again straight away. */
export const IdeasWatchedSchema = z.object({ found: z.boolean() });
/** The host's browser, adding people to one part of the call's group and taking people out of it: the commit, the welcome for anyone added, and who that was. */
export const CallCommitBodySchema = z.object({
  generation: z.number().int().nonnegative(),
  /** Which part of the call's group: `main`, or a breakout room's ID. */
  group: CallPlaceSchema,
  /** The epoch the commit was made in; the API takes each group's commits in order, one per epoch. */
  epoch: z.number().int().nonnegative(),
  commit: Mls(1_000_000),
  welcome: Mls(1_000_000).optional(),
  added: z.array(CallIdentity).max(100),
  removed: z.array(CallIdentity).max(100)
});
/** An MLS application message (chat), from someone in the group of the part of the call they're in. */
export const CallMessageBodySchema = z.object({ generation: z.number().int().nonnegative(), group: CallPlaceSchema, epoch: z.number().int().nonnegative(), message: Mls(65_536) });
/** A fresh key package from someone already in the call who's on their way into a group: a new generation (the connection that hosts changed), or another part of the call. */
export const CallKeyPackageBodySchema = z.object({ generation: z.number().int().nonnegative(), keyPackage: Mls(8192) });
/** Coming back in after being taken out while away (`mls/back`): for this generation. Keys follow, as the log asks for them. */
export const CallBackBodySchema = z.object({ generation: z.number().int().nonnegative() });
/** Whoever hosts, leaving and handing the call to someone invited who's in it: `to`, by participant ID. */
export const CallHandOffBodySchema = z.object({ to: CallIdentity });
/**
 * Leaving a call. Anyone but whoever hosts just leaves. Whoever hosts ends it for everyone, unless `end` is false: then
 * they hand the call to whoever's next (refused when nobody can take it), so a page going away never ends a call.
 */
/** `onPurpose`: someone chose to go, and isn't a page going away that may come back: what they started stops with them. */
export const CallLeaveBodySchema = z.object({ end: z.boolean().default(true), onPurpose: z.boolean().default(false) });

export const RecordingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(160) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') })
]);
export type RecordingAction = z.infer<typeof RecordingActionSchema>;

/**
 * Where audio goes in the recording, in these headers: its segment, a piece's sequence number, where each
 * piece or clip starts in its segment (`at`, in milliseconds with pauses not counted) and its length. A call's
 * speech also says whose it is (`speaker`: a participant ID) and how long before the request it began (`ago`,
 * in ms), so the server can place it where its speaker was when it was said.
 */
export const AUDIO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', at: 'x-alcove-at-ms', duration: 'x-alcove-duration-ms', speaker: 'x-alcove-speaker', ago: 'x-alcove-ago-ms' } as const;
/** Mutations carry an operation ID so a retried request never applies twice (docs: Network and API contract). */
export const OPERATION_HEADER = 'x-alcove-operation';
export const MAX_AUDIO_PIECE_BYTES = 2 * 1024 * 1024;
/** How many of the newest transcript lines a live call or room recording carries. */
export const LIVE_TRANSCRIPT_LINES = 200;
/** A transcript clip: at most 30 seconds of 16 kHz mono 16-bit WAV. */
export const MAX_TRANSCRIPT_CLIP_MS = 30_000;
export const MAX_TRANSCRIPT_CLIP_BYTES = 44 + MAX_TRANSCRIPT_CLIP_MS * 32;
/*
 * Shared screens (docs: Calls and recordings › Shared screens). The presenter's own browser sends a frame of its own
 * share, as JPEG bytes, when the screen has changed: which share it is (`share`, the share's LiveKit track ID) and how
 * long ago it was taken (`age`, in ms), so it's placed where it was on screen even if sending it took a moment.
 */
export const FRAME_HEADERS = { share: 'x-alcove-share', age: 'x-alcove-age-ms' } as const;
/**
 * What comes with a line of a call's recording, beside its audio (`CallSession.hear`): where in the audio the line starts
 * and how long it lasts, in seconds.
 */
export const HEARD_HEADERS = { from: 'x-alcove-heard-from', seconds: 'x-alcove-heard-seconds' } as const;
/** A frame's JPEG, at most this big. Browsers send them at most 1600 pixels across, which is far smaller. */
export const MAX_FRAME_BYTES = 1024 * 1024;
/** How old a frame can say it is when it arrives: older ones are placed as if taken this long ago. */
export const MAX_FRAME_AGE_MS = 30_000;
/** A share: the LiveKit track ID of someone's shared screen, as LiveKit names tracks. */
export const ShareIdSchema = z.string().regex(/^TR_[A-Za-z0-9]{2,64}$/);
/** The presenter's browser says one of its shares ended, so the last frame's stretch ends there too. */
export const ShareEndedBodySchema = z.object({ share: ShareIdSchema });

/** Asking about a call: the question travels in the body. */
export const AskBodySchema = z.object({ question: z.string().trim().min(1).max(500) });

/** Saying the notes got a later call wrong, or taking that back. */
export const RevisitPatchSchema = z.object({ dismissed: z.boolean() });
export type RevisitPatch = z.infer<typeof RevisitPatchSchema>;

/** Asking across a series: the question, and the asker's time zone, which the calls' dates are read in. */
export const SeriesAskBodySchema = AskBodySchema.extend({ timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.') });
/** The words someone read when they agreed to them. If they've changed since, nothing they read is what they'd be agreeing to. */
const SeenWords = z.object({ text: z.string().max(2000) });
/**
 * A change to a decision: confirm it, say it wasn't decided, put it back to proposed, reword it, say a confirmed one no
 * longer holds (superseded), or (`dispute`) say it wasn't decided as someone who can't reject it, or take that back.
 * Rewording a confirmed decision puts it back to proposed, unless the organizer confirms the new words in the same change.
 * Confirming says what was read (`seen`), and is refused if the decision says something else by then.
 */
export const DecisionPatchSchema = z.object({
  state: z.enum(['proposed', 'confirmed', 'rejected', 'superseded']).optional(),
  text: oneLine(300).optional(),
  dispute: z.boolean().optional(),
  seen: SeenWords.optional()
}).refine((p) => p.state !== undefined || p.text !== undefined || p.dispute !== undefined, 'Nothing to change.')
  .refine((p) => p.state !== 'confirmed' || p.text !== undefined || p.seen !== undefined, 'Say what you read.');
export type DecisionPatch = z.infer<typeof DecisionPatchSchema>;

/** A change to an open question: say it was answered, open it again, or reword it. */
export const QuestionPatchSchema = z.object({
  state: z.enum(['open', 'answered']).optional(),
  text: oneLine(300).optional()
}).refine((p) => p.state !== undefined || p.text !== undefined, 'Nothing to change.');
export type QuestionPatch = z.infer<typeof QuestionPatchSchema>;

/** Saying whether you're coming to a call you're invited to. */
export const RsvpBodySchema = z.object({ answer: RsvpSchema });
/**
 * When people are busy, between two times. Addresses travel in the body so they never appear in URLs or access logs.
 * `timeZone` is where the person asking is, which is where an all-day event without a zone of its own falls and where a
 * demo account's made-up week keeps working hours: a name this server doesn't know reads as none, and none as UTC.
 */
export const BusyBodySchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().max(254)).max(300), from: ISODateSchema, to: ISODateSchema,
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.').optional().catch(undefined)
});
/** Picking one of the times a call offers: anyone with the link can, once. */
export const PickTimeBodySchema = z.object({ at: ISODateSchema });
/** Answering a ring. */
export const RingAnswerBodySchema = z.object({ reply: RingReplySchema });

/** Scheduling the next call in a series: when it starts (the app sends the same clock time a week on). */
export const NextCallBodySchema = z.object({ startsAt: z.string().max(40) });

/**
 * A change to a follow-up. Only the person it's for can take it on (`takeOn`: "I'll do it"). The rest follows `grants.ts`.
 * Taking something on, or giving it to yourself, says what was read (`seen`), its words and its date: agreeing to something
 * that's since become something else is refused.
 */
export const ActionPatchSchema = z.object({
  done: z.boolean().optional(),
  takeOn: z.literal(true).optional(),
  /** Give it to someone who has the notes, by email address, or to nobody: from the person it's for, that's "Not mine". */
  owner: z.string().trim().toLowerCase().max(254).nullable().optional(),
  due: z.string().trim().max(40).nullable().optional(),
  text: oneLine(300).optional(),
  seen: SeenWords.extend({ due: z.string().max(100).nullable() }).optional()
}).refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to change.');
export type ActionPatch = z.infer<typeof ActionPatchSchema>;

/** The most lines someone can pick as what a decision or follow-up they propose rests on. */
export const MAX_PROPOSAL_LINES = 3;
/**
 * Someone with the notes adding a decision the notes didn't hear: its exact words, the lines it rests on, and the
 * breakout room's section it goes in (the call's, without one). It starts as proposed. This is the only way in: nothing
 * reaches the shared notes unless someone sends it here themselves.
 */
export const DecisionProposalSchema = z.object({
  text: oneLine(300),
  lines: z.array(z.string().min(1).max(64)).max(MAX_PROPOSAL_LINES).optional(),
  room: z.string().min(1).max(64).optional()
});
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;
/** Someone with the notes adding a follow-up: who it's for (someone who has the notes, who takes it on themselves) and when it's due. */
export const ActionProposalSchema = DecisionProposalSchema.extend({
  owner: z.string().trim().toLowerCase().max(254).optional(),
  due: z.string().trim().min(1).max(40).optional()
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

/**
 * A correction to a line of a written note's transcript: its words, who said it (someone from the call, by their
 * `Person.id`, or null when nobody can tell), or that it's right as it was heard (`confirm`).
 */
export const LinePatchSchema = z.object({
  text: oneLine(1000).optional(),
  speaker: z.string().min(1).max(254).nullable().optional(),
  confirm: z.literal(true).optional()
}).refine((p) => p.text !== undefined || p.speaker !== undefined || p.confirm !== undefined, 'Nothing to change.');
export type LinePatch = z.infer<typeof LinePatchSchema>;

/** Captions in another language: which live transcript lines, and into what. */
export const TranslateBodySchema = z.object({ language: CaptionLanguageSchema, lines: z.array(z.string().max(64)).min(1).max(20) });

/** Catching up during a call: which stretch of it to read. */
export const CatchUpBodySchema = z.object({ range: CatchUpRangeSchema });
/** Asking about a call so far: the question, and which stretch of the call to answer from. */
export const AskSoFarBodySchema = AskBodySchema.extend({ range: CatchUpRangeSchema });

/* ---------- logging ---------- */
/** Every response carries this header; error bodies repeat it as `requestId`. Quote it when reporting a problem. */
export const REQUEST_ID_HEADER = 'x-request-id';
const ClientLogValueSchema = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
/**
 * A warning or error the browser reports so it lands in the server log next to the request it came
 * from. Codes, names, sizes and states only: never titles, names, chat, notes or keys.
 */
export const ClientLogEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  msg: z.string().min(1).max(200),
  at: z.string().max(40),
  context: z.record(z.string().max(40), ClientLogValueSchema).refine((r) => Object.keys(r).length <= 30, 'Too many fields.').default({})
});
export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;
export const ClientLogBatchSchema = z.object({ entries: z.array(ClientLogEntrySchema).min(1).max(20) });
