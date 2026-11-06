/*
 * Search and you, at the top right of every page. On a phone the top bar (TabBar.tsx) holds them instead.
 */
import { Avatar, Icon, Kbd } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ariaShortcut, shortcut } from '~/lib/keys';
import { q } from '~/lib/queries';

/** `keyed`: ⌘K opens this here. A workspace's page keeps ⌘K for its own Find, as Notes does for its line. */
export function TopActions({ onSearch, keyed = true }: { onSearch: () => void; keyed?: boolean | undefined }) {
  const me = useQuery(q.session()).data?.user;
  return (
    <div className="top-acts">
      <button type="button" className="top-find" onClick={onSearch} aria-label="Search or ask" title="Search or ask" aria-haspopup="dialog" aria-keyshortcuts={keyed ? ariaShortcut('K') : undefined}>
        <Icon name="search" size={16} /><span>Search or ask</span>{keyed && <Kbd>{shortcut('K')}</Kbd>}
      </button>
      {me && <Link to="/settings" className="top-me" aria-label={`${me.name}, settings`}><Avatar person={me} size={32} /></Link>}
    </div>
  );
}
