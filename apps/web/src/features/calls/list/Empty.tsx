/*
 * What the sheet says when a place has nothing in it, each its own way: the first day (No calls yet, with Connect Google
 * Calendar and Start a call now), nothing coming up, nothing past, nothing recorded in the room or shared with you, no
 * series, nobody's calls, nothing a search found, and a search that didn't go through. And the line that offers to connect
 * a calendar at the top of All calls and Coming up while there's none.
 */
import type { Person } from '@alcove/api';
import { Avatar, Button, EmptyState, Icon, buttonClass, type IconName } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useCallFlow } from '~/features/shell/context';
import { callName } from '~/lib/people';
import { calendarConnectUrl } from '~/lib/queries';

/** An empty arch, dashed, with what would be there. */
const Arch = ({ icon }: { icon: IconName }) => <span className="cs-empty-arch" aria-hidden="true"><Icon name={icon} size={24} /></span>;

const Said = ({ art, title, children, action }: { art: ReactNode; title: string; children: ReactNode; action?: ReactNode }) => (
  <div aria-live="polite"><EmptyState className="cs-empty" art={art} title={title} action={action}>{children}</EmptyState></div>
);

/** Before anything: no calls ahead or past. Connecting a calendar brings in the meetings already on it. */
export function FirstDay({ calendar }: { calendar: boolean }) {
  const flow = useCallFlow();
  return (
    <Said art={<Arch icon="calls" />} title="No calls yet"
      action={<>{!calendar && <a href={calendarConnectUrl()} className={buttonClass()}><Icon name="cal" size={18} />Connect Google Calendar</a>}<Button variant="quiet" icon="video" onClick={() => flow.start()}>Start a call now</Button></>}>
      {calendar ? 'Calls you start or schedule show here, and their notes after them.' : 'Connect Google Calendar and your meetings show here. Calls you start or schedule show here too, and their notes after them.'}
    </Said>
  );
}

/** A place with nothing in it: Coming up, Past calls, In the room, Shared with you, Series. */
export function NothingIn({ place }: { place: 'soon' | 'past' | 'room' | 'shared' | 'series' }) {
  const flow = useCallFlow();
  switch (place) {
    case 'soon': return <Said art={<Arch icon="cal" />} title="Nothing coming up">Calls you schedule, and the ones you’re invited to, show here.</Said>;
    case 'past': return <Said art={<Arch icon="clock" />} title="No calls yet" action={<Button variant="quiet" icon="video" onClick={() => flow.start()}>Start a call now</Button>}>Each call’s notes land here once it ends.</Said>;
    case 'room': return <Said art={<Arch icon="mic" />} title="Nothing recorded in the room yet" action={<Link to="/record" className={buttonClass({ variant: 'quiet' })}><Icon name="recordDot" size={18} />Record in the room</Link>}>Conversations you record in the room land here.</Said>;
    case 'shared': return <Said art={<Arch icon="share" />} title="Nothing shared with you yet">When someone shares their notes with you, they land here.</Said>;
    case 'series': return <Said art={<Arch icon="repeat" />} title="No series yet">A call that repeats shows here, with its next call.</Said>;
  }
}

/** Someone you have no calls with, ahead or past. */
export function NobodysCalls({ person, onAll }: { person: Person; onAll: () => void }) {
  return (
    <Said art={<span className="cs-empty-arch is-person" aria-hidden="true"><Avatar person={person} size={58} /></span>} title={`No calls with ${callName(person)} yet`}
      action={<Button variant="quiet" onClick={onAll}>Show every call</Button>}>
      Calls you’re both on show here, coming up first.
    </Said>
  );
}

/** Nothing has the words, or the search didn't go through. */
export function NothingFound({ term, failed, onClear, onRetry }: { term: string; failed: string | undefined; onClear: () => void; onRetry: () => void }) {
  if (failed) return <Said art={<Arch icon="search" />} title="Couldn’t search your calls" action={<Button icon="retry" onClick={onRetry}>Try again</Button>}>{failed}</Said>;
  return (
    <Said art={<Arch icon="search" />} title={`Nothing matches “${term}”`} action={<Button variant="quiet" onClick={onClear}>Clear search</Button>}>
      That covers names, summaries and everything said.
    </Said>
  );
}

/** Without a calendar only Alcove calls show: one line, at the top of All calls and Coming up, offers to connect it. */
export function ConnectLine() {
  return (
    <div className="cs-connect">
      <Icon name="cal" size={18} />
      <span>Connect Google Calendar and your other meetings show here. Calls you schedule go on it, with Google’s invitations.</span>
      <a href={calendarConnectUrl()} className={buttonClass({ size: 'sm' })}>Connect</a>
    </div>
  );
}
