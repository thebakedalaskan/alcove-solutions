import { Avatar, Icon, Kbd, Logo, Meter, NavItemContent, SidebarNav, buttonClass, cn } from '@alcove/ui';
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
      <button type="button" className={cn(buttonClass({ variant: 'primary' }), 'new')} onClick={onNew} aria-label="New call"><Icon name="plus" size={18} /><span>New call</span><Kbd>N</Kbd></button>
      <SidebarNav>
        <Link to="/home" className="ac-nav-item"><NavItemContent icon="home" label="Home" /></Link>
        <Link to="/notes" className="ac-nav-item"><NavItemContent icon="notes" label="Notes" count={notes?.length} /></Link>
      </SidebarNav>
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
