/*
 * The phone's frame, at 860px and narrower, in place of the side panel: a top bar with the brand, search,
 * New call and you (Settings); and the tab bar along the bottom, with Record raised in it.
 */
import { Avatar, Icon, IconButton, Logo, Tooltip, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { q } from '~/lib/queries';
import { Offline } from './Sidebar';
import { TABS } from './places';

/** The top of the page on a phone. It scrolls away with the page. */
export function PhoneTop({ onSearch, onNew }: { onSearch: () => void; onNew: () => void }) {
  const me = useQuery(q.session()).data?.user;
  return (
    <header className="ph-head">
      <div className="ph-top">
        <Link to="/home" className="ph-home" aria-label="Alcove, Home"><Logo size={22} /></Link>
        <span className="ph-end">
          <Tooltip label="Search or ask" side="bottom">
            <IconButton icon="search" size={20} label="Search or ask" title={undefined} aria-haspopup="dialog" onClick={onSearch} />
          </Tooltip>
          <Tooltip label="New call" side="bottom">
            <IconButton icon="plus" size={20} label="New call" title={undefined} aria-haspopup="dialog" onClick={onNew} data-tour="new-call" />
          </Tooltip>
          {me && <Link to="/settings" className="ph-me" aria-label={`${me.name}, settings`}><Avatar person={me} size={34} /></Link>}
        </span>
      </div>
      <Offline className="ph-offline" />
    </header>
  );
}

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} className={cn('tab', t.raised && 'is-raised')} data-tour={t.tour}>
          {/* Record's light is the recorder's own: night, so the rec colour is the night one in either theme. */}
          {t.raised ? <span className="tab-rec" aria-hidden="true"><i className="dark" /></span> : <Icon name={t.icon} size={22} />}
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
