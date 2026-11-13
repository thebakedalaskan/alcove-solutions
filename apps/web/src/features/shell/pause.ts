/*
 * Pause notifications, in your menu at the top right: For 30 minutes, For 1 hour or Until tomorrow, then Resume. The pause
 * is the account's `notificationsPausedUntil`; lib/notification-pause.ts has what the browser's alerts and the sounds ask of
 * it. This is how your menu and your face say it and change it.
 */
import { errorMessage } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNow } from '~/lib/live';
import { log } from '~/lib/log';
import { notificationsPauseEndOf, notificationsPauseHolds } from '~/lib/notification-pause';
import { q, usePauseNotifications } from '~/lib/queries';
import { dayMonth, daysFromToday, hm, weekday } from '~/lib/time';

const plog = log.child({ component: 'notification-pause' });

type PauseChoice = 'half-hour' | 'hour' | 'tomorrow';

/** A pause's times, on the app's 24-hour clock without the hour's leading zero: "9:00", "16:42". */
const clock = (d: Date): string => hm(d).replace(/^0(?=\d:)/, '');

/**
 * What Pause notifications offers at `now`, and when each would end: For 30 minutes and For 1 hour end on the minute
 * they say; Until tomorrow ends at 9:00 tomorrow, on this computer's clock. Every end falls on a whole minute.
 */
function pauseChoices(now: Date): readonly { id: PauseChoice; label: string; ends: string; until: Date }[] {
  const later = (minutes: number) => { const d = new Date(now); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + minutes); return d; };
  const half = later(30);
  const hour = later(60);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { id: 'half-hour', label: 'For 30 minutes', ends: clock(half), until: half },
    { id: 'hour', label: 'For 1 hour', ends: clock(hour), until: hour },
    { id: 'tomorrow', label: 'Until tomorrow', ends: clock(tomorrow), until: tomorrow }
  ];
}

/** When a pause ends, as the menu says it: "17:12" the same day, "tomorrow 9:00" the next, "Thu 9:00" that week, then "20 Nov 9:00". */
function pauseEndLabel(until: Date, now: Date): string {
  const days = daysFromToday(until, now);
  if (days <= 0) return clock(until);
  if (days === 1) return `tomorrow ${clock(until)}`;
  if (days < 7) return `${weekday(until).slice(0, 3)} ${clock(until)}`;
  return `${dayMonth(until)} ${clock(until)}`;
}

/**
 * The signed-in account's pause, for your menu and your face: `until`, its end as it's said ("17:12", "tomorrow 9:00"), while
 * one holds, else null; the `choices`, each with the time it would end; and pausing (by a choice's `id`) or resuming, which
 * show at once, and one that's refused is put back and says why in a toast. One clock, read on each whole minute: every end
 * the menu sets falls on one, so what's said lets go of a pause as it ends, and the choices' ends stay true while the page
 * is open.
 */
export function usePause(): { until: string | null; choices: readonly { id: string; label: string; ends: string }[]; pending: boolean; pause: (id: string) => void; resume: () => void } {
  const prefs = useQuery(q.prefs()).data;
  const write = usePauseNotifications();
  const toast = useToast();
  const now = useNow(60_000);
  const choices = useMemo(() => pauseChoices(new Date(now)), [now]);
  const end = notificationsPauseEndOf(prefs);
  // Each press keeps its own answer (mutateAsync), so a refusal is said even once the menu has closed.
  const save = (until: string | null, failed: string) => {
    write.mutateAsync({ until }).catch((e: unknown) => {
      plog.warn(until === null ? 'notifications not resumed' : 'notifications not paused', { err: e });
      toast(`${failed} ${errorMessage(e)}`, { icon: 'x', topic: 'notification-pause' });
    });
  };
  return {
    until: end !== null && notificationsPauseHolds(end, now) ? pauseEndLabel(new Date(end), new Date(now)) : null,
    choices,
    pending: write.isPending,
    pause: (id) => {
      const picked = choices.find((c) => c.id === id);
      if (!picked) return;
      plog.info('notifications paused', { choice: picked.id });
      save(picked.until.toISOString(), 'Couldn’t pause notifications.');
    },
    resume: () => {
      plog.info('notifications resumed');
      save(null, 'Couldn’t resume notifications.');
    }
  };
}
