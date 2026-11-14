/* Moving one of your calendar meetings to Alcove, from Home's Upcoming and from a row's menu on Calls. */
import type { CalendarEvent } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { toastFailure } from '~/lib/failed';
import { listNames } from '~/lib/people';
import { useAdoptEvent } from './queries';

/**
 * Makes one of your calendar meetings an Alcove call, and says who gets the new link. It waits for its own
 * answer, so what it says never depends on what else happened meanwhile; it resolves true once it's done.
 */
export function useMoveToAlcove() {
  const adopt = useAdoptEvent();
  const toast = useToast();
  const move = async (e: CalendarEvent): Promise<boolean> => {
    try {
      const m = await adopt.mutateAsync({ eventId: e.id });
      toast(`${m.title} is an Alcove call now.${m.guests.length ? ` ${listNames(m.guests)} ${m.guests.length > 1 ? 'get' : 'gets'} the new link.` : ''}`, { icon: 'video' });
      return true;
    } catch (err) {
      toastFailure(toast, err);
      return false;
    }
  };
  return { move };
}
