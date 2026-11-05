/*
 * Icons: every name in Icon's map (`ICON_NAMES` from @alcove/ui), drawn as the app draws them. Lucide, one stroke family at
 * 1.8; a glyph drawn filled says so. Add a name to the map rather than drawing an SVG.
 */
import { EmptyState, Field, ICON_NAMES, Icon } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import '../../src/foundations.css';

function Icons() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = ICON_NAMES.filter((name) => name.toLowerCase().includes(q));
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">Icons</h1>
        <p>Every icon the app can draw, by the name Icon takes. Lucide, one stroke family at 1.8, sized by whoever draws it. Tile and toolbar actions are icon buttons with a tooltip, not text labels.</p>
      </header>
      <section className="sbf-part" aria-label="Every icon">
        <Field className="sbf-filter" label="Find an icon" placeholder="mic, share, cal" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p>{shown.length === ICON_NAMES.length ? `${ICON_NAMES.length} icons` : `${shown.length} of ${ICON_NAMES.length} icons`}</p>
        {shown.length ? (
          <div className="sbf-icons">
            {shown.map((name) => (
              <div key={name} className="sbf-icon">
                <Icon name={name} size={22} />
                <code>{name}</code>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No icon by that name">Try part of a name, like mic, cal or share.</EmptyState>}
      </section>
    </div>
  );
}

const meta = { title: 'Foundations/Icons', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

export const AllIcons: StoryObj = { name: 'All icons', render: () => <Icons /> };
