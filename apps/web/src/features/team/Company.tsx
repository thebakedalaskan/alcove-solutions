/*
 * The Team page with a company around you and no team (docs/design/pages.md › Team), inside the page's one evening
 * (TeamPage.tsx): your company, standing on the horizon, everyone in the arch they're known by, you in the middle and the
 * low sun behind them to the left, each opening a popover with everything about them; under the water, the invitations to
 * you at the top (invitations/ToYou.tsx), then your groups, the people not on Alcove yet, and notes shared with groups.
 * Nobody else here yet, it asks you to bring them. Inviting anyone starts your team, free, which Invite people says first,
 * and the page becomes the team's. Copy invite link copies your own invite link.
 */
import { errorMessage, type InvitationForYou, type Person, type Team } from '@alcove/api';
import { Button, Icon, cn } from '@alcove/ui';
import { useRef, type ReactNode, type Ref } from 'react';
import { useOnline } from '~/lib/live';
import { useInviteLink } from './queries';
import type { Member } from './data';
import { InvitationCardsFor, PutAside, type Joining } from './invitations/ToYou';
import type { Line, Sun } from './line';
import { personPop, useOpen } from './open';
import { InvitePeople, LINK_ON_ITS_WAY, PeopleToInvite, PeopleYouMeet, useCopyInvite } from './People';
import { AllPeople, PeopleLine, type Between } from './PeopleLine';

/** Why the company isn't on the page: no connection, or it didn't load. */
export type Trouble = 'offline' | 'failed' | undefined;

export function Company({ me, here, line, sun, first, off, directory, trouble, failed, onRetry, between, invitations, joining, groups, shared, filled, heading, onFind }: {
  me: Person;
  /** The company, once it's here. */
  here: Team | undefined;
  line: Line;
  sun: Sun;
  /** Nobody else at the company is on Alcove yet. */
  first: boolean;
  /** The people not on Alcove yet, in the order they stand. */
  off: Member[];
  /** The company is from a directory. */
  directory: boolean;
  trouble: Trouble;
  failed: unknown;
  onRetry: () => void;
  between: Between;
  invitations: readonly InvitationForYou[];
  joining: Joining;
  groups: ReactNode;
  shared: ReactNode;
  /** Invite people is the page's one filled button. */
  filled: boolean;
  /** The company's name, which takes the focus when the page becomes this. */
  heading: Ref<HTMLHeadingElement>;
  /** Someone found in the list of everyone: they come forward on the line. */
  onFind: (email: string) => void;
}) {
  const online = useOnline();
  const { open, setOpen } = useOpen();
  const copy = useCopyInvite();
  /* Your own invite link, once there's a company and no team. The loader asks for it too. */
  const invite = useInviteLink();
  /* What holds the cards, which folds away with the last of them. */
  const water = useRef<HTMLDivElement>(null);
  const waiting = invitations.some((i) => !i.putAside);
  const link = invite.data;
  /* Without your link there's nothing to copy: the page says why where Copy invite link is, and it waits. */
  const linkTrouble = !here || !first || link ? undefined : !online ? 'offline' : invite.isError ? 'failed' : undefined;
  return (
    <>
      <div className="tp-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tp-hero" aria-labelledby="tp-h">
          <h2 ref={heading} id="tp-h" tabIndex={-1} className="ac-clamp-2">{first ? 'Bring your team to Alcove' : here?.name ?? (trouble === 'offline' ? 'You’re offline' : trouble === 'failed' ? 'Your team didn’t load' : 'Your team')}</h2>
          {trouble && <p className="tp-why"><Icon name={trouble === 'offline' ? 'wifiOff' : 'alert'} size={18} />{trouble === 'offline' ? 'Your team shows here when you’re back.' : errorMessage(failed)}</p>}
          <div className="tp-acts">
            {here && <InvitePeople anchor={<Button variant={filled ? 'primary' : 'secondary'} size="lg" icon="addUser">Invite people</Button>} />}
            {first && (
              <Button size="lg" icon="link" disabled={!link} title={link ? undefined : LINK_ON_ITS_WAY}
                onClick={() => { if (link) void copy(link.link); }}>Copy invite link</Button>
            )}
            {here && line.recedes && (
              <AllPeople me={me} team={here} onFind={(email) => { onFind(email); setOpen(() => personPop(email)); }}
                anchor={<Button size="lg" icon="people">All {line.n} people</Button>} />
            )}
            {trouble && <Button variant="primary" size="lg" icon="retry" onClick={onRetry}>Try again</Button>}
          </div>
          {linkTrouble === 'offline' && <p className="tp-why is-link"><Icon name="wifiOff" size={18} />Copying your link needs a connection.</p>}
          {linkTrouble === 'failed' && (
            <p className="tp-why is-link">
              <Icon name="alert" size={18} />Your invite link didn’t load.
              <Button variant="quiet" size="sm" icon="retry" onClick={() => void invite.refetch()}>Try again</Button>
            </p>
          )}
        </section>
        <PeopleLine line={line} sun={sun} company={here?.name} waiting={!here && !trouble} between={between} />
      </div>
      {waiting && <div ref={water} className="ti-water" style={{ '--d': 1 }}><InvitationCardsFor invitations={invitations} joining={joining} lead={open === undefined} holder={water} /></div>}
      <div className={cn('tp-grid', first && 'is-first')} style={{ '--d': 1 }}>
        {first && here && <PeopleYouMeet team={here} people={off} directory={directory} meets={between.meets} now={between.now} />}
        {groups}
        {off.length > 0 && !first && <PeopleToInvite title="Not on Alcove yet" people={off} meets={between.meets} now={between.now} />}
        {shared}
        <PutAside invitations={invitations} joining={joining} now={between.now.getTime()} />
      </div>
    </>
  );
}
