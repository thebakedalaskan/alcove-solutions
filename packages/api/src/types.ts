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

/** Languages notes can be written in. `call` writes them in the language the call was spoken in. */
export const NOTES_LANGUAGES = ['call', 'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'zh', 'ko', 'hi', 'ar'] as const;
export const NotesLanguageSchema = z.enum(NOTES_LANGUAGES);
export type NotesLanguage = z.infer<typeof NotesLanguageSchema>;

export const SummaryLengthSchema = z.enum(['short', 'detailed']);
export type SummaryLength = z.infer<typeof SummaryLengthSchema>;

export const NotificationPrefsSchema = z.object({
  /** Minutes before a call to remind: 0 is off. */
  beforeCall: z.union([z.literal(0), z.literal(1), z.literal(5)]),
  notesReady: z.boolean(),
  sharedWithYou: z.boolean(),
  notesRequested: z.boolean(),
  followUpDue: z.boolean()
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

const allUnique = (items: string[]): boolean => new Set(items).size === items.length;

/** The longest a group's name can be, the most people in a group, and the most groups someone can have. */
export const MAX_GROUP_NAME = 40;
export const MAX_GROUP_PEOPLE = 50;
export const MAX_GROUPS = 30;

/** A named set of email addresses to share notes with in one step. */
export const GroupSchema = z.object({
  id: IDSchema,
  name: z.string().trim().min(1).max(MAX_GROUP_NAME),
  emails: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(MAX_GROUP_PEOPLE)
    .refine(allUnique, 'Addresses must be unique')
});
export type Group = z.infer<typeof GroupSchema>;

/** The most notes someone can pin. */
export const MAX_PINS = 8;

export const PreferencesSchema = z.object({
  /** Whether new calls start with notes on. Each call can still be set when it's scheduled. */
  notesDefault: NotesSettingSchema,
  notesLanguage: NotesLanguageSchema,
  summaryLength: SummaryLengthSchema,
  /** Put the notes link on the calendar event of calls you schedule. */
  addToCalendar: z.boolean(),
  /** Show calendar events that aren't Alcove calls. */
  showOtherMeetings: z.boolean(),
  /** Keep recording on this device when the connection drops, and upload afterwards. */
  recordOffline: z.boolean(),
  notifications: NotificationPrefsSchema,
  /** Pinned note IDs, in the order they were pinned. */
  pinned: z.array(IDSchema).max(MAX_PINS).refine(allUnique, 'Pins must be unique'),
  groups: z.array(GroupSchema).max(MAX_GROUPS).refine((g) => allUnique(g.map((x) => x.id)), 'Group IDs must be unique')
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

/** Your company: the directory where there is one, otherwise the colleagues you have met. Titles come from a directory only. */
export const TeamSchema = z.object({
  name: z.string(),
  domain: z.string(),
  members: z.array(z.object({ person: PersonSchema, title: z.string().optional(), onAlcove: z.boolean(), invited: z.boolean() }))
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

/**
 * Someone changing a note: its decisions, open questions or follow-ups, or a line of its transcript. Who, when, what,
 * and what it was before. On a transcript line, `reworded` corrects its words, `reassigned` says someone else said it
 * (`before` and `after` are the speakers' names) and `confirmed` says it's right as it was heard.
 */
export const ChangeSchema = z.object({
  by: z.object({ name: z.string(), email: z.string() }),
  at: ISODateSchema,
  what: z.enum(['confirmed', 'rejected', 'superseded', 'reopened', 'reworded', 'answered', 'took-on', 'reassigned', 'due', 'done', 'undone']),
  /** The wording, owner, speaker or due date before a change to it, and after. */
  before: z.string().optional(),
  after: z.string().optional()
});
export type Change = z.infer<typeof ChangeSchema>;

/**
 * What the transcript can't vouch for in a line. `words`: the speech model heard them with little confidence, so they
 * may not be exactly what was said. `speaker`: the same words were heard on more than one person's microphone at
 * once (people in one room, or a speaker picked up by someone else's microphone), so someone else may have said them.
 * Correcting the line, or saying it's right, clears it.
 */
export const LineDoubtSchema = z.object({ words: z.literal(true).optional(), speaker: z.literal(true).optional() });
export type LineDoubt = z.infer<typeof LineDoubtSchema>;

export const TranscriptLineSchema = z.object({
  id: IDSchema,
  /** Seconds into the recording, counting every segment before this one (as the player does). */
  at: z.number(),
  /** Who spoke. Absent when nobody can tell, as in a room recording. */
  speaker: SpeakerSchema.optional(),
  /** The breakout room it was said in. Absent for the main room, and outside calls. */
  room: z.object({ id: IDSchema, name: z.string() }).optional(),
  text: z.string(),
  /** What the transcript can't vouch for in this line. Absent when it was heard clearly. */
  unsure: LineDoubtSchema.optional(),
  /** Corrections to a written note's line, oldest first. Absent until someone corrects it. */
  changes: z.array(ChangeSchema).optional()
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

/* ---------- shared screens in a note ---------- */

/** A part of a shared screen worth pointing at (a chart, a table, a paragraph): a short label, and where it is as fractions of the frame from its top left. */
export const ScreenRegionSchema = z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type ScreenRegion = z.infer<typeof ScreenRegionSchema>;

/**
 * How well a frame could be read. clear: all of it. partly: some was too small, blurred or cut off. unreadable: none
 * of it could be made out. unread: the notes model couldn't read it at all, so nothing is said about it.
 */
export const ScreenLegibleSchema = z.enum(['clear', 'partly', 'unreadable', 'unread']);
export type ScreenLegible = z.infer<typeof ScreenLegibleSchema>;

/**
 * What was on a shared screen at a moment of the call: one frame the presenter's own browser kept because the screen
 * changed. `at` to `until` is the stretch of the recording it was on screen, the part of the transcript it belongs
 * to. The reading (title, text, how legible, the parts worth pointing at) is the private notes model's; its
 * `description` ties the frame to what was said. The image is at notes.screenUrl(noteId, id).
 */
export const ScreenMomentSchema = z.object({
  id: IDSchema,
  /** Seconds into the recording, as transcript lines count them, when it appeared. */
  at: z.number(),
  /** Until when it stayed: the share's next frame, the share or screen notes stopping, a gap, or the end. */
  until: z.number(),
  /** Whose screen it was. Absent when the call can't tell any more. */
  presenter: SpeakerSchema.optional(),
  /** Which share it's from: one person can share more than once, and several people can share at once. */
  share: IDSchema,
  /** The frame's size in pixels. */
  width: z.number(),
  height: z.number(),
  legible: ScreenLegibleSchema,
  /** What it is, in a few words: a slide's heading, a document's name, the app shown. Empty when nothing could be read. */
  title: z.string(),
  /** The words and numbers read on it, line by line: only what could be read. */
  text: z.string(),
  /** What it shows and how it ties in with what was said, once the notes are written. Empty before. */
  description: z.string(),
  regions: z.array(ScreenRegionSchema)
});
export type ScreenMoment = z.infer<typeof ScreenMomentSchema>;

/**
 * Where something in the notes was on a shared screen: the moment (`ScreenMoment.id`), the part of it when one
 * (`region`, an index into its regions), and whether what was said plainly refers to it (`sure`) or the notes only
 * think it does.
 */
export const ScreenRefSchema = z.object({ id: IDSchema, region: z.number().optional(), sure: z.boolean() });
export type ScreenRef = z.infer<typeof ScreenRefSchema>;

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
  /** What was on a shared screen when it was settled, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
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
  /** What was on a shared screen when it was asked, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
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
  /** What was on a shared screen when it came up, if it was about something shown. */
  screen: ScreenRefSchema.optional(),
  /** Who took it on, gave it to someone, changed it or ticked it, oldest first. */
  changes: z.array(ChangeSchema)
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

/** A part of the call: where it starts, a few words, a sentence, and what was on a shared screen through it, when something was. */
export const ChapterSchema = z.object({ at: z.number(), title: z.string(), summary: z.string(), screen: ScreenRefSchema.optional() });
export type Chapter = z.infer<typeof ChapterSchema>;

/**
 * A stretch of a call when nothing was captured: notes were off, the organizer paused them, or (`offline`) notes were
 * on but the host's browser was out of the call until another connection hosted or the call ended.
 * `from` and `to` are when it started and ended (`to` is null while it's still going). `at` is where it falls in the
 * recording, in seconds as transcript lines count them: the lines before it were said before it, and the transcript
 * and its chapters say "Paused 10:02–10:05" in its place rather than run on as if it was captured.
 */
export const CaptureGapSchema = z.object({ kind: z.enum(['off', 'paused', 'offline']), from: ISODateSchema, to: ISODateSchema.nullable(), at: z.number() });
export type CaptureGap = z.infer<typeof CaptureGapSchema>;

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
export const RecipientSchema = z.object({
  person: PersonSchema, role: RecipientRoleSchema,
  /** Who shared the notes with them. Only on people they were shared with. */
  by: PersonSchema.optional(),
  /** The name of the sharer's group they were shared with, when it was a group. */
  group: z.string().optional(),
  /** When they got the notes: when the call ended for people invited to it, or when the notes were shared with them. */
  at: ISODateSchema.optional()
});
export type Recipient = z.infer<typeof RecipientSchema>;

/** How you got someone else's note: invited to its call, or shared with you afterwards ("Priya shared it with Product"). */
export const ReceivedSchema = z.object({
  role: z.enum(['invited', 'shared']),
  /** The organizer, for a call you were invited to; otherwise whoever shared the notes with you. */
  by: PersonSchema,
  /** The name of their group they shared the notes with, when it was a group. */
  group: z.string().optional(),
  /** When you got the notes. */
  at: ISODateSchema
});
export type Received = z.infer<typeof ReceivedSchema>;

/**
 * What Alcove checked about a NEAR AI model before sending it anything for a note: an Intel TDX VM booted
 * from a published dstack image, its GPUs in confidential-computing mode, and the key everything was
 * sealed to, bound to Alcove's fresh challenge. Hashes identify the evidence; nothing in it is secret.
 */
export const InferenceEvidenceSchema = z.object({
  /** The model as NEAR AI names it, e.g. "z-ai/glm-5.3-flash". */
  model: z.string(),
  /** What it did for the note: transcribed the speech, or wrote the notes. */
  task: z.enum(['transcript', 'notes']),
  /** When Alcove checked the evidence, before sending anything to the key it vouches for. */
  verifiedAt: ISODateSchema,
  /** The model's attested signing key (Ed25519, hex). It signs the OHTTP key requests are sealed to. */
  key: z.string(),
  /** The model's Intel TDX quote: the TCB status Intel's collateral gives it, and the quote's SHA-256. */
  tdx: z.object({ status: z.string(), quote: z.string() }),
  /** The dstack OS image its VM measured at boot, e.g. "dstack-nvidia-0.5.12". */
  os: z.string(),
  /** The GPUs NVIDIA's attestation service confirmed are in confidential-computing mode, for the same challenge. */
  gpu: z.object({ count: z.number(), arch: z.string() }),
  /** SHA-256 of the app compose the VM was started with, as its quote measures it. */
  compose: z.string(),
  /** NEAR AI's gateway, which served the evidence, checked the same way. */
  gateway: z.object({ status: z.string(), os: z.string(), compose: z.string() })
});
export type InferenceEvidence = z.infer<typeof InferenceEvidenceSchema>;

/** Someone sharing a note with one of their groups: who, the group's name, and when. */
export const GroupShareSchema = z.object({ by: PersonSchema, group: z.string(), at: ISODateSchema });
export type GroupShare = z.infer<typeof GroupShareSchema>;

export const NoteSummarySchema = z.object({
  id: IDSchema, kind: NoteKindSchema, status: NoteStatusSchema, title: z.string(), startedAt: ISODateSchema, duration: z.number(),
  /** Everyone who has the notes, organizer first. */
  people: z.array(PersonSchema),
  /** The start of the summary; empty until the notes are written. */
  excerpt: z.string(), openActions: z.number(), totalActions: z.number(), meetingId: IDSchema.optional(),
  /** How you got the note, when it's someone else's. Absent on your own. */
  received: ReceivedSchema.optional(),
  /**
   * Each time someone who has the notes shared them with one of their groups, newest first: once for each
   * sharer and group (the latest time), and only while someone it reached still has them.
   */
  groupShares: z.array(GroupShareSchema)
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
  /** The stretches of the call with nothing captured, oldest first. Room recordings have none. */
  gaps: z.array(CaptureGapSchema),
  /** What was on shared screens while screen notes were on, oldest first, each with the stretch of the transcript it belongs to. */
  screens: z.array(ScreenMomentSchema),
  /** What was said while notes were on. Null while the recording is still going. */
  transcript: z.array(TranscriptLineSchema).nullable(),
  /**
   * When the notes were last written from the transcript; null until they have been. Corrections to the transcript
   * after it reach the notes when the organizer has them written again (notes.rewrite).
   */
  writtenAt: ISODateSchema.nullable(),
  /**
   * The organizer asked for the notes to be written again and they're being written. Until then the note stays as it
   * is, readable and changeable by everyone who has it.
   */
  writingAgain: z.boolean(),
  suggestedQuestions: z.array(z.string()),
  /** Encrypted audio kept for this note; playable through notes.audioUrl. */
  audio: z.array(AudioSegmentSchema),
  /** The verified private models that transcribed the speech and wrote the notes. Empty when nothing was transcribed. */
  inference: z.array(InferenceEvidenceSchema),
  /** The series its call is in, when it's in one: see series.get. */
  seriesId: IDSchema.optional()
});
export type Note = z.infer<typeof NoteSchema>;

export const OpenActionSchema = ActionItemSchema.extend({ noteId: IDSchema, noteTitle: z.string(), noteStartedAt: z.string() });
export type OpenAction = z.infer<typeof OpenActionSchema>;

/** A decision nobody has confirmed yet, with the note it came from. */
export const PendingDecisionSchema = DecisionSchema.extend({ noteId: IDSchema, noteTitle: z.string(), noteStartedAt: z.string() });
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

/**
 * What waits on you across every note you have, newest note first: follow-ups for you that aren't
 * done, and decisions in written notes that nobody has confirmed or rejected.
 */
export const InboxSchema = z.object({ followUps: z.array(OpenActionSchema), decisions: z.array(PendingDecisionSchema) });
export type Inbox = z.infer<typeof InboxSchema>;

/**
 * An answer to a question about notes: its text, then where it comes from. A cite is a note and a
 * moment in it, in seconds into its recording; asking about one note cites only that note. A screen is
 * one of that note's shared screens it read the answer on (its `ScreenMoment`, and the part of it when
 * one): only asking about one written note cites screens.
 */
export const AnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('cite'), noteId: IDSchema, at: z.number() }),
  z.object({ type: z.literal('screen'), id: IDSchema, at: z.number(), region: z.number().optional() })
]);
export type AnswerPart = z.infer<typeof AnswerPartSchema>;

/**
 * A moment in a note's recording, in seconds from its start: where a link such as an answer's cite opens
 * the note (`/notes/<id>?at=245`). It comes from the address bar, so the app parses it with this.
 */
export const NoteMomentSchema = z.number().min(0);

/** What the Team page's `group` opens: one of your groups by its ID, or NEW_GROUP to make one. From the address bar too. */
export const GroupParamSchema = IDSchema.min(1).max(200);
export const NEW_GROUP = 'new';

/**
 * Someone's email address after `#with=` on the notes list (`/notes#with=priya%40lumen.health`, as the Team page
 * links it): the list shows only the notes they have too. It's in the hash, which never leaves the browser, and it
 * comes from the address bar, so the app parses it with this; anything else means no filter.
 */
export const EmailParamSchema = z.string().trim().toLowerCase().email().max(254);

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
  /** How you got the note, when it's someone else's. Absent on your own. */
  received: ReceivedSchema.optional()
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
  /** The calls in the series whose notes you have, newest first: the newest 24 of them. Everything below comes from these alone. */
  notes: z.array(SeriesNoteSchema),
  /** How many older calls in it you also have notes from. They aren't shown, and nothing carries over from them. */
  older: z.number(),
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

/** The most camera video someone sends: 720p (standard), 1080p (HD), or 360p to save data. */
export const VideoSendSchema = z.enum(['standard', 'hd', 'saver']);
export type VideoSend = z.infer<typeof VideoSendSchema>;
/** Others' cameras as someone receives them: as sharp as each tile needs, capped low to save data, or none. */
export const VideoReceiveSchema = z.enum(['auto', 'saver', 'off']);
export type VideoReceive = z.infer<typeof VideoReceiveSchema>;
/**
 * The microphone, camera and speaker someone chose, whether the browser should reduce noise and blur their
 * background, and the video they send and see: remembered in their browser only, never sent anywhere.
 */
export const DevicePrefsSchema = z.object({
  mic: z.string().max(300).optional(), cam: z.string().max(300).optional(), speaker: z.string().max(300).optional(),
  noiseReduction: z.boolean().optional(), blur: z.boolean().optional(),
  sendVideo: VideoSendSchema.optional(), receiveVideo: VideoReceiveSchema.optional()
});
export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;

/**
 * How loud each person in a call is for one listener: their own playback only, never what the person sends, what's
 * recorded or transcribed, or anyone else's. Kept in that browser tab for that call only, by the random identity
 * each connection has in the call (never a name or an address), from 0 (muted for you) to 1 (as they arrive).
 */
export const CallVolumesSchema = z.object({
  callId: z.string().max(200),
  levels: z.record(z.string().max(200), z.number().min(0).max(1)).refine((l) => Object.keys(l).length <= 200, 'too many people')
});
export type CallVolumes = z.infer<typeof CallVolumesSchema>;

/*
 * How someone arranges a call on their own screen. Kept in their browser only: nobody else's view changes, and
 * nothing in it names anyone or carries anything from a call.
 */
export const CallViewModeSchema = z.enum(['auto', 'speaker', 'grid']);
export type CallViewMode = z.infer<typeof CallViewModeSchema>;
/** Where you see yourself: in the grid with everyone, as a small picture in a corner, or folded away. */
export const SelfViewSchema = z.enum(['grid', 'corner', 'hidden']);
export type SelfView = z.infer<typeof SelfViewSchema>;
export const StageCornerSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
export type StageCorner = z.infer<typeof StageCornerSchema>;
/** How much of the stage shared screens can take beside the people, and how much they start with. */
export const CALL_SHARE_ROOM = { min: 0.42, max: 0.8, start: 0.66 } as const;
/** How two shares side by side can split their space (the first one's part), and where they start. */
export const CALL_SHARE_SPLIT = { min: 0.25, max: 0.75, start: 0.5 } as const;
/** The most a call's arrangement holds: pins, and the lists kept for the call. The app keeps to them as it writes. */
export const CALL_LAYOUT_MAX = { pins: 6, order: 200, arrived: 400, big: 200, shares: 20 } as const;
/** How someone likes to see every call: remembered for their account in this browser. */
export const CallViewPrefsSchema = z.object({
  mode: CallViewModeSchema,
  /** How much of the stage shared screens take beside the people (CALL_SHARE_ROOM). */
  ratio: z.number().min(CALL_SHARE_ROOM.min).max(CALL_SHARE_ROOM.max),
  self: SelfViewSchema,
  /** The corner your own picture sits in. */
  corner: StageCornerSchema
});
export type CallViewPrefs = z.infer<typeof CallViewPrefsSchema>;
/**
 * How someone arranged one call: kept in that tab until they leave the call. People are named by their seat in the
 * call (`CallParticipant.seat`) and shares by their sharer's participant ID: random, and only meaningful in this call.
 */
export const CallLayoutSchema = z.object({
  /** Seats pinned, in the order they were pinned. Someone pinned who leaves stays pinned for when they come back. */
  pins: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.pins),
  /** Seats in the order you arranged them. Anyone else follows in the order they first came in. */
  order: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.order),
  /** Seats in the order they first came into the call, so someone coming back keeps their place. */
  arrived: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.arrived),
  /** Seats you made bigger. */
  big: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.big),
  /**
   * Shares you chose to see big or as a tile, in the order you chose. While any of them is shared, the latest you made
   * big are big (as many as fit) and every other share is a tile; with none, shares follow the layout.
   */
  shares: z.array(z.object({ id: z.string().max(200), show: z.enum(['big', 'tile']) })).max(CALL_LAYOUT_MAX.shares),
  /** How the space splits between two shares side by side (CALL_SHARE_SPLIT). */
  split: z.number().min(CALL_SHARE_SPLIT.min).max(CALL_SHARE_SPLIT.max)
});
export type CallLayout = z.infer<typeof CallLayoutSchema>;

/** That someone finished or closed the tour of Home. Kept in their browser for their account, never sent anywhere. */
export const HomeTourSchema = z.object({ seenAt: ISODateSchema });
export type HomeTour = z.infer<typeof HomeTourSchema>;

/**
 * That this browser has a signed-in session, so the app opens without a connection and Record works: the account's
 * opaque ID, when its session ends at the latest, and whether it records without a connection. Kept in this browser
 * (localStorage) while the session lasts; never a name or an address.
 */
export const SignedInHereSchema = z.object({
  ownerId: z.string().min(1).max(100),
  until: ISODateSchema,
  recordOffline: z.boolean()
});
export type SignedInHere = z.infer<typeof SignedInHereSchema>;

/*
 * Room recordings kept on this device until they upload, as the browser's IndexedDB holds them
 * (apps/web/src/features/record/offline.ts). Whatever is readable (the name, the audio, the speech) is sealed with
 * AES-GCM under a key made on this device that can't be exported, with a fresh IV each time, bound to where it
 * belongs. In the clear: opaque IDs, times, lengths, sizes and the codec.
 */
export const DeviceSealedSchema = z.object({ iv: z.instanceof(ArrayBuffer), data: z.instanceof(ArrayBuffer) });
export type DeviceSealed = z.infer<typeof DeviceSealedSchema>;
/**
 * `recording`: a recorder has it, or had it until its tab closed. `finished`: it waits to upload. `discarded`: it was
 * thrown away, and whatever reached Alcove of it is deleted when there's a connection.
 */
export const KeptStateSchema = z.enum(['recording', 'finished', 'discarded']);
export type KeptState = z.infer<typeof KeptStateSchema>;
export const KeptRecordingSchema = z.object({
  id: z.string().min(1).max(100),
  /** The account it was recorded under. Only that account uploads it or sees it here. */
  owner: z.string().min(1).max(100),
  /** When it started, to the millisecond: it uploads as starting then (RoomRecordingInput.startedAt). */
  startedAt: ISODateSchema,
  state: KeptStateSchema,
  /** How long it is, as far as this device knows. */
  seconds: z.number().min(0),
  /** The audio and speech kept here, in bytes. */
  bytes: z.number().int().min(0),
  /** The recording it began as on Alcove, once it had one. */
  server: z.string().max(100).nullable(),
  /** Alcove was asked to start it at least once: it may be there even if the answer never came. */
  tried: z.boolean(),
  /** Something kept of it won't open on this device any more (its key is gone): it's never uploaded, only deleted. */
  unreadable: z.boolean(),
  /** Why Alcove refused it the last time it tried, as Alcove said it. */
  problem: z.string().max(500).nullable(),
  title: DeviceSealedSchema
});
export type KeptRecording = z.infer<typeof KeptRecordingSchema>;
/** A piece of a kept recording's audio, exactly as it would have been sent (AudioPiece). */
export const KeptPieceSchema = z.object({
  rec: z.string().min(1).max(100), segment: z.number().int().min(0), seq: z.number().int().min(0), at: z.number().min(0),
  durationMs: z.number().min(0), mimeType: z.string().max(100), sealed: DeviceSealedSchema
});
export type KeptPiece = z.infer<typeof KeptPieceSchema>;
/** A clip of a kept recording's speech, waiting to be transcribed (TranscriptClip), found by where it starts. */
export const KeptClipSchema = z.object({
  rec: z.string().min(1).max(100), segment: z.number().int().min(0), atMs: z.number().int().min(0), at: z.number().min(0),
  durationMs: z.number().min(0), sealed: DeviceSealedSchema
});
export type KeptClip = z.infer<typeof KeptClipSchema>;

/**
 * The browser notifications shown for an account in this browser, oldest first, so no tab shows one again: each
 * event's key, made of its kind and the IDs it's about (`call:<meetingId>:<startsAt>`, `ready:<noteId>`), never a
 * title or a name, and when it showed (ms since the epoch). Kept in localStorage for the account
 * (`alcove.notified.<ownerId>`) for a day or until someone signs out here, never sent anywhere.
 */
export const NotifiedStoredSchema = z.array(z.object({ key: z.string().max(300), at: z.number() })).max(500);

/** A call's code, as its links have it: `kpw-rnzq-hte`. */
export const CallCodeSchema = z.string().regex(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

/**
 * Where clicking a browser notification leads: a call (its join page, or the call itself for whoever is in it), a
 * note, Notes or Home. It travels on the notification, so the page parses what the service worker hands back.
 */
export const NotificationOpenSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('call'), code: CallCodeSchema }),
  z.object({ to: z.literal('note'), noteId: IDSchema }),
  z.object({ to: z.literal('notes') }),
  z.object({ to: z.literal('home') })
]);
export type NotificationOpen = z.infer<typeof NotificationOpenSchema>;
/**
 * What the service worker (apps/web/public/sw.js) posts to the app's windows when a notification is clicked: it asks
 * each where it is, answered on the port it sends, then tells the one it brought forward where the notification leads.
 */
export const WorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('alcove.where') }),
  z.object({ type: z.literal('alcove.notification'), open: NotificationOpenSchema })
]);

/* ---------- captions ---------- */

/** Languages captions can be translated into. Each person picks their own; nobody else's captions change. */
export const CaptionLanguageSchema = z.enum(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh']);
export type CaptionLanguage = z.infer<typeof CaptionLanguageSchema>;
/** Each caption language, named in itself and in English. */
export const CAPTION_LANGUAGES: readonly { code: CaptionLanguage; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' }, { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' }, { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pt', name: 'Português', english: 'Portuguese' }, { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'ja', name: '日本語', english: 'Japanese' }, { code: 'zh', name: '中文', english: 'Chinese' }
];

/* ---------- credits ---------- */

export const CreditBalanceSchema = z.object({
  balance: z.number(),
  /** Every credit added to the account so far, so the app can show how much is left. */
  granted: z.number(),
  /** Credits charged since this month began (00:00 UTC on the 1st), from the account's credit history. */
  usedThisMonth: z.number(),
  /** Credits charged per minute of notes or room recording. Calls without notes are free. */
  perMinute: z.number()
});
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;
