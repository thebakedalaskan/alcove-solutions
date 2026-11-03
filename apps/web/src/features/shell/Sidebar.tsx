import { Avatar, Icon, Kbd, Logo, Meter } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { q } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';

export function Sidebar({ onNew }: { onNew: () => void }) {
  const session = useQuery(q.session()).data;
  const notes = useQuery(q.notes()).data;
  const credits = useQuery(q.balance()).data;
  return (
    <aside className="side">
      <Logo />
      <button type="button" className="btn btn-primary new" onClick={onNew} aria-label="New call"><Icon name="plus" size={17} /><span>New call</span><Kbd>N</Kbd></button>
      <nav aria-label="Main">
        <Link to="/home" className="nav-item"><Icon name="home" /><span>Home</span></Link>
        <Link to="/notes" className="nav-item"><Icon name="notes" /><span>Notes</span>{notes?.length ? <span className="count">{notes.length}</span> : null}</Link>
      </nav>
      <div className="side-foot">
        {credits && (
          <Link to="/account" className="credits">
            <span><b>{hoursAndMinutes(credits.balance / credits.perMinute)}</b> of notes left</span>
            <Meter value={credits.balance / Math.max(1, credits.granted)} />
          </Link>
        )}
        {session && <Link to="/account" className="me-row"><Avatar person={session.user} size={28} /><span>{session.user.name}</span><Icon name="chevron" size={16} /></Link>}
      </div>
    </aside>
  );
}
