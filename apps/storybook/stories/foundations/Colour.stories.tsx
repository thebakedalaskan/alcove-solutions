/*
 * Colour: every colour token in packages/ui/src/styles.css, read from it as Storybook loads it, the light theme's beside the
 * dark theme's, grouped by what each is for as docs/design/principles.md says. A token the guide doesn't place yet still
 * shows, at the end, so nothing in the stylesheet is missing here.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';
import '../../src/foundations.css';
import { COLOURS, THEMED, valueOf } from '../../src/tokens';

interface Role { title: string; about: string; names: readonly string[] }
/** What each colour is for. A name ending in `*` takes every token it starts. */
const ROLES: readonly Role[] = [
  { title: 'The page and what sits on it', about: 'The ground every page sits on, panels and cards on it, and what sits sunk into them.', names: ['ground', 'surface', 'surface-raised', 'sunk'] },
  { title: 'The focus ring', about: 'A 2px outline round whatever has keyboard focus.', names: ['focus'] },
  { title: 'The frame around every screen', about: 'Dark in both themes: the side panel and the edge round the page.', names: ['frame'] },
  { title: 'Hairlines', about: 'Lines between rows, and the ring round a control.', names: ['line', 'line-control'] },
  { title: 'Text', about: 'ink for what you read first, ink-2 for what follows, ink-3 for meta on surface and ground only.', names: ['ink', 'ink-2', 'ink-3'] },
  { title: 'The one thing you press', about: 'Navy by day and cream by night: a solid fill with on-sun text and no shadow, one per view.', names: ['sun', 'on-sun'] },
  { title: 'Warmth and highlights', about: 'Time, now, a highlight. Never a fill you press.', names: ['sun-text', 'sun-soft', 'sun-glow'] },
  {
    title: 'Meaning', about: 'rose: a decision waiting on someone’s answer. horizon: a follow-up, information, links, focus. rec: notes being taken or recording, nothing else. caution: a problem. Each has a soft one to sit behind it, and caution-text is caution for small text out on the scene, where caution falls short by day.',
    names: ['rose', 'rose-soft', 'horizon', 'horizon-soft', 'rec', 'rec-soft', 'caution', 'caution-soft', 'caution-text']
  },
  { title: 'The call stage, always night', about: 'The stage, its tiles and what’s raised on it, its ink, the ring round whoever speaks, and pointers on a shared screen.', names: ['stage', 'stage-tile', 'stage-raised', 'stage-ink', 'stage-ink-2', 'speak', 'stage-point'] },
  { title: 'Drawing on the evening', about: 'For what stands in the scene: the low sun, and the haze along the horizon.', names: ['dusk-sun', 'dusk-haze'] },
  { title: 'Illustration, tour art and covers only', about: 'Never behind text. The covers are moments of the one sky.', names: ['dawn-1', 'dawn-2', 'dawn-3', 'dawn-4', 'gold', 'cover-*'] },
  { title: 'A highlight or comment in a document', about: 'What’s highlighted or commented on in a workspace document.', names: ['hl'] },
  { title: 'Code in a document', about: 'A code block’s words by what each is: keywords, strings, numbers, the names of functions and types, and comments. A palette of its own, with no green.', names: ['code-*'] }
];

const takes = (pattern: string, name: string) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name);
/** Every colour token under its role, in the stylesheet's order, and the ones no role takes at the end. */
function grouped(): Role[] {
  const placed = ROLES.map((r) => ({ ...r, names: COLOURS.filter((n) => r.names.some((p) => takes(p, n))) }));
  const rest = COLOURS.filter((n) => !ROLES.some((r) => r.names.some((p) => takes(p, n))));
  return [...placed, ...(rest.length ? [{ title: 'Not in the guide yet', about: 'In the stylesheet, but docs/design/principles.md doesn’t say what it’s for.', names: rest }] : [])];
}

/** A token as one theme has it: the colour, and the value it resolves to there. */
function Swatch({ name, theme }: { name: string; theme: 'light' | 'dark' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState('');
  useLayoutEffect(() => { if (ref.current) setValue(valueOf(ref.current, name)); }, [name]);
  return (
    <div className={`sbf-sw ${theme}`}>
      <i style={{ background: `var(--${name})` }} />
      <span ref={ref}>{value}</span>
      {theme === 'dark' && !THEMED.has(name) && <em>Same in both</em>}
    </div>
  );
}

function Colour() {
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">Colour</h1>
        <p>Blue Hour: every colour token in packages/ui/src/styles.css, read from it as this page loads. The light theme is on the left and the dark theme on the right, each on its own ground, whichever theme the page is in.</p>
      </header>
      {grouped().map((role) => (
        <section key={role.title} className="sbf-part" aria-label={role.title}>
          <h2>{role.title}</h2>
          <p>{role.about}</p>
          <div className="sbf-colours">
            <span className="sbf-th">Token</span><span className="sbf-th">Light</span><span className="sbf-th">Dark</span>
            {role.names.map((name) => (
              <div key={name} style={{ display: 'contents' }}>
                <span className="sbf-name">--{name}</span>
                <Swatch name={name} theme="light" />
                <Swatch name={name} theme="dark" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta = { title: 'Foundations/Colour', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

export const Tokens: StoryObj = { render: () => <Colour /> };
