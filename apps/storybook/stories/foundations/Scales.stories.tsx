/*
 * Scales: spacing, radii, shadows, durations and easing, every step read from packages/ui/src/styles.css as Storybook loads
 * it, each drawn as what it does. Durations and easing play when asked; with reduced motion every change is instant, as
 * it is in the app.
 */
import { Button } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';
import '../../src/foundations.css';
import { tokensNamed, valueOf } from '../../src/tokens';

/** A token's value as it is here, in the page's theme. */
function Value({ name }: { name: string }) {
  const ref = useRef<HTMLElement>(null);
  const [value, setValue] = useState('');
  useLayoutEffect(() => { if (ref.current) setValue(valueOf(ref.current, name)); }, [name]);
  return <code ref={ref}>{value}</code>;
}
const Name = ({ name }: { name: string }) => <div><span className="sbf-name">--{name}</span><br /><Value name={name} /></div>;

/** A dot that crosses its track when the part is played: how long it takes, or how it gets there. */
function Moving({ title, about, names, motion }: { title: string; about: string; names: string[]; motion: (name: string) => { duration: string; easing: string } }) {
  const [played, setPlayed] = useState(false);
  return (
    <section className="sbf-part" aria-label={title}>
      <h2>{title}</h2>
      <p>{about}</p>
      <Button className="sbf-play" size="sm" icon={played ? 'reset' : 'play'} onClick={() => setPlayed(!played)}>{played ? 'Back' : 'Play'}</Button>
      <div className={`sbf-scale${played ? ' sbf-played' : ''}`}>
        {names.map((name) => {
          const m = motion(name);
          return (
            <div key={name} style={{ display: 'contents' }}>
              <Name name={name} />
              <div className="sbf-track"><i className="sbf-dot" style={{ transitionDuration: m.duration, transitionTimingFunction: m.easing }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Scales() {
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">Scales</h1>
        <p>Everything comes from the tokens in styles.css. Don’t invent values.</p>
      </header>
      <section className="sbf-part" aria-label="Spacing">
        <h2>Spacing</h2>
        <div className="sbf-scale">
          {tokensNamed('space-').map((name) => (
            <div key={name} style={{ display: 'contents' }}>
              <Name name={name} />
              <i className="sbf-bar" style={{ width: `var(--${name})` }} />
            </div>
          ))}
        </div>
      </section>
      <section className="sbf-part" aria-label="Radii">
        <h2>Radii</h2>
        <p>Pills and arches take the largest, so a pill stays a pill and an arch stays round at the top whatever its size.</p>
        <div className="sbf-radii">
          {tokensNamed('radius-').map((name) => (
            <div key={name} className="sbf-radius">
              <i style={{ borderRadius: name === 'radius-arch' ? `var(--${name}) var(--${name}) 0 0` : `var(--${name})` }} />
              <Name name={name} />
            </div>
          ))}
        </div>
      </section>
      <section className="sbf-part" aria-label="Shadows">
        <h2>Shadows</h2>
        <p>A hairline lift, a card, a window. Filled buttons have none.</p>
        <div className="sbf-shadows">
          {tokensNamed('shadow-').map((name) => (
            <div key={name} className="sbf-shadow">
              <i style={{ boxShadow: `var(--${name})` }} />
              <Name name={name} />
            </div>
          ))}
        </div>
      </section>
      <Moving
        title="Durations"
        about="From a quick press to the scene’s slow breaths. Each dot crosses in its own time, easing in and out."
        names={tokensNamed('duration-')}
        motion={(name) => ({ duration: `var(--${name})`, easing: 'var(--ease-in-out)' })}
      />
      <Moving
        title="Easing"
        about="ease-out for things arriving, ease-in-out for things moving, ease-in for things leaving. Each dot takes duration-4."
        names={tokensNamed('ease-')}
        motion={(name) => ({ duration: 'var(--duration-4)', easing: `var(--${name})` })}
      />
    </div>
  );
}

const meta = { title: 'Foundations/Scales', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

export const AllScales: StoryObj = { name: 'All scales', render: () => <Scales /> };
