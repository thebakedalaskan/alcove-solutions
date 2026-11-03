/*
 * Domain models, defined once as zod schemas. Types are inferred from the schemas, and the HTTP
 * client parses every response with them, so nothing crosses the network boundary unchecked.
 * Times are ISO-8601 strings in UTC; durations are seconds.
 */
import { z } from './zod';

export const IDSchema = z.string();
export type ID = z.infer<typeof IDSchema>;
export const ISODateSchema = z.string();
export type ISODate = z.infer<typeof ISODateSchema>;

/**
 * Whether a call writes notes. It's decided when the call is scheduled; during the call only the
 * organizer can change it, and anyone else can ask them to.
 */
export const NotesSettingSchema = z.enum(['on', 'off']);
export type NotesSetting = z.infer<typeof NotesSettingSchema>;

export const PortraitHairSchema = z.enum(['long', 'short', 'bun', 'curly', 'bob', 'wavy', 'side', 'buzz']);
export type PortraitHair = z.infer<typeof PortraitHairSchema>;
/** Appearance for illustrated portraits, used when someone has no photo. */
export const PortraitStyleSchema = z.object({
  bg: z.string(), skin: z.string(), hair: z.string(), shirt: z.string(), style: PortraitHairSchema,
  beard: z.boolean().optional(), glasses: z.boolean().optional(), earrings: z.boolean().optional(),
  /** Colours of the room behind the person when their camera is on. */
  room: z.tuple([z.string(), z.string(), z.string()]).optional()
});
export type PortraitStyle = z.infer<typeof PortraitStyleSchema>;

export const PersonSchema = z.object({
  /** The owner ID for Alcove users; the email address for everyone else. */
  id: IDSchema,
  name: z.string(),
  email: z.string(),
  /** A photo from the person's sign-in provider. Without one the UI draws their portrait. */
  photoUrl: z.string().optional(),
  portrait: PortraitStyleSchema.optional()
});
export type Person = z.infer<typeof PersonSchema>;

/** How someone signed in. Their account, calendar and company directory come from it. */
export const SignInProviderSchema = z.enum(['google', 'microsoft', 'sso']);
export type SignInProvider = z.infer<typeof SignInProviderSchema>;

/** A signed-in session. Absent (null) when signed out. */
export const SessionSchema = z.object({
  user: PersonSchema,
  ownerId: z.string(),
  provider: SignInProviderSchema,
  /** A demo account, with a sample calendar and company directory instead of connected ones. */
  sample: z.boolean(),
  createdAt: ISODateSchema,
  /** The session ends at this time at the latest. */
  expiresAt: ISODateSchema
});
export type Session = z.infer<typeof SessionSchema>;

export const SignInResultSchema = z.object({
  session: SessionSchema,
  /** True the first time this person signs in: the app shows what came with them. */
  isNew: z.boolean()
});
export type SignInResult = z.infer<typeof SignInResultSchema>;

