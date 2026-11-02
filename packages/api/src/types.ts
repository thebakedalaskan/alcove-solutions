/*
 * Domain models, defined once as zod schemas. Types are inferred from the schemas, and the HTTP
 * client parses every response with them, so nothing crosses the network boundary unchecked.
 * Times are ISO-8601 strings in UTC; durations are seconds.
 */
import { z } from 'zod';

export const IDSchema = z.string();
export type ID = z.infer<typeof IDSchema>;
export const ISODateSchema = z.string();
export type ISODate = z.infer<typeof ISODateSchema>;

/** What a call keeps when notes are on. */
export const NotesModeSchema = z.enum(['full', 'notes', 'off']);
export type NotesMode = z.infer<typeof NotesModeSchema>;
export const NotesKeepSchema = z.enum(['full', 'notes']);
export type NotesKeep = z.infer<typeof NotesKeepSchema>;
/** A meeting's setting before it starts. `ask` means the host picks at join time. */
export const MeetingNotesSettingSchema = z.enum(['full', 'notes', 'off', 'ask']);
export type MeetingNotesSetting = z.infer<typeof MeetingNotesSettingSchema>;
/** Who receives the notes when a call ends. */
export const NotesAudienceSchema = z.enum(['everyone', 'host']);
export type NotesAudience = z.infer<typeof NotesAudienceSchema>;
/** The account-wide default applied to new calls. */
export const NotesDefaultSchema = z.enum(['ask', 'always', 'never']);
export type NotesDefault = z.infer<typeof NotesDefaultSchema>;

