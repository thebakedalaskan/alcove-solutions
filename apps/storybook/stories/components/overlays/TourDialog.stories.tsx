/*
 * TourDialog: the tour, one card with one idea per slide that travels to the real thing it's about. The page dims around
 * a cut-out of the target, a ring marks it and an arrow runs from the card to it. The card takes the first side it fits
 * on and follows the target when the window changes; below 640px wide it's a sheet along the bottom. Arrow keys and Enter
 * move through it, Escape closes it, focus stays in the card, and Skip tour is on every slide but the last. Here it points
 * at a small page standing in for Home. The tour's own art lives in the app, so these slides draw theirs from the kit.
 */
import { ArchThumb, Button, Faces, NavItemContent, SidebarNav, TourDialog, coverFor, type TourSlide } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { did } from '../../../src/component';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

/** The element with this `data-tour` hook, looked up whenever the tour lays itself out, as the app finds Home's. */
const hook = (name: string) => (): HTMLElement | null => {
  const el = document.querySelector(`[data-tour="${name}"]`);
  return el instanceof HTMLElement ? el : null;
};

/** A slide's art: kit pieces on the card's dawn sky, drawn at night whatever the page's theme. */
const Art = ({ children }: { children: ReactNode }) => <div className="ta dark">{children}</div>;

const SLIDES: TourSlide[] = [
  {
    id: 'start', title: 'Start or schedule a call', next: 'Show me notes', target: hook('start'), prefer: ['right', 'below'],
    text: 'Start now goes straight to the call. Schedule suggests times that suit everyone and sends the invites.',
    art: <Art><Faces people={[PRIYA, KOFI, AIKO]} size={56} /></Art>
  },
  {
    id: 'notes', title: 'Notes for your calls', next: 'Show me recording', target: hook('calls'), prefer: ['right', 'below', 'above'],
    text: 'Every call’s notes are in Calls: a summary, decisions and follow-ups, written in confidential compute.',
    art: <Art><span className="flex items-end gap-3"><ArchThumb cover="dawn" width={44} /><ArchThumb cover="morning" width={58} /><ArchThumb cover="dusk" width={44} /></span></Art>
  },
  {
    id: 'room', title: 'Record in the room', next: 'Start using Alcove', target: hook('record'), prefer: ['right', 'below'],
    text: 'Meeting in person? Record on your phone, even offline. Notes are written when you’re back online.',
    art: <Art><ArchThumb cover="night" room width={64} /></Art>
  }
];

/** A few of the demo world's notes. */
const NOTES = [
  { id: 'n2', title: 'Team standup', when: 'Today · 20 min' },
  { id: 'n4', title: 'Design review', when: 'Yesterday · 45 min' },
  { id: 'n3', title: 'Pricing sync', when: 'Yesterday · 32 min' }
];

const stay = (e: { preventDefault: () => void }) => e.preventDefault();

/** A page standing in for Home, with the app's hooks: Calls and Record in the side panel, and Start now with Schedule. */
function Page({ onTour }: { onTour: () => void }) {
  return (
    <div className="grid min-h-screen grid-cols-1 content-start gap-6 p-5 sm:grid-cols-[210px_minmax(0,1fr)] sm:gap-10 sm:p-8">
      <SidebarNav className="content-start self-start">
        <a href="#home" className="ac-nav-item" aria-current="page" onClick={stay}><NavItemContent icon="home" label="Home" /></a>
        <a href="#calls" className="ac-nav-item" data-tour="calls" onClick={stay}><NavItemContent icon="calls" label="Calls" /></a>
        <a href="#team" className="ac-nav-item" onClick={stay}><NavItemContent icon="people" label="Team" /></a>
        <a href="#record" className="ac-nav-item" data-tour="record" onClick={stay}><NavItemContent icon="room" label="Record" /></a>
      </SidebarNav>
      <main className="grid min-w-0 content-start justify-items-start gap-6">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <h1 className="ac-display-m">Home</h1>
          <Button variant="quiet" icon="compass" onClick={onTour}>Take the tour again</Button>
        </div>
        <div className="flex flex-wrap gap-2" data-tour="start">
          <Button variant="primary" icon="video">Start now</Button>
          <Button variant="secondary" icon="cal">Schedule</Button>
        </div>
        <section className="ac-card w-full max-w-[520px]" aria-label="Notes">
          <div className="ac-card-head"><h3>Notes</h3></div>
          {NOTES.map((n) => (
            <div key={n.id} className="flex items-center gap-3 py-2">
              <ArchThumb cover={coverFor(n.id)} width={28} />
              <span className="grid min-w-0"><b className="ac-clamp-1 text-[14.5px] font-semibold">{n.title}</b><small className="text-[12.5px] text-ink-3">{n.when}</small></span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

/** The tour over the page as it opens; when it closes, Take the tour again brings it back. */
function Tour({ slides, onClose }: { slides: TourSlide[]; onClose: (finished: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Page onTour={() => setOpen(true)} />
      {open && <TourDialog slides={slides} onClose={(finished) => { onClose(finished); setOpen(false); }} />}
    </>
  );
}

const meta = {
  title: 'Components/Overlays/TourDialog',
  component: TourDialog,
  parameters: { layout: 'fullscreen' },
  args: { slides: SLIDES, onClose: did('onClose') },
  argTypes: { slides: { control: false } },
  render: (args) => <Tour {...args} />
} satisfies Meta<typeof TourDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three slides over the page, opening on the first. Skip tour or Escape closes it; Take the tour again opens it again. */
export const ThreeSlides: Story = { name: 'Three slides' };
/** On a phone it's a sheet along the bottom, and the page scrolls to keep each target in sight above it. */
export const OnAPhone: Story = { name: 'On a phone', globals: { viewport: { value: 'phone' } } };
