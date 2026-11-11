import { PersonSchema } from '../identity/people';
import { type ID, IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { SourceMomentSchema } from './schema';
/** How much someone keeps on one call, all of it together. */
export const MAX_PERSONAL_ENTRIES = 200;

export const MAX_PERSONAL_TEXT = 2000;

export const MAX_BOOKMARK_LABEL = 200;

export const MAX_KEPT_QUESTION = 500;

/** Room for the longest answer: the notes model writes at most 1,200 tokens of one, about 5,000 characters. */
export const MAX_KEPT_ANSWER = 8000;

/** How many moments a kept answer keeps. */
export const MAX_KEPT_MOMENTS = 8;

/** The most a note takes from people's own notes, and how long each can be. */
export const MAX_NOTE_ADDITIONS = 200;

export const MAX_ADDITION_TEXT = MAX_KEPT_ANSWER;


/** Where a browser says a bookmark or a kept answer points: a transcript line, a shared screen, or a moment in the recording. */
export const PersonalPointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), lineId: IDSchema.min(1).max(64) }),
  z.object({ kind: z.literal('screen'), frameId: IDSchema.min(1).max(64) }),
  z.object({ kind: z.literal('moment'), at: z.number().min(0) })
]);

export type PersonalPoint = z.infer<typeof PersonalPointSchema>;


/** Something to keep for yourself. */
export const PersonalInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), text: z.string().trim().min(1).max(MAX_PERSONAL_TEXT) }),
  /** A bookmark: of `point`, or of now while a call is on ("mark this"), with whatever you want to call it. */
  z.object({ kind: z.literal('bookmark'), label: z.string().trim().max(MAX_BOOKMARK_LABEL), point: PersonalPointSchema.nullable() }),
  /** An answer you asked for, kept. Nothing keeps one but you saying so. */
  z.object({
    kind: z.literal('answer'), question: z.string().trim().min(1).max(MAX_KEPT_QUESTION), answer: z.string().trim().min(1).max(MAX_KEPT_ANSWER),
    points: z.array(PersonalPointSchema).max(MAX_KEPT_MOMENTS)
  })
]);

export type PersonalInput = z.infer<typeof PersonalInputSchema>;


/** New words for something you wrote, or for what you called a bookmark. A kept answer stays as it was. */
export const PersonalEditSchema = z.object({ text: z.string().trim().max(MAX_PERSONAL_TEXT) });


/**
 * Whether a bookmark opens from where you are. `open`: it does. `later`: it's somewhere you can't read from here (said in
 * another part of the call), or the notes will have it once the call ends. `none`: nothing was captured there.
 */
export const PersonalReachSchema = z.enum(['open', 'later', 'none']);

export type PersonalReach = z.infer<typeof PersonalReachSchema>;


/** The shared notes have a copy of it: which addition, and since when. It goes when that's taken back. */
export const PersonalSharedSchema = z.object({ additionId: IDSchema, at: ISODateSchema });

export type PersonalShared = z.infer<typeof PersonalSharedSchema>;


const Entry = { id: IDSchema, at: ISODateSchema, shared: PersonalSharedSchema.nullable() };

/** One thing in your own notes, in the order you kept them. What it points at is read for you each time you read it. */
export const PersonalEntrySchema = z.discriminatedUnion('kind', [
  z.object({ ...Entry, kind: z.literal('note'), text: z.string() }),
  z.object({ ...Entry, kind: z.literal('bookmark'), label: z.string(), moment: SourceMomentSchema.nullable(), reach: PersonalReachSchema }),
  /** `moments`: the ones behind the answer that you can read from where you are. */
  z.object({ ...Entry, kind: z.literal('answer'), question: z.string(), answer: z.string(), moments: z.array(SourceMomentSchema) })
]);

export type PersonalEntry = z.infer<typeof PersonalEntrySchema>;


/** Your own notes on one call: the note they go with, and what's in them. */
export const PersonalNotesSchema = z.object({ noteId: IDSchema, entries: z.array(PersonalEntrySchema) });

export type PersonalNotes = z.infer<typeof PersonalNotesSchema>;


/** Your own notes on one call, by the note (from anywhere) or from inside the call. */
export interface PersonalApi {
  get(): Promise<PersonalNotes>;
  add(input: PersonalInput): Promise<PersonalNotes>;
  /** Changes what you wrote, or what a bookmark is called. */
  edit(entryId: ID, text: string): Promise<PersonalNotes>;
  /** Deletes it for good. Anything already added to the shared notes stays there until it's taken back. */
  remove(entryId: ID): Promise<PersonalNotes>;
}


/**
 * What adding something to the shared notes would do, before it does: exactly what goes, where, and who gets it. Nothing
 * is sent until `notes.addToShared` says so with this `seal`, and only while the moments and the people are still these.
 */
export const PromotionPreviewSchema = z.object({
  entryId: IDSchema,
  /** The words that go, as the preview starts: only what this one entry says, and never the question behind an answer. */
  text: z.string(),
  /** The moments that go with them, each something everyone with the notes can open. */
  moments: z.array(SourceMomentSchema),
  /** Where it lands. */
  destination: z.object({ noteId: IDSchema, title: z.string() }),
  /** Everyone who has the notes now, organizer first. Anyone they share them with later reads it too. */
  audience: z.array(PersonSchema),
  seal: z.string()
});

export type PromotionPreview = z.infer<typeof PromotionPreviewSchema>;


/** Sends what a preview showed: the words as they stand now, cut down or reworded by you, and the preview's seal. */
export const PromoteBodySchema = z.object({ text: z.string().trim().max(MAX_ADDITION_TEXT), seal: z.string().min(1).max(200) });

export type PromoteBody = z.infer<typeof PromoteBodySchema>;


/**
 * Who reads what's written straight into the shared notes, shown before anything is typed: everyone who has the notes
 * now, organizer first, and anyone they share them with later. `seal` holds writing to them: if anyone gets the notes
 * before it's posted, posting is refused, and the box shows who reads it now.
 */
export const SharedAudienceSchema = z.object({ audience: z.array(PersonSchema), seal: z.string() });

export type SharedAudience = z.infer<typeof SharedAudienceSchema>;


/** Something written straight into the shared notes, as it's posted: its words, and the seal of who it was going to. */
export const SharedWriteSchema = z.object({ text: z.string().trim().min(1).max(MAX_ADDITION_TEXT), seal: z.string().min(1).max(200) });

export type SharedWrite = z.infer<typeof SharedWriteSchema>;
