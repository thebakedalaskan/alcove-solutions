/*
 * Type: the three faces and what each is for (docs/design/principles.md), then every shared type style the stylesheet
 * defines, found in packages/ui/src/styles.css as Storybook loads it, each with what the browser makes of it.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';
import '../../src/foundations.css';
import { TOKENS, TYPE_STYLES } from '../../src/tokens';

const FACES = [
  { name: 'Newsreader', token: 'font-display', for: 'A page’s title and its hero: the date on Home, Start a call, Notes, a company name on Team.' },
  { name: 'Hanken Grotesk', token: 'font-sans', for: 'Everything else you read and operate: rows, buttons, labels, times and numbers. Digits line up with tabular-nums.' },
  { name: 'IBM Plex Mono', token: 'font-mono', for: 'Code and hashes only.' }
] as const;

/** What each style is shown saying: words from the pages that use it. */
const SAMPLES: Record<string, string> = {
  'ac-display-xl': 'Start a call',
  'ac-display-l': 'Vandelay Industries',
  'ac-display-m': 'Notes from the room',
  'ac-display-s': 'Team standup',
  'ac-title': 'Coming up',
  'ac-body-l': 'The new onboarding ships behind a flag on 12 November, and support gets the help article first.',
  'ac-body': 'Orders placed before the move ship from the old warehouse.',
  'ac-body-s': 'Suggested for Friday, from Art’s call',
  'ac-label': 'Confirm',
  'ac-caption': 'Today at 09:00, 20 min',
  'ac-data': '17:30 · 1 h 12 min · 6:12'
};
const ANY_SAMPLE = 'Orders placed before the move ship from the old warehouse.';

/** A type style, and its size, line height, weight and face as the browser has them. */
function Style({ name }: { name: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [made, setMade] = useState('');
  const [boxed, setBoxed] = useState(false);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const s = getComputedStyle(ref.current);
    const face = s.fontFamily.split(',')[0]?.replace(/["']/g, '') ?? '';
    setMade(`${s.fontSize} / ${s.lineHeight} · ${s.fontWeight} · ${face}${s.fontVariantNumeric.includes('tabular') ? ' · tabular' : ''}`);
    // A type style draws no box: if this one has a background, another rule with the same class name is drawing it.
    setBoxed(s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent');
  }, []);
  return (
    <>
      <div>
        <span className="sbf-name">.{name}</span><code>{made}</code>
        {boxed && <span className="ac-body-s" style={{ color: 'var(--caution)' }}>A component’s class has the same name and draws its box here too.</span>}
      </div>
      <p ref={ref} className={`${name} sbf-sample`}>{SAMPLES[name] ?? ANY_SAMPLE}</p>
    </>
  );
}

function Type() {
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">Type</h1>
        <p>One display face for a page’s title and its hero, one face for everything else, and a mono for code. Labels and eyebrows are sentence case, never uppercase.</p>
      </header>
      <section className="sbf-part" aria-label="Faces">
        <h2>Faces</h2>
        <div className="sbf-faces">
          {FACES.map((f) => (
            <div key={f.name} className="sbf-face">
              <b style={{ fontFamily: `var(--${f.token})` }}>{f.name}</b>
              <p>{f.for}</p>
              <code>--{f.token}: {TOKENS.find((t) => t.name === f.token)?.value}</code>
            </div>
          ))}
        </div>
      </section>
      <section className="sbf-part" aria-label="Type styles">
        <h2>Type styles</h2>
        <p>The shared classes in styles.css. One ac-display-xl per page at most; page stylesheets set their own sizes from the same steps. A number that changes while you look takes Hanken Grotesk with tabular-nums, so its digits don’t jump.</p>
        <div className="sbf-styles">{TYPE_STYLES.map((name) => <Style key={name} name={name} />)}</div>
      </section>
    </div>
  );
}

const meta = { title: 'Foundations/Type', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

export const FacesAndStyles: StoryObj = { name: 'Faces and styles', render: () => <Type /> };
