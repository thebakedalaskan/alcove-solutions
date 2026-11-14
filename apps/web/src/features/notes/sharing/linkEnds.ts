/* When a link to a call's notes stops opening anything, as Share lists it (share.tsx) and the page it opens says it (NoteLink.tsx). */
import { byWhen, daysFromToday, hm } from '~/lib/time';

/**
 * To the minute, as a link runs out at the time of day it was made, NOTE_LINK_DAYS later: "16:00 today", "tomorrow 16:00",
 * "Wed 11 Nov 16:00".
 */
export const linkEnds = (iso: string, now = Date.now()): string => (daysFromToday(new Date(iso), new Date(now)) <= 0 ? `${hm(iso)} today` : byWhen(iso, now));
