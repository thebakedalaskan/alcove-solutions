/*
 * The invitations to you, on the Team page (the design's 4.4–4.6). On no team, one card each (JoinCard), newest first: the
 * team's faces, who invited you, who's on it, Not now and Join. On a team, a note at the top of its water instead. Join puts
 * you on the team at once, and the page is the team's, with the focus on its name. While you're on another team it asks in
 * place first (leaving it, or deleting it if you're alone on it), and Stay, or Escape, puts the focus back on Join; an admin
 * with others on their team can't join yet, which is said in Join's place. Not now folds the card away and puts it aside:
 * out of the count, quiet under Put aside with Join still there (which takes the focus) until it runs out, and its toast has
 * Undo (invitations/aside.ts). Nobody is told either way.
 */
import { errorCode, errorMessage, type InvitationForYou, type MyTeam } from '@alcove/api';
import { Button, InvitationCards, InvitationNote, InvitationRow, JoinCard, TeamAsk, TeamRows, TeamSection, foldAway, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import { log } from '~/lib/log';
import { useOpen } from '../open';
import { teamQueries, useAcceptInvitation, useNotNow } from '../queries';
import { UNDO_MS } from './aside';
import { cantJoin, leaveAsk, leavingOf, type Leaving } from './leaving';
import { asideSaid, invitedYou, putAsideLine, whoIsOn } from './words';

const jlog = log.child({ component: 'team-invitations' });
/** What's open over the page while joining asks first, by the invitation's ID. */
const ASKING = 'join ';
/** Whether whoever's looking asked for less motion: then going to a card doesn't glide there. */
const still = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Joining by an invitation to you, and what it asks first: shared by the cards, the notes and Put aside on a page. */
export interface Joining {
  leaving: Leaving;
  /** The invitation whose question is open, in place of its Join. */
  asking: string | null;
  /** The invitation being joined now. */
  busy: string | null;
  /** Join, as pressed: it joins, or asks first. */
  press: (i: InvitationForYou) => void;
  /** Join, having been asked (`leave`), or with nothing to ask. */
  join: (i: InvitationForYou, leave: boolean) => void;
  /** Stay, or Escape: the question closes, and its Join takes the focus. */
  keep: () => void;
  /** Not now: `fold` (its card, or what holds it when it's the last) folds away, then it's put aside, with Undo. */
  aside: (i: InvitationForYou, fold: HTMLElement | null) => void;
  /** Where an invitation's Join is, so the focus can come back to it, or be sent to it. */
  joinRef: (id: string) => (el: HTMLButtonElement | null) => void;
  /** Goes to an invitation's Join: into view, and focused. */
  toJoin: (id: string) => void;
}

/** `joined`: once you're on the team, as the page becomes its own. */
export function useJoining(mine: MyTeam | null | undefined, joined: () => void): Joining {
  const accept = useAcceptInvitation();
  const notNow = useNotNow();
  const qc = useQueryClient();
  const toast = useToast();
  /* Joining's question is open over the page, as a popover would be: it has the page's one filled button meanwhile. */
  const { open, setOpen } = useOpen();
  const setAsking = (id: string | null) => setOpen((was) => (id !== null ? `${ASKING}${id}` : was !== undefined && was.startsWith(ASKING) ? undefined : was));
  const leaving = leavingOf(mine);
  /* Only a member, or an admin alone on their team, is asked. */
  const asks = leaving.kind === 'member' || leaving.kind === 'alone';
  const asking = asks && open !== undefined && open.startsWith(ASKING) ? open.slice(ASKING.length) : null;
  /* Each Join on the page, by its invitation, and the one to take the focus as soon as it's there. */
  const joins = useRef(new Map<string, HTMLButtonElement>());
  const want = useRef<string | null>(null);
  const focusJoin = (id: string) => {
    want.current = id;
    requestAnimationFrame(() => {
      const el = joins.current.get(id);
      if (el?.isConnected && want.current === id) { want.current = null; el.focus(); }
    });
  };
  const join = (i: InvitationForYou, leave: boolean) => accept.mutate({ id: i.id, leave }, {
    onSuccess: (t) => { setAsking(null); joined(); toast(`You’re on ${t.name || i.team.name}.`, { icon: 'people' }); },
    onError: (e) => {
      const code = errorCode(e);
      jlog.info('an invitation not accepted', { code, leave });
      setAsking(null);
      // On a team this page didn't know of (joined from another tab): with the team read again, it asks, if the invitation
      // still stands for you; otherwise it says why, in the server's words.
      if (code === 'conflict' && !leave) {
        void Promise.all([qc.fetchQuery({ ...teamQueries.myTeam(), staleTime: 0 }), qc.fetchQuery({ ...teamQueries.invitations(), staleTime: 0 })]).then(
          ([now, list]) => { if (now && list.some((x) => x.id === i.id)) setAsking(i.id); else toast(errorMessage(e), { icon: 'x' }); },
          () => toast(errorMessage(e), { icon: 'x' })
        );
        return;
      }
      toast(errorMessage(e), { icon: 'x' });
      focusJoin(i.id);
    }
  });
  return {
    leaving, asking,
    busy: accept.isPending ? accept.variables?.id ?? null : null,
    press: (i) => { if (asks) setAsking(i.id); else if (leaving.kind === 'none') join(i, false); },
    join,
    keep: () => { if (asking !== null) focusJoin(asking); setAsking(null); },
    aside: (i, fold) => {
      if (asking === i.id) setAsking(null);
      const put = () => {
        notNow.aside(i.id, (e) => { jlog.info('an invitation not put aside', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); });
        focusJoin(i.id);
        toast(asideSaid(i.expiresAt), {
          icon: 'check', ms: UNDO_MS, topic: `aside ${i.id}`,
          action: { label: 'Undo', onClick: () => { if (notNow.undo(i.id)) focusJoin(i.id); } }
        });
      };
      if (fold) foldAway(fold, put); else put();
    },
    joinRef: (id) => (el) => {
      if (!el) return;
      joins.current.set(id, el);
      if (want.current === id) { want.current = null; el.focus(); }
    },
    toJoin: (id) => {
      const el = joins.current.get(id);
      if (!el?.isConnected) return;
      el.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    }
  };
}

/** What's asked in place of Join for `i`, while its question is open. */
function Ask({ i, joining }: { i: InvitationForYou; joining: Joining }) {
  const ask = joining.asking === i.id ? leaveAsk(joining.leaving, { name: i.team.name, from: i.from }) : null;
  if (!ask) return null;
  return <TeamAsk title={ask.title} text={ask.text} confirm={ask.confirm} keep={ask.keep} busy={joining.busy === i.id} onConfirm={() => joining.join(i, true)} onKeep={joining.keep} />;
}

/** The element that holds one, as a page lays them out: Not now folds that away when the last one goes. */
type Holder = RefObject<HTMLElement | null>;

/**
 * The invitations to you not put aside, one card each, newest first. The first card's Join is the page's filled button
 * (`lead`), unless something else on the page has it. `holder`: what holds the cards on the page, which folds away with the
 * last of them (the cards' own group, unless said).
 */
export function InvitationCardsFor({ invitations, joining, lead, holder }: { invitations: readonly InvitationForYou[]; joining: Joining; lead: boolean; holder?: Holder | undefined }) {
  const group = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const waiting = invitations.filter((i) => !i.putAside);
  if (!waiting.length) return null;
  return (
    <InvitationCards ref={group} label="Invitations to you" className="ti-for-you">
      {waiting.map((i, n) => {
        const blocked = cantJoin(joining.leaving, i.team.name);
        const asking = joining.asking === i.id;
        return (
          <JoinCard key={i.id} ref={(el) => { if (el) cards.current.set(i.id, el); else cards.current.delete(i.id); }}
            level={2} faces={i.team.faces} title={invitedYou(i)} line={whoIsOn(i.team, i.from)} note={blocked}
            ask={asking ? <Ask i={i} joining={joining} /> : undefined}
            actions={(
              <>
                <Button variant="quiet" disabled={joining.busy === i.id}
                  onClick={() => joining.aside(i, waiting.length === 1 ? holder?.current ?? group.current : cards.current.get(i.id) ?? null)}>Not now</Button>
                {blocked === null && (
                  <Button ref={joining.joinRef(i.id)} variant={lead && n === 0 ? 'primary' : 'secondary'} loading={joining.busy === i.id && !asking}
                    onClick={() => joining.press(i)}><span className="ac-clamp-1">Join {i.team.name}</span></Button>
                )}
              </>
            )} />
        );
      })}
    </InvitationCards>
  );
}

/** On a team: each invitation to another team, said at the top of its water, with Join and Not now. */
export function InvitationNotesFor({ invitations, joining, lead }: { invitations: readonly InvitationForYou[]; joining: Joining; lead: boolean }) {
  const group = useRef<HTMLDivElement>(null);
  const notes = useRef(new Map<string, HTMLElement>());
  const waiting = invitations.filter((i) => !i.putAside);
  if (!waiting.length) return null;
  return (
    <div ref={group} className="tq-invited-you ti-notes">
      {waiting.map((i, n) => {
        const blocked = cantJoin(joining.leaving, i.team.name);
        return (
          <InvitationNote key={i.id} ref={(el) => { if (el) notes.current.set(i.id, el); else notes.current.delete(i.id); }}
            person={i.from} title={`${invitedYou(i)}.`} line={whoIsOn(i.team, i.from)} note={blocked}
            ask={joining.asking === i.id ? <Ask i={i} joining={joining} /> : undefined}
            actions={(
              <>
                <Button variant="quiet" size="sm" disabled={joining.busy === i.id}
                  onClick={() => joining.aside(i, waiting.length === 1 ? group.current : notes.current.get(i.id) ?? null)}>Not now</Button>
                {blocked === null && (
                  <Button ref={joining.joinRef(i.id)} variant={lead && n === 0 ? 'primary' : 'secondary'} size="sm" loading={joining.busy === i.id}
                    onClick={() => joining.press(i)}><span className="ac-clamp-1">Join {i.team.name}</span></Button>
                )}
              </>
            )} />
        );
      })}
    </div>
  );
}

/** The invitations you put aside, quiet, each with Join still there until it runs out (unless you can't join yet). */
export function PutAside({ invitations, joining, now }: { invitations: readonly InvitationForYou[]; joining: Joining; now: number }) {
  const aside = invitations.filter((i) => i.putAside);
  if (!aside.length) return null;
  return (
    <TeamSection title="Put aside" className="ti-aside">
      <TeamRows>
        {aside.map((i) => {
          const blocked = cantJoin(joining.leaving, i.team.name);
          const yours = joining.leaving.kind === 'blocked' ? joining.leaving.team.name : '';
          return (
            <InvitationRow key={i.id} person={i.from} title={invitedYou(i)}
              line={blocked === null ? putAsideLine(i, now) : `${putAsideLine(i, now)} · You can join once you’re the only one left on ${yours}`}
              actions={joining.asking === i.id || blocked !== null ? undefined : (
                <Button ref={joining.joinRef(i.id)} variant="secondary" size="sm" loading={joining.busy === i.id}
                  aria-label={`Join ${i.team.name}`} onClick={() => joining.press(i)}>Join</Button>
              )}>
              {joining.asking === i.id ? <Ask i={i} joining={joining} /> : null}
            </InvitationRow>
          );
        })}
      </TeamRows>
    </TeamSection>
  );
}