export const PreferencesSchema = z.object({
  /** Whether new calls start with notes on. Each call can still be set when it's scheduled. */
  notesDefault: NotesSettingSchema
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/* ---------- people ---------- */

/** Someone to invite or share with. */
export const PersonSuggestionSchema = z.object({
  person: PersonSchema,
  /** team: your company's directory. met: you've had calls with them. new: an address you typed. */
  source: z.enum(['team', 'met', 'new']),
  onAlcove: z.boolean()
});
export type PersonSuggestion = z.infer<typeof PersonSuggestionSchema>;

/** Your company, from signing in with a work account. */
export const TeamSchema = z.object({
  name: z.string(),
  domain: z.string(),
  members: z.array(z.object({ person: PersonSchema, onAlcove: z.boolean(), invited: z.boolean() }))
});
export type Team = z.infer<typeof TeamSchema>;

/* ---------- meetings ---------- */

export const MeetingStatusSchema = z.enum(['scheduled', 'live', 'ended']);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;
export const MeetingSchema = z.object({
  id: IDSchema,
  title: z.string(),
  startsAt: ISODateSchema,
  endsAt: ISODateSchema,
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** Everyone invited besides the organizer. When notes are on, they all get them. */
  guests: z.array(PersonSchema),
  notes: NotesSettingSchema,
  /** Short code used in the join link, e.g. `kpw-rnzq-hte`. */
  code: z.string(),
  status: MeetingStatusSchema,
  /** Present once the call has happened with notes on. */
  noteId: IDSchema.optional(),
  /** Seconds the call actually lasted, once ended. */
  duration: z.number().optional(),
  /** The call in the organizer's Google Calendar, which sends its invitations. */
  calendarUrl: z.string().url().optional()
});
export type Meeting = z.infer<typeof MeetingSchema>;

/* ---------- calendar ---------- */

/** One of someone's other calendar events (not an Alcove call), shown beside Alcove's own. */
export const CalendarEventSchema = z.object({
  /** The provider's event ID. */
  id: IDSchema,
  title: z.string(),
  startsAt: ISODateSchema,
  endsAt: ISODateSchema,
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** Everyone else invited. */
  guests: z.array(PersonSchema),
  /** The event's own video link and what it is ("Google Meet", "Zoom", ...), when it has one. */
  join: z.object({ url: z.string().url(), label: z.string() }).optional(),
  /** The event in the calendar it came from. */
  calendarUrl: z.string().url()
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarSchema = z.object({
  /** google: connected. sample: a demo account's sample day. none: nothing connected. */
  source: z.enum(['google', 'sample', 'none']),
  /** Signed in with Google without giving calendar access; the app can ask for it. */
  needsAccess: z.boolean(),
  /** The coming week's other events, soonest first. */
  events: z.array(CalendarEventSchema)
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const MeetingInputSchema = z.object({
  title: z.string(),
  startsAt: ISODateSchema,
  durationMinutes: z.number(),
  /** Email addresses. */
  guests: z.array(z.string()),
  notes: NotesSettingSchema
});
export type MeetingInput = z.infer<typeof MeetingInputSchema>;

/** A call that starts now. Everything is optional: a bare call is "<name>'s call" with your default notes setting. */
export const InstantCallInputSchema = z.object({
  title: z.string().optional(),
  guests: z.array(z.string()).optional(),
  notes: NotesSettingSchema.optional()
});
export type InstantCallInput = z.infer<typeof InstantCallInputSchema>;

/* ---------- notes ---------- */

export const SpeakerSchema = z.object({ name: z.string(), person: PersonSchema.optional() });
export type Speaker = z.infer<typeof SpeakerSchema>;

export const TranscriptLineSchema = z.object({
  id: IDSchema,
  /** Seconds into the recording, counting every segment before this one (as the player does). */
  at: z.number(),
  /** Who spoke. Absent when nobody can tell, as in a room recording. */
  speaker: SpeakerSchema.optional(),
  text: z.string()
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

export const ScreenCaptureSchema = z.object({ at: z.number(), by: z.string(), title: z.string(), text: z.string() });
export type ScreenCapture = z.infer<typeof ScreenCaptureSchema>;

/** Someone changing a note's decisions or follow-ups: who, when, what, and what it was before. */
export const ChangeSchema = z.object({
  by: z.object({ name: z.string(), email: z.string() }),
  at: ISODateSchema,
  what: z.enum(['confirmed', 'rejected', 'reopened', 'reworded', 'took-on', 'reassigned', 'due', 'done', 'undone']),
  /** The wording, owner or due date before a change to it, and after. */
  before: z.string().optional(),
  after: z.string().optional()
});
export type Change = z.infer<typeof ChangeSchema>;

/**
 * Something the call settled, as the notes heard it. It stays proposed until someone who has the
 * notes confirms it, or says it wasn't decided.
 */
export const DecisionSchema = z.object({
  id: IDSchema,
  text: z.string(),
  /** When it was said, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  state: z.enum(['proposed', 'confirmed', 'rejected']),
  /** Who confirmed, rejected, reopened or reworded it, oldest first. */
  changes: z.array(ChangeSchema)
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ActionItemSchema = z.object({
  id: IDSchema, text: z.string(),
  /** Who it's for: suggested by the notes, or given to them by someone with the notes. Absent when nobody said. */
  owner: SpeakerSchema.optional(),
  /** The owner said they'll do it. The notes only suggest; nobody but the owner can take it on for them. */
  takenOn: z.boolean(),
  /** When it's due, as said in the call ("Wed", "end of March"). */
  due: z.string().optional(),
  /** When it came up, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  done: z.boolean(),
  /** Who took it on, gave it to someone, changed it or ticked it, oldest first. */
  changes: z.array(ChangeSchema)
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ChapterSchema = z.object({ at: z.number(), title: z.string(), summary: z.string() });
export type Chapter = z.infer<typeof ChapterSchema>;

export const NoteKindSchema = z.enum(['call', 'room']);
export type NoteKind = z.infer<typeof NoteKindSchema>;

/** recording: audio is still arriving. pending: waiting for the notes service. ready: notes written. */
export const NoteStatusSchema = z.enum(['recording', 'pending', 'ready']);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

/** One continuous stretch of recorded audio. Turning notes off and on again starts a new segment. */
export const AudioSegmentSchema = z.object({ index: z.number(), seconds: z.number(), pieces: z.number(), mimeType: z.string() });
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

/** How someone came to have a note: they ran the call, were invited to it, or it was shared with them after. */
export const RecipientRoleSchema = z.enum(['organizer', 'invited', 'shared']);
export type RecipientRole = z.infer<typeof RecipientRoleSchema>;
export const RecipientSchema = z.object({ person: PersonSchema, role: RecipientRoleSchema });
export type Recipient = z.infer<typeof RecipientSchema>;

/**
 * What Alcove checked about a NEAR AI model before it sent the model anything for a note: an Intel TDX
 * confidential VM with NVIDIA GPUs in confidential-computing mode, measured as NEAR AI publishes it, holding
 * the key everything was encrypted to. Hashes identify the evidence; nothing in it is secret.
 */
export const InferenceEvidenceSchema = z.object({
  /** The model as NEAR AI names it, e.g. "z-ai/glm-5.3-flash". */
  model: z.string(),
  /** What it did for the note: transcribed the speech, or wrote the notes. */
  task: z.enum(['transcript', 'notes']),
  /** When Alcove checked the evidence, before sending anything to the key it vouches for. */
  verifiedAt: ISODateSchema,
  /**
   * How requests reached the model. e2ee: NEAR AI's end-to-end encrypted chat, which its gateway passes on
   * without being able to read. ohttp: Oblivious HTTP sealed to the model's own key, which only it can open.
   */
  encryption: z.enum(['e2ee', 'ohttp']),
  /** How each reply was shown to come from the model: signed by its key, or sealed under the request's encryption. */
  reply: z.enum(['signed', 'sealed']),
  /** The model's attested signing key (Ed25519, hex). */
  key: z.string(),
  /** The model's Intel TDX quote: the TCB status Intel's collateral gives it, and the quote's SHA-256. */
  tdx: z.object({ status: z.string(), quote: z.string() }),
  /** The GPUs NVIDIA's attestation service confirmed are in confidential-computing mode. */
  gpu: z.object({ count: z.number(), arch: z.string() }),
  /** SHA-256 of the software configuration (dstack app compose) the model's quote measures. */
  compose: z.string(),
  /** NEAR AI's gateway, checked the same way: its TCB status and configuration hash. */
  gateway: z.object({ status: z.string(), compose: z.string() }),
  /** For signed replies: the model's signature over the exact request and reply, as NEAR AI's Verification Center reads it. */
  receipt: z.object({ completionId: z.string(), signedText: z.string(), signature: z.string() }).optional()
});
export type InferenceEvidence = z.infer<typeof InferenceEvidenceSchema>;

export const NoteSummarySchema = z.object({
  id: IDSchema, kind: NoteKindSchema, status: NoteStatusSchema, title: z.string(), startedAt: ISODateSchema, duration: z.number(),
  /** Everyone who has the notes, organizer first. */
  people: z.array(PersonSchema),
  /** The start of the summary; empty until the notes are written. */
  excerpt: z.string(), openActions: z.number(), totalActions: z.number(), meetingId: IDSchema.optional(),
  /** Present when the note is someone else's and they shared it, or invited you to its call. */
  from: PersonSchema.optional()
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const NoteSchema = NoteSummarySchema.extend({
  recipients: z.array(RecipientSchema),
  summary: z.string(),
  decisions: z.array(DecisionSchema),
  actions: z.array(ActionItemSchema),
  chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema),
  /** What was said while notes were on. Null while the recording is still going. */
  transcript: z.array(TranscriptLineSchema).nullable(),
  suggestedQuestions: z.array(z.string()),
  /** Encrypted audio kept for this note; playable through notes.audioUrl. */
  audio: z.array(AudioSegmentSchema),
  /** The verified private models that transcribed the speech and wrote the notes. Empty when nothing was transcribed. */
  inference: z.array(InferenceEvidenceSchema)
});
export type Note = z.infer<typeof NoteSchema>;

export const OpenActionSchema = ActionItemSchema.extend({ noteId: IDSchema, noteTitle: z.string() });
export type OpenAction = z.infer<typeof OpenActionSchema>;

export const AnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('cite'), at: z.number() })
]);
export type AnswerPart = z.infer<typeof AnswerPartSchema>;

/* ---------- what's running ---------- */

/**
 * What the API says it is, for anyone to check before trusting it. Outside a TEE it says so plainly.
 * Inside one (Intel TDX under dstack) it returns a fresh TDX quote whose report data is
 * SHA-512("alcove-attestation/v1\n" + nonce + "\n" + commit), with the event log a verifier replays to
 * get the app's measurements, and the compose hash those measurements must match.
 */
export const AttestationSchema = z.discriminatedUnion('tee', [
  z.object({ tee: z.literal('none'), nonce: z.string(), build: z.object({ commit: z.string() }) }),
  z.object({
    tee: z.literal('dstack'), nonce: z.string(), build: z.object({ commit: z.string() }),
    reportData: z.string(), quote: z.string(), eventLog: z.string(),
    appId: z.string(), instanceId: z.string(), composeHash: z.string().optional(), osImageHash: z.string().optional()
  })
]);
export type Attestation = z.infer<typeof AttestationSchema>;

/* ---------- this browser's devices ---------- */

/** The microphone, camera and speaker someone chose, remembered in their browser only: never sent anywhere. */
export const DevicePrefsSchema = z.object({ mic: z.string().max(300).optional(), cam: z.string().max(300).optional(), speaker: z.string().max(300).optional() });
export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;

/* ---------- credits ---------- */

export const CreditBalanceSchema = z.object({
  balance: z.number(),
  /** Every credit added to the account so far, so the app can show how much is left. */
  granted: z.number(),
  /** Credits charged per minute of notes or room recording. Calls without notes are free. */
  perMinute: z.number()
});
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;
