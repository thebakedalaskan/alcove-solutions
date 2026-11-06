import { z } from '../shared/zod';
/**
 * Whether a call writes notes. It's decided when the call is scheduled; during the call only the
 * organizer can change it, and anyone else can ask them to.
 */
export const NotesSettingSchema = z.enum(['on', 'off']);

export type NotesSetting = z.infer<typeof NotesSettingSchema>;


/**
 * What a call's notes keep, set when it's scheduled. Without the transcript, it's used to write the notes and then
 * deleted. Without the recording, the audio is deleted when the call ends. `readScreens` has shared screens go into
 * the notes from the moment notes start, instead of when the organizer turns that on.
 */
export const NotesChoicesSchema = z.object({ keepTranscript: z.boolean(), keepRecording: z.boolean(), readScreens: z.boolean() });

export type NotesChoices = z.infer<typeof NotesChoicesSchema>;

/** What a call keeps unless it's set otherwise: every call before these choices existed kept all of it. */
export const DEFAULT_NOTES_CHOICES: NotesChoices = { keepTranscript: true, keepRecording: true, readScreens: false };
