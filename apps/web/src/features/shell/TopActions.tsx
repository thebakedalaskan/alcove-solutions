/*
 * Search and you, at the top right of every page: your face opens your menu (YouMenu.tsx). On a phone the top bar
 * (TabBar.tsx) holds them instead.
 */
import { Icon, Kbd } from '@alcove/ui';
import { ariaShortcut, shortcut } from '~/lib/keys';
import { YourFace } from '~/features/account/YouMenu';

/** ⌘K opens it. A workspace full screen has a frame of its own, with its own Search. */
export function TopActions({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="top-acts">
      <button type="button" className="top-find" data-tour="ask" onClick={onSearch} aria-label="Search or ask" title="Search or ask" aria-haspopup="dialog" aria-keyshortcuts={ariaShortcut('K')}>
        <Icon name="search" size={16} /><span>Search or ask</span><Kbd>{shortcut('K')}</Kbd>
      </button>
      <YourFace size={32} className="top-me" />
    </div>
  );
}
