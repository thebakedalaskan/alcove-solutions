/*
 * SealedButton: the sealed badge as a button, for when it opens what was checked. Under a note's title it says where the
 * note was written and when the hardware was checked, and it anchors a Popover with the evidence: a Checklist for each
 * model. The same look as the badge, with a chevron that turns over while it's open.
 */
import { Checklist, Popover, SealedButton, type Checked } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

const QUOTE = '6de41d05b9e14dae29bc26d67926d9f34c4b833cc98184197f230bb9861a9a69';
const COMPOSE = '43256d69ef8468a317b23eac2a6f0a06ad290d5eb5a04331a7202296095728f5';
const KEY = '3bfa85b8fde5e77d16c0d74fbbf89a316209ba7058a67ff3000249bc39442965';
/** The start and end of a hash, as a note's evidence shows it. */
const short = (hex: string) => `${hex.slice(0, 4)}…${hex.slice(-4)}`;

/** What was checked about the model that wrote a call's notes, before anything was sent to it. */
const CHECKED: Checked[] = [
  { label: 'Intel TDX confidential VM', detail: 'Signed by Intel, firmware up to date', value: short(QUOTE), title: `TDX quote, SHA-256 ${QUOTE}` },
  { label: 'Booted dstack-nvidia-0.5.12', detail: 'Measured as the published dstack image builds' },
  { label: 'The configuration it started with', detail: 'As its quote measures it', value: short(COMPOSE), title: `App compose, SHA-256 ${COMPOSE}` },
  { label: '1 NVIDIA Hopper GPU in confidential mode', detail: 'Confirmed by NVIDIA’s attestation service, for the same challenge' },
  { label: 'Its key', detail: 'Bound in the quote to a fresh challenge from Alcove', value: short(KEY), title: `Ed25519 key ${KEY}` },
  { label: 'Sealed to that key with Oblivious HTTP', detail: 'At the model’s own endpoint. Its reply came back sealed the same way' }
];

const meta = {
  title: 'Components/Actions/SealedButton',
  component: SealedButton,
  parameters: { layout: 'centered' },
  args: { title: 'Written in confidential compute', detail: 'hardware verified 16:02', onClick: did('onClick') },
  argTypes: { title: { control: 'text' }, detail: { control: 'text' } }
} satisfies Meta<typeof SealedButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

type OpenArgs = { title: ReactNode; detail?: ReactNode; open: boolean };
/** Open on what was checked, the chevron turned over. Press the badge, or anywhere else, to close it. */
export const Open: StoryObj<OpenArgs> = {
  args: { open: true },
  parameters: { layout: 'padded' },
  render: function Render({ title, detail, open }) {
    const [, update] = useArgs<OpenArgs>();
    return (
      <Popover open={open} onOpenChange={(next) => update({ open: next })} label="What Alcove checked" className="proof-pop"
        anchor={<SealedButton title={title} detail={detail} />}>
        <div className="proof-h">
          <b>Checked before anything was sent</b>
          <p>Before sending this call’s speech and transcript to a model on NEAR AI, Alcove checked its hardware evidence, then sealed everything to the key that evidence vouches for. Alcove can’t read it.</p>
        </div>
        <section className="proof-m" aria-label="The notes model">
          <div className="proof-mh">
            <span className="ac-eyebrow">Wrote the notes</span>
            <span className="proof-model">z-ai/glm-5.3-flash</span>
            <span className="proof-when">Verified Wed 4 Nov, 16:02</span>
          </div>
          <Checklist items={CHECKED} label="What was checked about z-ai/glm-5.3-flash" />
        </section>
      </Popover>
    );
  }
};
