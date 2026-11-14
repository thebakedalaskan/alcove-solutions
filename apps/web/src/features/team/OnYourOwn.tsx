/*
 * The Team page on your own (docs/design/pages.md › Team): no company around you, no team, and no invitation to you waiting,
 * inside the page's one evening (TeamPage.tsx), in the company page's first-day look. Start your team in the sky, what a
 * team costs in one line, and you on the horizon beside empty arches for the people you'll bring, the low sun in one of them.
 * Invite people (filled) takes whole addresses, and the first invitation starts the team, named for you ("Art’s team"), which
 * its popover says before anything is sent. Name your team starts it by a name of your own first, in a popover over the
 * button, as Rename's is. Either way the team is free, you're its admin, and the page becomes the team's, the focus on its
 * name. Under the water, your groups, what's shared with them, and the invitations you put aside.
 */
import { errorCode, errorMessage, type InvitationForYou, type Person } from '@alcove/api';
import { Button, PlanTeamStart, Popover } from '@alcove/ui';
import { useState, type ReactNode, type Ref } from 'react';
import { log } from '~/lib/log';
import { ownTeamName } from '~/lib/people';
import { PutAside, type Joining } from './invitations/ToYou';
import type { Line, Sun } from './line';
import { usePop } from './open';
import { InvitePeople } from './People';
import { PeopleLine, type Between } from './PeopleLine';
import { useCreateTeam } from './queries';

const tlog = log.child({ component: 'team' });

export function OnYourOwn({ me, line, sun, between, invitations, joining, groups, shared, filled, heading, onStarting }: {
  me: Person;
  /** You, beside empty arches. */
  line: Line;
  sun: Sun;
  between: Between;
  /** The invitations to you, all put aside. */
  invitations: readonly InvitationForYou[];
  joining: Joining;
  groups: ReactNode;
  shared: ReactNode;
  /** Invite people is the page's one filled button. */
  filled: boolean;
  /** Start your team, which takes the focus when the page becomes this. */
  heading: Ref<HTMLHeadingElement>;
  /** The team is about to start: the team's page, which takes this one's place, takes the focus at its name. */
  onStarting: () => void;
}) {
  return (
    <>
      <div className="tp-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tp-hero" aria-labelledby="tp-h" aria-describedby="tp-lede">
          <h2 ref={heading} id="tp-h" tabIndex={-1} className="ac-clamp-2">Start your team</h2>
          <p id="tp-lede" className="tp-lede">Invite people by email, or name your team first. It’s free: licenses only when you want to share notes and workspaces.</p>
          <div className="tp-acts">
            <InvitePeople anchor={<Button variant={filled ? 'primary' : 'secondary'} size="lg" icon="addUser">Invite people</Button>} />
            <NameYourTeam me={me} onStarting={onStarting} />
          </div>
        </section>
        <PeopleLine line={line} sun={sun} company={undefined} between={between} />
      </div>
      <div className="tp-grid" style={{ '--d': 1 }}>
        {groups}
        {shared}
        <PutAside invitations={invitations} joining={joining} now={between.now.getTime()} />
      </div>
    </>
  );
}

/**
 * Name your team: the kit's PlanTeamStart in a popover over the button, the name the team would take filled in, and Start the
 * team, which makes it (free, with you its admin). A name it won't take is said in place, in the server's words. One popover
 * at a time on the page, so its Start the team is the filled button while it's open.
 */
function NameYourTeam({ me, onStarting }: { me: Person; onStarting: () => void }) {
  const pop = usePop('name team');
  const create = useCreateTeam();
  const [name, setName] = useState(() => ownTeamName(me));
  const [refused, setRefused] = useState<string | null>(null);
  const opened = (on: boolean) => {
    if (on) { setName(ownTeamName(me)); setRefused(null); }
    pop.onOpenChange(on);
  };
  /* Made, the page is the team's at once and this popover goes with this view: what's open over the page closes with it. */
  const start = () => {
    onStarting();
    void create.mutateAsync(name.trim()).then(
      () => { tlog.info('team started', { from: 'team page' }); opened(false); },
      (e: unknown) => { tlog.info('team not started', { code: errorCode(e) }); setRefused(errorMessage(e)); }
    );
  };
  return (
    <Popover open={pop.open} onOpenChange={opened} align="center" caret label="Name your team" anchor={<Button size="lg" icon="pen">Name your team</Button>}>
      <PlanTeamStart label="Name your team" value={name} onChange={(v) => { setName(v); setRefused(null); }} busy={create.isPending} error={refused}
        onCancel={() => opened(false)} onStart={start} />
    </Popover>
  );
}
