import { z } from '../../shared/zod';
/**
 * Whether a call writes notes. It's decided when the call is scheduled; during the call only the
 * organizer can change it, and anyone else can ask them to.
 */
export const NotesSettingSchema = z.enum(['on', 'off']);

export type NotesSetting = z.infer<typeof NotesSettingSchema>;


/**
 * What a call's notes keep, set when it's scheduled. Without the transcript, it's used to write the notes and then
 * deleted. Without the recording, the audio is deleted when the call ends. `allowScreens`: the organizer lets shared screens
 * go in the notes; each presenter is asked whether theirs does. Without it nobody is asked and no share is kept.
 * Meetings stored before it existed allow them.
 */
export const NotesChoicesSchema = z.object({ keepTranscript: z.boolean(), keepRecording: z.boolean(), allowScreens: z.boolean().default(true) });

export type NotesChoices = z.infer<typeof NotesChoicesSchema>;

/** What a call keeps unless it's set otherwise: every call before these choices existed kept all of it. */
export const DEFAULT_NOTES_CHOICES: NotesChoices = { keepTranscript: true, keepRecording: true, allowScreens: true };