export const AuthProviderSchema = z.enum(['google', 'microsoft', 'apple', 'email']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;
export const CalendarProviderSchema = z.enum(['google', 'microsoft', 'apple']);
export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;

export const PortraitHairSchema = z.enum(['short', 'swept', 'curly', 'long', 'bob', 'afro', 'bun']);
export type PortraitHair = z.infer<typeof PortraitHairSchema>;
/** Appearance for illustrated portraits. Backends may omit it; the UI falls back to a letter tile. */
export const PortraitStyleSchema = z.object({
  bg: z.string(), skin: z.string(), hair: z.string(), shirt: z.string(), style: PortraitHairSchema,
  beard: z.boolean().optional(), glasses: z.boolean().optional(),
  /** Colours of the room behind the person when their camera is on. */
  room: z.tuple([z.string(), z.string(), z.string()]).optional()
});
export type PortraitStyle = z.infer<typeof PortraitStyleSchema>;

export const PersonSchema = z.object({ id: IDSchema, name: z.string(), email: z.string(), portrait: PortraitStyleSchema.optional() });
export type Person = z.infer<typeof PersonSchema>;

export const SessionSchema = z.object({
  user: PersonSchema,
  provider: AuthProviderSchema,
  /** False until the user has created a passkey. Notes cannot be unlocked without one. */
  hasPasskey: z.boolean(),
  createdAt: ISODateSchema
});
export type Session = z.infer<typeof SessionSchema>;

export const PasskeySchema = z.object({ id: IDSchema, deviceName: z.string(), createdAt: ISODateSchema, thisDevice: z.boolean() });
export type Passkey = z.infer<typeof PasskeySchema>;

export const PreferencesSchema = z.object({ notesDefault: NotesDefaultSchema, keep: NotesKeepSchema });
export type Preferences = z.infer<typeof PreferencesSchema>;

export const CalendarConnectionSchema = z.object({
  provider: CalendarProviderSchema,
  connected: z.boolean(),
  /** True when the connection came with sign-in rather than a separate grant. */
  viaSignIn: z.boolean(),
  account: z.string().optional()
});
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;

export const RsvpSchema = z.enum(['yes', 'pending', 'no']);
export type Rsvp = z.infer<typeof RsvpSchema>;

export const GuestSchema = z.object({
  email: z.string(),
  /** Present when the guest has an Alcove account or is in the user's contacts. */
  person: PersonSchema.optional(),
  rsvp: RsvpSchema
});
export type Guest = z.infer<typeof GuestSchema>;

export const MeetingStatusSchema = z.enum(['scheduled', 'live', 'ended', 'cancelled']);
export const MeetingSchema = z.object({
  id: IDSchema,
  title: z.string(),
  startsAt: ISODateSchema,
  endsAt: ISODateSchema,
  host: PersonSchema,
  isHost: z.boolean(),
  guests: z.array(GuestSchema),
  notes: MeetingNotesSettingSchema,
  audience: NotesAudienceSchema,
  /** Short code used in the join link, e.g. `kpw-rnzq-hte`. */
  code: z.string(),
  /** Present once the call has happened and notes were written. */
  noteId: IDSchema.optional(),
  status: MeetingStatusSchema,
  /** Seconds the call actually lasted, once ended. */
  duration: z.number().optional()
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingInputSchema = z.object({
  title: z.string(), startsAt: ISODateSchema, durationMinutes: z.number(), guests: z.array(z.string()),
  notes: MeetingNotesSettingSchema, audience: NotesAudienceSchema
});
export type MeetingInput = z.infer<typeof MeetingInputSchema>;

export const CallLinkSchema = z.object({
  code: z.string(),
  /** Full URL. The fragment carries the call key and is never sent to the server. */
  url: z.string(),
  notes: MeetingNotesSettingSchema
});
export type CallLink = z.infer<typeof CallLinkSchema>;

/* ---------- notes ---------- */

export const SpeakerSchema = z.object({ name: z.string(), person: PersonSchema.optional() });
export type Speaker = z.infer<typeof SpeakerSchema>;

export const TranscriptLineSchema = z.object({
  id: IDSchema,
  /** Seconds from the start of the recording. */
  at: z.number(),
  speaker: SpeakerSchema,
  text: z.string()
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

export const ScreenCaptureSchema = z.object({ at: z.number(), by: z.string(), title: z.string(), text: z.string() });
export type ScreenCapture = z.infer<typeof ScreenCaptureSchema>;

export const ActionItemSchema = z.object({ id: IDSchema, text: z.string(), owner: SpeakerSchema, due: z.string().optional(), done: z.boolean() });
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ChapterSchema = z.object({ at: z.number(), title: z.string(), summary: z.string() });
export type Chapter = z.infer<typeof ChapterSchema>;

export const NoteKindSchema = z.enum(['call', 'room']);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const NoteSummarySchema = z.object({
  id: IDSchema, kind: NoteKindSchema, title: z.string(), startedAt: ISODateSchema, duration: z.number(),
  people: z.array(PersonSchema), excerpt: z.string(), openActions: z.number(), totalActions: z.number(),
  keep: NotesKeepSchema, meetingId: IDSchema.optional()
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const NoteSchema = NoteSummarySchema.extend({
  summary: z.string(),
  decisions: z.array(z.string()),
  actions: z.array(ActionItemSchema),
  chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema),
  /** Null when only notes were kept and the transcript was deleted. */
  transcript: z.array(TranscriptLineSchema).nullable(),
  audience: NotesAudienceSchema,
  suggestedQuestions: z.array(z.string())
});
export type Note = z.infer<typeof NoteSchema>;

export const OpenActionSchema = ActionItemSchema.extend({ noteId: IDSchema, noteTitle: z.string() });
export type OpenAction = z.infer<typeof OpenActionSchema>;

export const AnswerPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('cite'), at: z.number() })
]);
export type AnswerPart = z.infer<typeof AnswerPartSchema>;

/* ---------- credits ---------- */

export const CreditBalanceSchema = z.object({
  balance: z.number(),
  /** Credits charged per minute of notes or room recording. Calls are free. */
  perMinute: z.number()
});
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;

export const CreditEventSchema = z.object({ id: IDSchema, at: ISODateSchema, label: z.string(), detail: z.string(), amount: z.number() });
export type CreditEvent = z.infer<typeof CreditEventSchema>;

export const CreditPackSchema = z.object({ id: IDSchema, credits: z.number(), priceUsdc: z.number(), badge: z.string().optional() });
export type CreditPack = z.infer<typeof CreditPackSchema>;

/* ---------- home ---------- */

export const WeekStatsSchema = z.object({
  /** Minutes in calls for each of the last 7 days, oldest first. */
  minutesByDay: z.array(z.object({ date: ISODateSchema, minutes: z.number() })),
  notes: z.number(),
  actionItems: z.number(),
  roomRecordings: z.number()
});
export type WeekStats = z.infer<typeof WeekStatsSchema>;

export const SetupStepSchema = z.object({
  id: z.enum(['signed-in', 'passkey', 'calendar', 'first-call', 'second-passkey']),
  label: z.string(),
  done: z.boolean()
});
export type SetupStep = z.infer<typeof SetupStepSchema>;
