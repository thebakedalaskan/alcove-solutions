import { DEFAULT_SOUND_PREFERENCES, SoundPreferencesInputSchema, SoundPreferencesSchema } from './sounds';
import { NotesSettingSchema } from '../calls/notes/settings';
import { ModelIdSchema } from '../notes/models';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/** Languages notes can be written in. `call` writes them in the language the call was spoken in. */
export const NOTES_LANGUAGES = ['call', 'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'zh', 'ko', 'hi', 'ar'] as const;

export const NotesLanguageSchema = z.enum(NOTES_LANGUAGES);

export type NotesLanguage = z.infer<typeof NotesLanguageSchema>;


/**
 * A call's reply and mention toasts once had switches of their own (`replyAlerts`, `mentionAlerts`, on unless turned off)
 * beside the browser's `replies` and `chatMentions`, which now drive both. A record that still holds one keeps an alert
 * that was on, and the next save writes it without them.
 */
function foldAlerts(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const folded: Record<string, unknown> = { ...v };
  if ('replyAlerts' in v && typeof v.replyAlerts === 'boolean') folded['replies'] = ('replies' in v && v.replies === true) || v.replyAlerts;
  if ('mentionAlerts' in v && typeof v.mentionAlerts === 'boolean') folded['chatMentions'] = ('chatMentions' in v && v.chatMentions === true) || v.mentionAlerts;
  return folded;
}

/**
 * Each thing that can reach someone, and whether it does from the browser while Alcove isn't in front, once `enabled` and
 * the browser allows it. `replies` and `chatMentions` also gate a call's brief alerts on screen, whatever the browser's
 * permission; the other ticks gate only the browser. The defaults are what a record written before a field existed reads as.
 */
const NotificationFields = z.object({
  /** Older profiles keep their existing browser opt-in; new profiles explicitly start false. */
  enabled: z.boolean().default(true),
  privateMessages: z.boolean().default(false),
  /** Replies to you in a call. A record from before both this and `replyAlerts` had the call's reply alert on. */
  replies: z.boolean().default(true),
  /** Mentions of you in a call's chat. A record from before both this and `mentionAlerts` had the call's mention alert on. */
  chatMentions: z.boolean().default(true),
  hands: z.boolean().default(false),
  questions: z.boolean().default(false),
  admissions: z.boolean().default(false),
  timers: z.boolean().default(false),
  /** Someone ringing you: from the browser while Alcove isn't in front (the ring's card and sound are always there). */
  ringing: z.boolean().default(true),
  /** Minutes before a call to remind: 0 is off. */
  beforeCall: z.union([z.literal(0), z.literal(1), z.literal(5)]),
  notesReady: z.boolean(),
  sharedWithYou: z.boolean(),
  notesRequested: z.boolean(),
  followUpDue: z.boolean(),
  /** Someone tagged you in a document. On for anyone who hasn't said. */
  tagged: z.boolean().default(true),
  /** Your plan: Pro about to end, renewed or ended. On for anyone who hasn't said. */
  plan: z.boolean().default(true)
});

/** As stored, in a profile or a guest's browser: older records fold their call alerts in as they're read. */
export const NotificationPrefsSchema = z.preprocess(foldAlerts, NotificationFields);

export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
/** Complete current wire group; stored upgrade defaults must never enable a missing request field, and nothing is folded. */
export const NotificationPrefsInputSchema = z.object({
  enabled: NotificationFields.shape.enabled.removeDefault(),
  privateMessages: NotificationFields.shape.privateMessages.removeDefault(),
  replies: NotificationFields.shape.replies.removeDefault(),
  chatMentions: NotificationFields.shape.chatMentions.removeDefault(),
  hands: NotificationFields.shape.hands.removeDefault(),
  questions: NotificationFields.shape.questions.removeDefault(),
  admissions: NotificationFields.shape.admissions.removeDefault(),
  timers: NotificationFields.shape.timers.removeDefault(),
  ringing: NotificationFields.shape.ringing.removeDefault(),
  tagged: NotificationFields.shape.tagged.removeDefault(),
  beforeCall: NotificationFields.shape.beforeCall,
  notesReady: NotificationFields.shape.notesReady,
  sharedWithYou: NotificationFields.shape.sharedWithYou,
  notesRequested: NotificationFields.shape.notesRequested,
  followUpDue: NotificationFields.shape.followUpDue,
  plan: NotificationFields.shape.plan.removeDefault(),
} satisfies { [K in keyof NotificationPrefs]: z.ZodType<NotificationPrefs[K]> });

/** New accounts and guests: the browser is opt-in; everything else reaches them but new questions and follow-ups. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPrefs = {
  enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: false, admissions: true, timers: true, ringing: true,
  beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true, plan: true
};


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

/**
 * The longest a pause's end can be. A date-time to the nanosecond, with its offset, is 35 characters
 * ("2026-11-13T09:00:00.123456789+01:00"), but an ISO date-time takes any number of fractions of a second, and whatever is
 * taken is sealed into the profile and kept in every revision of it.
 */
const MAX_PAUSED_UNTIL = 40;


export const PreferencesSchema = z.object({
  /** Whether new calls start with notes on. Each call can still be set when it's scheduled. */
  notesDefault: NotesSettingSchema,
  notesLanguage: NotesLanguageSchema,
  /** Put the notes link on the calendar event of calls you schedule. */
  addToCalendar: z.boolean(),
  /** Show calendar events that aren't Alcove calls. */
  showOtherMeetings: z.boolean(),
  /**
   * Show the calendar events with only you on them in Home's Upcoming, quieter, in their days. Otherwise it counts them at
   * its foot. A profile written before this existed reads as not shown.
   */
  showSoloEvents: z.boolean().default(false),
  /** Keep recording on this device when the connection drops, and upload afterwards. */
  recordOffline: z.boolean(),
  notifications: NotificationPrefsSchema,
  /** Older sealed profiles acquire these defaults when opened. */
  sounds: SoundPreferencesSchema.default(DEFAULT_SOUND_PREFERENCES),
  /** Pinned note IDs, in the order they were pinned. */
  pinned: z.array(IDSchema).max(MAX_PINS).refine(allUnique, 'Pins must be unique'),
  groups: z.array(GroupSchema).max(MAX_GROUPS).refine((g) => allUnique(g.map((x) => x.id)), 'Group IDs must be unique'),
  /** The model that does the AI work for calls you organize, by its ID in `models.list()`. Null means the default model. */
  model: ModelIdSchema.nullable().default(null),
  /**
   * Pause notifications: until when nothing reaches this person from the browser or by sound, on every device signed in,
   * but their own microphone and someone asking to join a call they host. Null, or a time already past, is not paused;
   * a profile written before this existed reads as not paused.
   */
  notificationsPausedUntil: z.iso.datetime({ offset: true }).max(MAX_PAUSED_UNTIL).nullable().default(null)
});

export type Preferences = z.infer<typeof PreferencesSchema>;
/**
 * Flat leaves are optional; an included notification or sound group is complete, with no input defaults. `model` and
 * `notificationsPausedUntil` take null (the default model; not paused), and a patch that leaves them out keeps them, as one
 * that leaves out `showSoloEvents` does.
 */
export const PreferencesPatchSchema = PreferencesSchema.extend({
  model: ModelIdSchema.nullable(), notificationsPausedUntil: PreferencesSchema.shape.notificationsPausedUntil.removeDefault(),
  showSoloEvents: PreferencesSchema.shape.showSoloEvents.removeDefault()
}).partial().extend({
  notifications: NotificationPrefsInputSchema.optional(), sounds: SoundPreferencesInputSchema.optional()
});



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
