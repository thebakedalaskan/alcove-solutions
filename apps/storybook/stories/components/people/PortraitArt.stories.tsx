/*
 * PortraitArt: one illustrated person, drawn in a 200 × 200 box centred on x = 100, for someone without a photo. It's
 * an SVG group: Avatar draws it through the viewBox "20 26 160 166" on the person's own colour (`bg`), and a call tile
 * draws the whole figure with that colour as room light on the night stage. Skin, hair and shirt colours, one of eight
 * hair styles, and glasses, a beard or earrings. Edit the portrait in Controls to try another.
 */
import { PortraitHairSchema, PortraitStyleSchema, type PortraitHair, type PortraitStyle } from '@alcove/api';
import { PortraitArt } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EVERYONE, PRIYA } from '../../../src/world/people';

/** One portrait as Avatar draws it: through the viewBox Avatar uses, on the person's own colour. */
function Drawn({ p, width }: { p: PortraitStyle; width: number }) {
  return (
    <svg viewBox="20 26 160 166" width={width} height={(width * 166) / 160} className="block rounded-[var(--radius-md)]" style={{ background: p.bg }} aria-hidden="true">
      <PortraitArt p={p} />
    </svg>
  );
}

const HAIR: Record<PortraitHair, string> = { long: 'Long hair', short: 'Short hair', bun: 'A bun', curly: 'Curly hair', bob: 'A bob', wavy: 'Wavy hair', side: 'A side parting', buzz: 'A buzz cut' };
/** What a portrait has, in words. */
const described = (p: PortraitStyle) => [HAIR[p.style], p.glasses && 'glasses', p.beard && 'a beard', p.earrings && 'earrings'].filter(Boolean).join(', ');

/** Everyone in the world drawn with a portrait, by hair style. */
const DRAWN = EVERYONE.flatMap((person) => (person.portrait ? [{ person, p: person.portrait }] : []))
  .sort((a, b) => PortraitHairSchema.options.indexOf(a.p.style) - PortraitHairSchema.options.indexOf(b.p.style));

const meta = {
  title: 'Components/People/PortraitArt',
  component: PortraitArt,
  parameters: { layout: 'centered' },
  args: { p: PortraitStyleSchema.parse(PRIYA.portrait) },
  argTypes: { p: { control: 'object' } },
  render: (args) => <Drawn p={args.p} width={220} />
} satisfies Meta<typeof PortraitArt>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya's portrait: a bun and earrings. Edit `p` in Controls to change it. */
export const Portrait: Story = {};
/** Everyone in the demo world who has a portrait, grouped by hair style: all eight styles are here. */
export const Everyone: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-4 gap-y-6">
      {DRAWN.map(({ person, p }) => (
        <figure key={person.id} className="m-0 grid content-start gap-2">
          <Drawn p={p} width={118} />
          <figcaption className="grid gap-0.5">
            <b className="ac-clamp-1 text-[13.5px] font-semibold">{person.name}</b>
            <small className="text-[12px] leading-[1.35] text-ink-3">{described(p)}</small>
          </figcaption>
        </figure>
      ))}
    </div>
  )
};
