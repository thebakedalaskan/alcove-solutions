import { DEFAULT_SOUND_PREFERENCES, SoundPreferencesSchema } from './sounds';
import { NotesSettingSchema } from '../calls/settings';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
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
  followUpDue: z.boolean(),
  /** Someone tagged you in a document. On for anyone who hasn't said. */
  tagged: z.boolean().default(true)
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
  /** Older sealed profiles acquire these defaults when opened. */
  sounds: SoundPreferencesSchema.default(DEFAULT_SOUND_PREFERENCES),
  /** Pinned note IDs, in the order they were pinned. */
  pinned: z.array(IDSchema).max(MAX_PINS).refine(allUnique, 'Pins must be unique'),
  groups: z.array(GroupSchema).max(MAX_GROUPS).refine((g) => allUnique(g.map((x) => x.id)), 'Group IDs must be unique')
});

export type Preferences = z.infer<typeof PreferencesSchema>;


/** What the Team page's `group` opens: one of your groups by its ID, or NEW_GROUP to make one. From the address bar too. */
export const GroupParamSchema = IDSchema.min(1).max(200);

export const NEW_GROUP = 'new';


/** That someone finished or closed the tour of Home. Kept in their browser for their account, never sent anywhere. */
export const HomeTourSchema = z.object({ seenAt: ISODateSchema });

export type HomeTour = z.infer<typeof HomeTourSchema>;

/**
 * Signing in from the welcome page, so Home can sail out of the same cove: when a way in was pressed (ms), and where the hero's
 * cove stood on the window (px) if it was in view: the window's width, the horizon, how tall the sky was, where the nearest
 * cliffs met the water, how far the sun's middle stood below the horizon and its radius, which cove (its seed), and the boxes
 * of the words on its sky. Kept in that tab (sessionStorage) across the way out to the provider and back, used once and for
 * ten minutes at most, and never sent anywhere. Geometry only: nothing anyone typed or is called.
 */
export const SailOutStoredSchema = z.object({
  at: z.number(),
  hero: z.object({
    width: z.number(), line: z.number(), sky: z.number(), foot: z.number(), sun: z.number(), r: z.number(), seed: z.number(),
    words: z.array(z.object({ l: z.number(), r: z.number(), b: z.number() })).max(16).readonly()
  }).nullable()
});
export type SailOutStored = z.infer<typeof SailOutStoredSchema>;
