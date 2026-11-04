/*
 * HTTP wire shapes shared by @alcove/api-http and the server. These are transport details, not
 * domain types: the app never sees them.
 */
import { z } from './zod';
import { CaptionLanguageSchema } from './types';
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
export const ShareBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50) });

/** One state change in a call, sent as POST /calls/:id/actions. The server answers with the new CallState. */
export const CallActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notes'), on: z.boolean() }),
  /** The organizer holds every kind of capture, while notes are on, until they resume. */
  z.object({ type: z.literal('pause') }),
  /** The organizer carries on after a pause, on a new segment. Nothing else resumes it. */
  z.object({ type: z.literal('resume') }),
  /** Anyone in the call but the organizer asks for notes while they're off or paused (up), or takes the ask back. */
  z.object({ type: z.literal('request-notes'), up: z.boolean() }),
  /** The organizer says not now to an ask for notes, and whoever asked is told. Saying yes is turning notes on, or resuming. */
  z.object({ type: z.literal('decline-notes'), requestId: z.string().min(1).max(64) }),
  /** Anyone in the call: a raised hand, which everyone sees. */
  z.object({ type: z.literal('hand'), up: z.boolean() }),
  /** Turns away someone asking to join. Letting someone in is the organizer's browser adding them to the call's MLS group. */
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
    minutes: z.number().int().min(1).max(60)
  }),
  z.object({ type: z.literal('rooms-close') }),
  z.object({ type: z.literal('rooms-message'), text: z.string().trim().min(1).max(300) }),
  /** The organizer going to one of the open rooms, or back to the main room (null): the people in that room see and hear them. */
  z.object({ type: z.literal('rooms-visit'), roomId: z.string().max(64).nullable() })
]);
export type CallAction = z.infer<typeof CallActionSchema>;

/*
 * End-to-end encrypted calls (docs: Calls and recordings › End-to-end encryption). Every browser in a call is
 * an MLS client; the API only orders and relays MLS messages, which it can't read. Bodies are base64url.
 */
const Mls = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).max(max);
const CallIdentity = z.string().regex(/^p_[A-Za-z0-9_-]{22}$/);
/** Joining by link: devices to start with, a name for guests, and this browser's MLS key package. */
export const CallJoinBodySchema = z.object({
  mic: z.boolean(), cam: z.boolean(), name: z.string().max(200).optional(),
  /** This connection's random identity, chosen by the browser because its key package names it. */
  identity: CallIdentity,
  keyPackage: Mls(8192),
  /** The pass from this browser's last connection to the call, if it had one: someone let in before is let in again without asking. */
  previous: z.string().max(2000).optional()
});
/** The organizer's browser, adding and removing people: the commit, the welcome for anyone added, and who that was. */
export const CallCommitBodySchema = z.object({
  generation: z.number().int().nonnegative(),
  /** The epoch the commit was made in; the API takes commits in order, one per epoch. */
  epoch: z.number().int().nonnegative(),
  commit: Mls(1_000_000),
  welcome: Mls(1_000_000).optional(),
  added: z.array(CallIdentity).max(100),
  removed: z.array(CallIdentity).max(100)
});
/** An MLS application message (chat), from anyone in the call's group. */
export const CallMessageBodySchema = z.object({ generation: z.number().int().nonnegative(), epoch: z.number().int().nonnegative(), message: Mls(65_536) });
/** A fresh key package for a new group generation (after the organizer's connection changed), from someone already in the call. */
export const CallKeyPackageBodySchema = z.object({ generation: z.number().int().nonnegative(), keyPackage: Mls(8192) });

export const RecordingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(160) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') })
]);
export type RecordingAction = z.infer<typeof RecordingActionSchema>;

/**
 * Audio pieces and transcript clips travel as raw bytes with their position in these headers: a
 * piece by its sequence number, a clip by where it starts in its segment.
 */
export const AUDIO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', start: 'x-alcove-start-ms', duration: 'x-alcove-duration-ms' } as const;
/** Mutations carry an operation ID so a retried request never applies twice (docs: Network and API contract). */
export const OPERATION_HEADER = 'x-alcove-operation';
export const MAX_AUDIO_PIECE_BYTES = 2 * 1024 * 1024;
/** A transcript clip: at most 30 seconds of 16 kHz mono 16-bit WAV. */
export const MAX_TRANSCRIPT_CLIP_MS = 30_000;
export const MAX_TRANSCRIPT_CLIP_BYTES = 44 + MAX_TRANSCRIPT_CLIP_MS * 32;
/** Asking about a call: the question travels in the body. */
export const AskBodySchema = z.object({ question: z.string().trim().min(1).max(500) });

/** Whether dates can be read in `name`: a time zone the runtime knows, such as "Europe/London". Anything else throws a RangeError. */
function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
/** Asking across a series: the question, and the asker's time zone, which the calls' dates are read in. */
export const SeriesAskBodySchema = AskBodySchema.extend({ timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.') });
/**
 * A change to a decision: confirm it, say it wasn't decided, put it back to proposed, reword it, or
 * say a confirmed one no longer holds (superseded).
 */
export const DecisionPatchSchema = z.object({
  state: z.enum(['proposed', 'confirmed', 'rejected', 'superseded']).optional(),
  text: z.string().trim().min(1).max(300).optional()
}).refine((p) => p.state !== undefined || p.text !== undefined, 'Nothing to change.');
export type DecisionPatch = z.infer<typeof DecisionPatchSchema>;

/** A change to an open question: say it was answered, open it again, or reword it. */
export const QuestionPatchSchema = z.object({
  state: z.enum(['open', 'answered']).optional(),
  text: z.string().trim().min(1).max(300).optional()
}).refine((p) => p.state !== undefined || p.text !== undefined, 'Nothing to change.');
export type QuestionPatch = z.infer<typeof QuestionPatchSchema>;

/** Scheduling the next call in a series: when it starts (the app sends the same clock time a week on). */
export const NextCallBodySchema = z.object({ startsAt: z.string().max(40) });

/** A change to a follow-up. Only its owner can take it on; anyone who has the notes can do the rest. */
export const ActionPatchSchema = z.object({
  done: z.boolean().optional(),
  takeOn: z.literal(true).optional(),
  /** Give it to someone who has the notes, by email address, or to nobody. */
  owner: z.string().trim().toLowerCase().max(254).nullable().optional(),
  due: z.string().trim().max(40).nullable().optional(),
  text: z.string().trim().min(1).max(300).optional()
}).refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to change.');
export type ActionPatch = z.infer<typeof ActionPatchSchema>;

/** Captions in another language: which live transcript lines, and into what. */
export const TranslateBodySchema = z.object({ language: CaptionLanguageSchema, lines: z.array(z.string().max(64)).min(1).max(20) });

/** Catching up during a call: how far back to read, or the whole call. */
export const CatchUpBodySchema = z.object({ minutes: z.number().int().min(1).max(600).optional() });

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
