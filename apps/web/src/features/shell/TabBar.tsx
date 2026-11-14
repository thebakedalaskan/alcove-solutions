/*
 * The phone's frame, at 860px and narrower, in place of the side panel: a top bar with the brand, search, Start a call
 * and you (your menu, which rises as a sheet: YouMenu.tsx); and the tab bar along the bottom, with Record raised in it. On
 * Calls the plus is Schedule a call, the page's own action, and its search is the page's; while the scheduler is open, it
 * has its own. Team has a small rose dot while an invitation to you waits there, and says how many.
 */
import { Icon, IconButton, Logo, Tooltip, cn } from '@alcove/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { plural } from '~/lib/words';
import { Offline } from './Sidebar';
import { TABS, places, useCounts, usePlacesKnown } from './places';
import { YourFace } from '~/features/account/YouMenu';

/** The top of the page on a phone. It scrolls away with the page. */
export function PhoneTop({ onSearch, onNew }: { onSearch: () => void; onNew: () => void }) {
  const schedule = useOpenScheduling();
  const calls = useRouterState({ select: (s) => s.location.pathname === '/calls' });
  const scheduling = useRouterState({ select: (s) => s.location.pathname === '/calls' && 'schedule' in s.location.search });
  return (
    <header className="ph-head">
      <div className="ph-top">
        <Link to="/home" className="ph-home" aria-label="Alcove, Home"><Logo size={22} /></Link>
        <span className="ph-end">
          <Tooltip label="Search or ask" side="bottom">
            <IconButton icon="search" size={20} label="Search or ask" title={undefined} aria-haspopup="dialog" onClick={onSearch} data-tour="ask" />
          </Tooltip>
          {scheduling ? null : calls ? (
            <Tooltip label="Schedule a call" side="bottom">
              <IconButton icon="plus" size={20} label="Schedule a call" title={undefined} onClick={() => schedule({ schedule: 'new' })} />
            </Tooltip>
          ) : (
            <Tooltip label="Start a call" side="bottom">
              <IconButton icon="plus" size={20} label="Start a call" title={undefined} aria-haspopup="dialog" onClick={onNew} />
            </Tooltip>
          )}
          <YourFace size={34} />
        </span>
      </div>
      <Offline className="ph-offline" />
    </header>
  );
}

export function TabBar() {
  const known = usePlacesKnown();
  /* Invitations to you waiting on Team: the one count the tab bar shows, as a dot, since nothing else there waits on you as they do. */
  const invited = useCounts().team?.n ?? 0;
  return (
    <nav className="tabbar" aria-label="Main">
      {places(TABS, known).map((t) => {
        const dot = t.to === '/team' && invited > 0;
        return (
          <Link key={t.to} to={t.to} className={cn('tab', t.raised && 'is-raised')} data-tour={t.tour} aria-label={dot ? `${t.label}, ${plural(invited, 'invitation')}` : undefined}>
            {/* Record's light is the recorder's own: night, so the rec colour is the night one in either theme. */}
            {t.raised ? <span className="tab-rec" aria-hidden="true"><i className="dark" /></span> : (
              <span className="tab-icon"><Icon name={t.icon} size={22} />{dot && <i className="tab-dot" aria-hidden="true" />}</span>
            )}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
