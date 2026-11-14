/*
 * Start a team, on Plans' Team card (and on the plan choice's, which is the same card): it's free (the design's 4.10). The
 * card's button opens the team's name in a popover anchored to it, as the team's Rename does (the kit's PlanTeamStart: the
 * company's name filled in at a company, else "Art's team"), and Start the team makes it, with you its admin, and goes to its
 * page, where people are invited and it's upgraded. The welcome page's Start a team lands on Plans with it open
 * (`?checkout=team`). Checkout opened on Team with no team starts one the same way, in its window (`useStartTeam`, in
 * CheckoutHost.tsx). Nothing is bought here.
 */
import { errorCode, errorMessage, firstName } from '@alcove/api';
import { Button, PlanTeamStart, Popover } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { accountQueries } from '~/features/account/queries';
import { teamQueries, useCreateTeam } from '~/features/team/queries';
import { log } from '~/lib/log';

const slog = log.child({ component: 'plans' });

/** Starting a team, wherever it's offered: its name and why it wasn't started, and starting it. */
export interface StartingTeam {
  /** What's typed, once anything is: until then the company's name, or "Art's team" at a personal address. */
  name: string;
  /** Nothing to start yet: the name is empty. */
  blank: boolean;
  busy: boolean;
  /** Why it wasn't started, in the server's words. */
  refused: string | null;
  rename: (name: string) => void;
  /** Back to the name it starts with, and nothing refused. */
  reset: () => void;
  /** Makes the team, free, with you its admin; `then` once it's made, to go to its page. */
  start: (then: () => void) => void;
}

export function useStartTeam(): StartingTeam {
  const me = useQuery(accountQueries.session()).data?.user;
  const company = useQuery(teamQueries.team()).data;
  const create = useCreateTeam();
  const [typed, setTyped] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const name = typed ?? company?.name ?? (me ? `${firstName(me.name)}’s team` : '');
  return {
    name, blank: name.trim() === '', busy: create.isPending, refused,
    rename: (v) => { setTyped(v); setRefused(null); },
    reset: () => { setTyped(null); setRefused(null); },
    start: (then) => create.mutate(name.trim(), {
      onSuccess: () => { slog.info('team started'); then(); },
      onError: (e) => { slog.info('team not started', { code: errorCode(e) }); setRefused(errorMessage(e)); }
    })
  };
}

/**
 * Team's Start a team on Plans, and the popover it opens. `naming`: the popover is open, so its Start the team is the one
 * filled button on the page; the welcome page's Start a team opens it as Plans opens.
 */
export function StartTeam({ naming, onNaming }: { naming: boolean; onNaming: (on: boolean) => void }) {
  const team = useStartTeam();
  const navigate = useNavigate();
  const opened = (on: boolean) => {
    if (on) team.reset();
    onNaming(on);
  };
  return (
    <Popover open={naming} onOpenChange={opened} align="center" caret label="Start a team" anchor={<Button variant="secondary">Start a team</Button>}>
      <PlanTeamStart value={team.name} onChange={team.rename} busy={team.busy} error={team.refused} onCancel={() => opened(false)}
        onStart={() => team.start(() => void navigate({ to: '/team' }))} />
    </Popover>
  );
}
