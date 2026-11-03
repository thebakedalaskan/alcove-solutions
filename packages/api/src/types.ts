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
  calendarUrl: z.string().url().optional(),
  /** The series it's in: the calls before and after it, whose decisions, open questions and follow-ups carry over. */
  seriesId: IDSchema.optional()
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
  calendarUrl: z.string().url(),
  /** Your series this event continues: it's the next occurrence of a recurring event you've held in Alcove. */
  seriesId: IDSchema.optional()
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

/** Someone changing a note's decisions, open questions or follow-ups: who, when, what, and what it was before. */
export const ChangeSchema = z.object({
  by: z.object({ name: z.string(), email: z.string() }),
  at: ISODateSchema,
  what: z.enum(['confirmed', 'rejected', 'superseded', 'reopened', 'reworded', 'answered', 'took-on', 'reassigned', 'due', 'done', 'undone']),
  /** The wording, owner or due date before a change to it, and after. */
  before: z.string().optional(),
  after: z.string().optional()
});
export type Change = z.infer<typeof ChangeSchema>;

/**
 * Something the call settled, as the notes heard it. It stays proposed until someone who has the
 * notes confirms it, or says it wasn't decided. A confirmed decision can later stop holding
 * (superseded), when a later one replaces it.
 */
export const DecisionSchema = z.object({
  id: IDSchema,
  text: z.string(),
  /** When it was said, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  state: z.enum(['proposed', 'confirmed', 'rejected', 'superseded']),
  /** Who confirmed, rejected, superseded, reopened or reworded it, oldest first. */
  changes: z.array(ChangeSchema)
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * Something the call asked and didn't settle, as the notes heard it. It stays open until someone
 * who has the notes says it was answered.
 */
export const QuestionSchema = z.object({
  id: IDSchema,
  text: z.string(),
  /** When it was asked, in seconds into the recording, if the notes could tell. */
  at: z.number().optional(),
  state: z.enum(['open', 'answered']),
  /** Who said it was answered, reopened or reworded it, oldest first. */
  changes: z.array(ChangeSchema)
});
export type Question = z.infer<typeof QuestionSchema>;

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
  /** What the call asked and didn't settle. */
  questions: z.array(QuestionSchema),
  actions: z.array(ActionItemSchema),
  chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema),
  /** What was said while notes were on. Null while the recording is still going. */
  transcript: z.array(TranscriptLineSchema).nullable(),
  suggestedQuestions: z.array(z.string()),
  /** Encrypted audio kept for this note; playable through notes.audioUrl. */
  audio: z.array(AudioSegmentSchema),
  /** The series its call is in, when it's in one: see series.get. */
  seriesId: IDSchema.optional()
});
export type Note = z.infer<typeof NoteSchema>;

export const OpenActionSchema = ActionItemSchema.extend({ noteId: IDSchema, noteTitle: z.string() });
export type OpenAction = z.infer<typeof OpenActionSchema>;

export const AnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('cite'), at: z.number() })
]);
export type AnswerPart = z.infer<typeof AnswerPartSchema>;

/* ---------- series: what carries over from one call to the next ---------- */

/*
 * A series is calls that follow on from each other: the occurrences of one recurring Google
 * Calendar event held in Alcove, or calls scheduled as the next one. What carries over is put
 * together for whoever asks, from the notes they have, each time they ask, and never kept: being
 * invited to one call in a series opens nothing from the others.
 */

/** One call in a series whose notes you have. */
export const SeriesNoteSchema = z.object({
  id: IDSchema, title: z.string(), startedAt: ISODateSchema, duration: z.number(), status: NoteStatusSchema,
  /** For the organizer: the call the note is from, to schedule the next one after it. */
  meetingId: IDSchema.optional(),
  /** Present when the note is someone else's: the organizer, who gave it to you. */
  from: PersonSchema.optional()
});
export type SeriesNote = z.infer<typeof SeriesNoteSchema>;

/** A decision from one of the series' notes (`noteId`, one of `Series.notes`). */
export const CarriedDecisionSchema = DecisionSchema.extend({ noteId: IDSchema });
export type CarriedDecision = z.infer<typeof CarriedDecisionSchema>;
/** How long something has gone unsettled: the later calls (whose notes you have) it stayed open through. Stale from two. */
const Carried = { noteId: IDSchema, later: z.number(), stale: z.boolean() };
export const CarriedQuestionSchema = QuestionSchema.extend(Carried);
export type CarriedQuestion = z.infer<typeof CarriedQuestionSchema>;
export const CarriedActionSchema = ActionItemSchema.extend(Carried);
export type CarriedAction = z.infer<typeof CarriedActionSchema>;

export const SeriesSchema = z.object({
  id: IDSchema,
  /** The next call's title, or the latest one's. */
  title: z.string(),
  /** Whose calls they are. */
  organizer: PersonSchema,
  isOrganizer: z.boolean(),
  /** For the organizer: the next call in the series, when one is scheduled in Alcove. */
  next: MeetingSchema.optional(),
  /** For the organizer: the series follows a recurring Google Calendar event, so its next call is the next occurrence there. */
  recurring: z.boolean(),
  /** The calls in the series whose notes you have, newest first. Everything below comes from these alone. */
  notes: z.array(SeriesNoteSchema),
  /** Confirmed decisions, ones that no longer hold, and ones nobody has confirmed yet, newest call first. Never ones people said weren't decided. */
  decisions: z.array(CarriedDecisionSchema),
  /** Questions nobody has said were answered yet. */
  questions: z.array(CarriedQuestionSchema),
  /** Follow-ups not done yet, and ones done since the latest call started. */
  actions: z.array(CarriedActionSchema)
});
export type Series = z.infer<typeof SeriesSchema>;

/** An answer about a series: its text, then the calls it comes from, with the moment in each when it can tell. */
export const SeriesAnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('source'), noteId: IDSchema, title: z.string(), startedAt: ISODateSchema, at: z.number().optional() })
]);
export type SeriesAnswerPart = z.infer<typeof SeriesAnswerPartSchema>;

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
