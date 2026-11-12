import { PersonSchema, PortraitStyleSchema } from '../identity/people';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { ActionItemSchema, DecisionSchema, NoteActionSchema, NoteDecisionSchema, NoteQuestionSchema, QuestionSchema } from './entries';
import { ModelIdSchema, UnencryptedUseSchema } from './models';
import { ScreenMomentSchema, ScreenRefSchema, ScreenShareSchema } from './screens';
import { RecipientRoleSchema, SpeakerSchema, TranscriptLineSchema } from './transcript';
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


export const RecipientSchema = z.object({
  person: PersonSchema, role: RecipientRoleSchema,
  /** Who shared the notes with them. Only on people they were shared with. */
  by: PersonSchema.optional(),
  /** They opened a link `by` made, rather than being given the notes by their address. */
  link: z.literal(true).optional(),
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
  /** You opened a link `by` made, rather than being given the notes by your address. */
  link: z.literal(true).optional(),
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
  /** What it did for the note: transcribed the speech, wrote the notes, or read the shared screens. Records written before screens were read hold only the first two. */
  task: z.enum(['transcript', 'notes', 'screens']),
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
  /** Who in `people` got the notes afterwards, by address: they weren't on the call. */
  sharedWith: z.array(z.string()),
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


/** A line of what was said that a search found: where it is, who said it, the room it was said in, and the words. */
export const NoteSaidSchema = TranscriptLineSchema.pick({ id: true, at: true, speaker: true, room: true, text: true }).extend({
  /**
   * What the line became in the notes: it's what a decision that isn't rejected rests on (one of the decision's `lines`),
   * or else what a follow-up rests on (one in `actions`, not a suggestion waiting for review), in the part of the call it
   * was said in (a breakout room's line, in that room's section). Absent when nothing in the notes rests on it.
   */
  made: z.enum(['decision', 'follow-up']).optional()
});

export type NoteSaid = z.infer<typeof NoteSaidSchema>;

/**
 * A note as a search finds it: what was said that matched, the lines with most of its words first, then the earliest
 * (empty without a search; everything they said, in time order, when the search is only someone's lines), and how many
 * lines did in all.
 */
export const NoteFoundSchema = NoteSummarySchema.extend({ said: z.array(NoteSaidSchema), saidCount: z.number() });

export type NoteFound = z.infer<typeof NoteFoundSchema>;


/**
 * A breakout room's section of a call's notes: its name, who was in it (the organizer too, if it came in), when it was
 * open (seconds into the recording), what was said in it while notes were on, and its own notes, written from that
 * alone. Everyone with the call's notes reads every room's section.
 */
export const RoomNoteSchema = z.object({
  id: IDSchema,
  name: z.string(),
  people: z.array(SpeakerSchema),
  from: z.number(),
  to: z.number(),
  summary: z.string(),
  decisions: z.array(DecisionSchema),
  questions: z.array(QuestionSchema),
  actions: z.array(ActionItemSchema),
  chapters: z.array(ChapterSchema),
  /** The stretches the room had nothing captured in: notes off or paused for the call, or the room paused. */
  gaps: z.array(CaptureGapSchema),
  transcript: z.array(TranscriptLineSchema)
});

export type RoomNote = z.infer<typeof RoomNoteSchema>;

/** A breakout room's section as someone reading the note gets it. */
export const NoteRoomSchema = RoomNoteSchema.extend({ decisions: z.array(NoteDecisionSchema), questions: z.array(NoteQuestionSchema), actions: z.array(NoteActionSchema), suggestions: z.array(NoteActionSchema) });

export type NoteRoom = z.infer<typeof NoteRoomSchema>;


/**
 * A moment something points at, as the person reading may read it now: a bookmark, an answer someone kept, or something
 * added to the shared notes. Never stored like this: what's kept is only a pointer, and it's read again each time.
 */
export const SourceMomentSchema = z.object({
  /** Where it falls: seconds since the call started while the call is on, seconds into the recording in a note. */
  at: z.number(),
  /** The transcript line there. */
  line: z.object({ id: IDSchema, text: z.string(), speaker: SpeakerSchema.optional() }).optional(),
  /** The breakout room it was said in. Absent for the main room. */
  room: z.object({ id: IDSchema, name: z.string() }).optional(),
  /** What was on a shared screen then (a `ScreenMoment`). Only in a note: shared screens are read once the call ends. */
  screen: z.object({ id: IDSchema, title: z.string() }).optional()
});

export type SourceMoment = z.infer<typeof SourceMomentSchema>;


/**
 * Something someone chose to add to the shared notes from their own, after seeing exactly what goes and who gets it. It's
 * theirs, under their name: never the notes' own words, and never a decision or a follow-up until someone makes it one.
 */
export const NoteAdditionSchema = z.object({
  id: IDSchema,
  /** Exactly the words they chose to share. Empty when they shared a moment they bookmarked and said nothing about it. */
  text: z.string(),
  /** Who added it, as they were when they did. */
  by: PersonSchema,
  at: ISODateSchema,
  /** The moments it points at, those you may open: checked for each reader, each time they read it. */
  moments: z.array(SourceMomentSchema),
  /** You can take it back: you added it, or these are your notes. */
  removable: z.boolean()
});

export type NoteAddition = z.infer<typeof NoteAdditionSchema>;


/**
 * A document or board worked on in the call, for someone who can open it now: anything else isn't listed, so nobody learns
 * from a note what they couldn't open. `by`: who changed it during the call, by the name they were in the call under, and
 * `isMe` for the one reading the note. `workspace`: the workspace's name, for someone in it (null otherwise).
 *
 * A board open in the call is here whether or not anyone changed it. `room` is the breakout room it was open in (null for the
 * main room, and for anything only changed from the list), so it sits with that room's notes. `everyone`, for a board:
 * everyone the note went to can open it now (always false for a document, which nothing asks). The notes read a board open
 * for everyone in the call when everyone can open it, because one summary goes to everyone.
 */
export const NoteWorkedOnSchema = z.object({
  workspaceId: IDSchema, id: IDSchema, kind: z.enum(['document', 'board']), name: z.string(), by: z.array(z.object({ name: z.string(), portrait: PortraitStyleSchema, isMe: z.boolean() })),
  workspace: z.string().nullable(), room: IDSchema.nullable(), everyone: z.boolean()
});

export type NoteWorkedOn = z.infer<typeof NoteWorkedOnSchema>;


export const NoteSchema = NoteSummarySchema.extend({
  recipients: z.array(RecipientSchema),
  summary: z.string(),
  /** The full summary: the meeting's topics in order, what was said and concluded on each, and the key screens shown. Longer for a longer meeting; empty until notes are written with it. */
  details: z.string(),
  decisions: z.array(NoteDecisionSchema),
  /** What the call asked and didn't settle. */
  questions: z.array(NoteQuestionSchema),
  actions: z.array(NoteActionSchema),
  suggestions: z.array(NoteActionSchema),
  chapters: z.array(ChapterSchema),
  /** The stretches of the call with nothing captured, oldest first. Room recordings have none. */
  gaps: z.array(CaptureGapSchema),
  /** What was on shared screens kept for the notes, oldest first, each with the stretch of the transcript it belongs to. */
  screens: z.array(ScreenMomentSchema),
  /** The shares kept for the notes, oldest first, with their video for replay. Empty for notes without any, which play audio alone. */
  shares: z.array(ScreenShareSchema).default([]),
  /** The model that wrote these notes (an ID from `models.list()`), or null for the default model. */
  model: ModelIdSchema.nullable().default(null),
  /** Every time a model that isn't in a secure enclave was sent something for these notes. */
  unencrypted: z.array(UnencryptedUseSchema).default([]),
  /**
   * What was said while notes were on. Null while the recording is still going. Without `kept.transcript` it's empty
   * once the notes are written, and until then for everyone but the organizer.
   */
  transcript: z.array(TranscriptLineSchema).nullable(),
  /** Each breakout room's own section, in the order the rooms closed. Empty for a call without rooms and for room recordings. */
  rooms: z.array(NoteRoomSchema).default([]),
  /** What people added from their own notes, oldest first. Everyone with the notes reads them. */
  additions: z.array(NoteAdditionSchema).default([]),
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
  /** What the call was set to keep. Without the transcript it's gone once the notes are written; without the recording, once the call ended. */
  kept: z.object({ transcript: z.boolean(), recording: z.boolean() }),
  /** The verified private models that transcribed the speech and wrote the notes. Empty when nothing was transcribed. */
  inference: z.array(InferenceEvidenceSchema),
  /** The series its call is in, when it's in one: see series.get. */
  seriesId: IDSchema.optional(),
  /** What was worked on in the call that you can open now. */
  workedOn: z.array(NoteWorkedOnSchema).default([])
});

export type Note = z.infer<typeof NoteSchema>;


/** Where something waiting on you came from: the note, and how you have it, which says what you can do about it. */
const InNote = { noteId: IDSchema, noteTitle: z.string(), noteStartedAt: z.string(), role: RecipientRoleSchema };

export const OpenActionSchema = NoteActionSchema.extend(InNote);

export type OpenAction = z.infer<typeof OpenActionSchema>;


/** A decision nobody has confirmed yet, with the note it came from. */
export const PendingDecisionSchema = NoteDecisionSchema.extend(InNote);

export type PendingDecision = z.infer<typeof PendingDecisionSchema>;


/**
 * What waits on you across every note you have, newest note first: follow-ups for you that aren't done, taken on
 * (`takenOn`) or only suggested; decisions in written notes that nobody has confirmed or rejected and that you can
 * confirm, unless you proposed one or said it wasn't decided; and, in notes you organized, confirmed decisions someone
 * disputes, for you to settle.
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

/** A breakout room's section of a note, as a link opens it (`/notes/<id>?room=<room ID>`). From the address bar too. */
export const NoteRoomParamSchema = IDSchema.min(1).max(64);

/**
 * That a link to a moment plays it from there (`/notes/<id>?at=245&play=true`), as Play from in the palette opens it.
 * From the address bar too, where it can arrive as the word: true or 'true' both mean play, and anything else doesn't.
 */
export const NotePlayParamSchema = z.union([z.literal(true), z.literal('true')]).transform((): true => true);
