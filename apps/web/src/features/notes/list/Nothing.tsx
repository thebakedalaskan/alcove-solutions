/* What the list says when nothing in it is shown: for a search, a filter, or someone with no notes in common. */
import type { Person } from '@alcove/api';
import { Avatar, Button, EmptyState, Icon, buttonClass, type IconName } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useCallFlow } from '~/features/shell/context';
import { callName } from '~/lib/people';
import type { Show } from './Sky';

/** An empty arch with what would be there, beside someone it's about. */
const Art = ({ icon, person }: { icon: IconName; person?: Person | undefined }) => (
  <span className="nt-arts" aria-hidden="true">
    {person && <Avatar person={person} size={58} />}
    <span className="nt-ghost"><Icon name={icon} size={22} /></span>
  </span>
);

const Said = ({ art, title, children, action }: { art: ReactNode; title: string; children: ReactNode; action?: ReactNode }) => (
  <div aria-live="polite"><EmptyState className="nt-none" art={art} title={title} action={action}>{children}</EmptyState></div>
);

export function Nothing({ term, show, person, failed, onRetry, onClear, onAll, onAnyone }: {
  term: string; show: Show; person: Person | undefined;
  /** Why the search didn't get an answer, when it didn't. */
  failed: string | undefined;
  onRetry: () => void; onClear: () => void; onAll: () => void; onAnyone: () => void;
}) {
  const flow = useCallFlow();
  const narrowed = show !== 'all' || !!person;
  if (failed) return <Said art={<Art icon="search" />} title="Couldn’t search your notes" action={<Button variant="primary" onClick={onRetry}>Try again</Button>}>{failed}</Said>;
  if (term) {
    return (
      <Said art={<Art icon="search" />} title={`Nothing matches “${term}”`}
        action={<><Button variant="primary" onClick={onClear}>Clear search</Button>{narrowed && <Button variant="quiet" onClick={onAll}>Search all notes</Button>}</>}>
        {narrowed ? 'Only the notes shown here were searched.' : 'That covers titles, summaries and everything said.'}
      </Said>
    );
  }
  if (person) {
    const name = callName(person);
    const title = show === 'shared' ? `${name} hasn’t shared any notes with you` : show === 'call' ? `No calls with ${name}`
      : show === 'room' ? `No recordings in the room with ${name}` : `No notes with ${name} yet`;
    return <Said art={<Art icon="notes" person={person} />} title={title} action={<Button variant="primary" onClick={onAnyone}>Show notes with anyone</Button>}>Notes from calls and recordings you both have show up here.</Said>;
  }
  if (show === 'shared') return <Said art={<Art icon="share" />} title="Nothing shared with you yet">When someone shares their notes with you, they land here.</Said>;
  if (show === 'room') {
    return (
      <Said art={<Art icon="recordDot" />} title="Nothing recorded in the room yet" action={<Link to="/record" className={buttonClass({ variant: 'primary' })}>Record in the room</Link>}>
        Conversations you record in the room land here.
      </Said>
    );
  }
  return (
    <Said art={<Art icon="notes" />} title={show === 'call' ? 'No calls with notes yet' : 'No notes yet'} action={<Button variant="primary" icon="video" onClick={() => flow.start()}>Start a call</Button>}>
      Calls with notes on land here as soon as they end.
    </Said>
  );
}
