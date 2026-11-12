/*
 * The evening behind every page (Horizon, from @alcove/ui): each moment of it on a tile, as the design canvas's Evening
 * board has them, and everything that passes through, each on its own tile over and over, as its Life board does. On a
 * page they come at random, one at a time, every 22 to 60 seconds; which moments each comes to is read from Horizon itself.
 */
import { Horizon, VISITORS, type Moment, type Visitor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import '../../src/foundations.css';

/** Each moment as the Evening board shows it: where its horizon sits on a 300px tile, and what it's like. */
const MOMENTS = {
  home: { name: 'Home', hz: 215, line: 'The sunset, the sun half risen under Start a call. All sky: this page is one action.' },
  record: { name: 'Record', hz: 235, line: 'Night, in both themes. The recorder is the sun: a dark disc with the last of the light on its rim.' },
  team: { name: 'Team', hz: 165, line: 'The sun low and to the left, behind the people standing on the horizon.' },
  agents: { name: 'Agents', hz: 168, line: 'Team’s moment the other way round: the sun low on the right, just past the end of the line of agents.' },
  calls: { name: 'Calls', hz: 115, line: 'Just after sunset: only the glow is left, with search in the middle. Stars come out after dark.' },
  drive: { name: 'Drive', hz: 100, line: 'A little later than Calls: less glow on the water and the first stars, over every workspace and call’s home.' },
  note: { name: 'A note', hz: 85, line: 'A slim band. The horizon is the call itself.' },
  settings: { name: 'Settings', hz: 60, line: 'The last of the light. Mostly page.' },
  after: { name: 'After a call', hz: 245, line: 'Night, in both themes: no sun, the glow it left on the horizon and its light on the bay, stars and a crescent moon.' }
} satisfies Record<Moment, { name: string; hz: number; line: string }>;
const MOMENT_ORDER = Object.keys(MOMENTS).filter((m): m is Moment => m in MOMENTS);

/** What each visitor is, as the Life board says, and how much faster than on a page it's shown (the ships take minutes). */
const ABOUT = {
  gulls: { name: 'Gulls', line: 'One, three or five. A few wing beats, then a glide.' },
  fish: { name: 'A fish', line: 'Leaps, with a ring on the water at each end.' },
  dolphins: { name: 'Dolphins', line: 'Two, one after the other, far out.' },
  school: { name: 'A shoal', line: 'Five small fish, one after another.' },
  flyer: { name: 'A flying fish', line: 'A long, low glide over the water.' },
  marlin: { name: 'A marlin', line: 'The big one. A high leap.' },
  whale: { name: 'A whale’s tail', line: 'Up out of the water, a moment there, and down again.' },
  star: { name: 'A shooting star', line: 'Only after dark, now and then. Record is night in both themes, so it’s shown on Record’s sky.' },
  sail: { name: 'A sailing boat', line: 'Along the horizon, in front of the sun when it gets there.', pace: 5 },
  steamer: { name: 'A small ship', line: 'With a trail of smoke.', pace: 5 },
  trawler: { name: 'A fishing boat', line: 'Out with its gear up.', pace: 5 },
  tall: { name: 'A tall ship', line: 'Three masts, the slowest of them.', pace: 5 },
  freighter: { name: 'A freighter', line: 'Long and low, stacked with boxes.', pace: 5 },
  tug: { name: 'A tug', line: 'Small and quicker than the rest.', pace: 5 },
  balloon: { name: 'A hot air balloon', line: 'In from the edge, up in a curve, and out again, in the corner. About 40 seconds.' }
} satisfies Record<Visitor, { name: string; line: string; pace?: number }>;

/** The pages a visitor comes to, in a sentence. */
function comesTo(moments: readonly Moment[]): string {
  const names = moments.map((m, i) => (i === 0 ? MOMENTS[m].name : MOMENTS[m].name.replace(/^A(fter)? /, (w) => w.toLowerCase())));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : names[0] ?? '';
  return `${list}.`;
}
/** Shown over Home's sky when it comes there, otherwise over the first page it comes to that's dark enough to see it. */
const sceneFor = (moments: readonly Moment[]): Moment => (moments.includes('home') ? 'home' : moments.includes('record') ? 'record' : moments[0] ?? 'home');

function Moments() {
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">One evening</h1>
        <p>Every page in the frame is a moment of the same evening, drawn behind it by Horizon. The sky is only as tall as the page is one action. A call isn’t part of it: it’s always night, on the call stage.</p>
      </header>
      <section className="sbf-part" aria-label="The moments">
        <div className="sbf-moments">
          {MOMENT_ORDER.map((m) => (
            <figure key={m} className="sbf-tile">
              <div className="sbf-scene" style={{ '--hz': `${MOMENTS[m].hz}px` }}><Horizon moment={m} only={{ kind: null }} /></div>
              <figcaption><b>{MOMENTS[m].name}</b>{MOMENTS[m].line}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}

function PassingThrough() {
  return (
    <div className="sbf">
      <header className="sbf-head">
        <h1 className="ac-display-s">Everything that moves</h1>
        <p>Each one repeats here so you can see it. On a page they come at random, one at a time: something quick every 22 to 60 seconds, a ship every few minutes. With reduced motion nothing comes, here or on a page.</p>
      </header>
      <section className="sbf-part" aria-label="What passes through">
        <div className="sbf-life">
          <figure className="sbf-tile">
            <div className="sbf-scene sbf-fast" style={{ '--hz': '124px' }}><Horizon moment="home" only={{ kind: null }} /></div>
            <figcaption><b>Clouds</b><span>Striped like the light on the water, drifting across on the wind.</span><small>Every page, always. Shown 12 times faster.</small></figcaption>
          </figure>
          {VISITORS.map((v) => {
            const about: { name: string; line: string; pace?: number } = ABOUT[v.kind];
            return (
              <figure key={v.kind} className="sbf-tile">
                <div className="sbf-scene" style={{ '--hz': '124px' }}><Horizon moment={sceneFor(v.moments)} only={{ kind: v.kind, pace: about.pace }} /></div>
                <figcaption>
                  <b>{about.name}</b><span>{about.line}</span>
                  <small>{comesTo(v.moments)}{about.pace ? ` Shown ${about.pace} times faster.` : ''}</small>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const meta = { title: 'Foundations/The evening', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

export const EveryMoment: StoryObj = { name: 'Every moment', render: () => <Moments /> };
export const WhatPassesThrough: StoryObj = { name: 'What passes through', render: () => <PassingThrough /> };
