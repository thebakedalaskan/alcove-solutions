/* Small pieces Home's cards share. */
import { errorMessage, type CalendarEvent } from '@alcove/api';
import { Icon, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { listNames } from '~/lib/people';
import { useAdoptEvent } from '~/lib/queries';
import { position } from '~/lib/time';

/** The way back to where something was said: a note, opening at the moment when the notes know it. */
export function Moment({ noteId, noteTitle, at }: { noteId: string; noteTitle: string; at?: number | undefined }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId }} search={{ at }} className="hm-moment" title={`From ${noteTitle}`}
      aria-label={at === undefined ? `Open ${noteTitle}` : `Open the moment at ${position(at)} in ${noteTitle}`}>
      <Icon name="moment" size={13} />{at === undefined ? 'Note' : position(at)}
    </Link>
  );
}

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
      toast(errorMessage(err), { icon: 'x' });
      return false;
    }
  };
  return { move };
}
