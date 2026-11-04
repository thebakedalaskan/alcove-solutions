/*
 * The first day, before any notes: the example note (marked as one, and never counted), and your team:
 * who's here already, who isn't yet, and a way to bring them.
 */
import { errorMessage, type Team } from '@alcove/api';
import { Avatar, Button, Card, EmptyState, GhostArch, Icon, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { NoteCard } from '~/features/notes/NoteCard';
import { someNames } from '~/lib/people';
import { q, useInviteTeam } from '~/lib/queries';
import { counted } from './day';

/** What notes look like. Signing in for the first time flies the ready screen's note into this place. */
export function Example() {
  const me = useQuery(q.session()).data?.user;
  return (
    <section className="hm-example" aria-label="What notes look like">
      <Link to="/notes/$noteId" params={{ noteId: 'example' }} className="hm-example-link" data-tour="notes-example" aria-label="Open the example note">
        <NoteCard you={me} example />
      </Link>
      <p className="hm-ex-cap"><Icon name="notes" size={15} />Notes from your calls will look like this.</p>
    </section>
  );
}

/** "five colleagues", "one colleague" */
const colleagues = (n: number) => counted(n, 'colleague');

/** Where people sign in: the link to send anyone you'd like on Alcove. */
const inviteLink = () => `${location.origin}/welcome`;

function useCopyInvite() {
  const toast = useToast();
  return () => {
    void navigator.clipboard?.writeText(inviteLink()).catch(() => undefined);
    toast(<>Invite link copied <span className="ac-mono opacity-60">{inviteLink().replace(/^https?:\/\//, '')}</span></>, { icon: 'link' });
  };
}

/** Your team on your first day, or, with a personal address, the people you'll bring. */
export function TeamCard() {
  const team = useQuery(q.team()).data;
  const session = useQuery(q.session()).data;
  const copy = useCopyInvite();
  if (team === undefined || !session) return null;
  if (team === null) {
    const provider = session.provider === 'microsoft' ? 'Microsoft' : 'Google';
    return (
      <Card title="Your team" className="hm-team">
        <EmptyState title="Just you, for now" className="hm-empty"
          art={<span className="hm-ghosts is-center"><Avatar person={session.user} size={44} /><GhostArch /><GhostArch /></span>}
          action={<Button size="sm" icon="link" onClick={copy}>Copy invite link</Button>}>
          You signed in with a personal {provider} account, so there’s no company directory. Send people the link to invite them.
        </EmptyState>
      </Card>
    );
  }
  return <Colleagues team={team} />;
}

function Colleagues({ team }: { team: Team }) {
  const session = useQuery(q.session()).data;
  const invite = useInviteTeam();
  const toast = useToast();
  const copy = useCopyInvite();
  const here = team.members.filter((m) => m.onAlcove);
  const invited = team.members.filter((m) => !m.onAlcove && m.invited);
  const asked = team.members.filter((m) => !m.onAlcove && !m.invited);
  // You, then the people here already, then empty arches for the rest, five at most.
  const others = [...here, ...invited, ...asked];
  const shown = others.length === 4 ? others : others.slice(0, 3);
  const more = others.length - shown.length;

  const send = () => invite.mutate(asked.map((m) => m.person.email), {
    onSuccess: () => toast(`Invited ${colleagues(asked.length)}. Send them the link to sign in.`, { icon: 'mail', ms: 5200, action: { label: 'Copy link', onClick: copy } }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });

  const said = !team.members.length
    ? `You’re the first from ${team.name}. People at ${team.domain} you have calls or meetings with show up here.`
    : here.length
      ? `${someNames(here.map((m) => m.person), 2)} already ${here.length === 1 ? 'uses' : 'use'} Alcove.${asked.length ? ' Invite the rest, and you can share notes in one go.' : ''}`
      : asked.length
        ? `You’re the first from ${team.name}. Invite the people you meet with most, and you can share notes in one go.`
        : `You’re the first from ${team.name}, and you’ve invited ${colleagues(invited.length)}.`;

  return (
    <Card title="Your team" className="hm-team" aside={<span className="ac-clamp-1">{team.domain}</span>}>
      <div className="hm-ghosts" aria-hidden="true">
        {session && <Avatar person={session.user} size={44} />}
        {shown.map((m) => (m.onAlcove ? <Avatar key={m.person.email} person={m.person} size={44} /> : <GhostArch key={m.person.email} initial={m.person.name || m.person.email} />))}
        {more > 0 && <GhostArch more={more} />}
        {!team.members.length && <><GhostArch /><GhostArch /></>}
      </div>
      <p className="hm-team-said">{said}</p>
      <div className="hm-team-acts">
        {asked.length
          ? <Button size="sm" icon="addUser" loading={invite.isPending} onClick={send}>Invite people</Button>
          : <Button size="sm" icon="link" onClick={copy}>Copy invite link</Button>}
      </div>
    </Card>
  );
}
