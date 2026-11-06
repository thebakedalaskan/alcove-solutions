/*
 * Checklist: what was checked, each with a tick. Evidence and receipts: information, not something to press. Each line
 * says what was checked and what it showed, with the value it showed it by at the end when there is one (a hash,
 * shortened to compare); hovering a line shows its `title`, such as the whole hash. A note's sealed badge opens one in
 * a popover, for each model that worked on the note.
 */
import { Checklist, type Checked } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, PopSurface } from '../../../src/component';

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
  title: 'Components/Forms/Checklist',
  component: Checklist,
  args: { items: CHECKED, label: 'What was checked about z-ai/glm-5.3-flash' },
  argTypes: { items: { control: 'object' } },
  render: (args) => (
    <Box width="min(420px, 100%)" height="auto">
      <PopSurface><div className="px-4 py-3.5"><Checklist {...args} /></div></PopSurface>
    </Box>
  )
} satisfies Meta<typeof Checklist>;
export default meta;
type Story = StoryObj<typeof meta>;

/** With the values each check showed: hover a hash for all of it. */
export const WithValues: Story = { name: 'With values' };
/** Only what was checked and what it showed. */
export const WithoutValues: Story = { name: 'Without values', args: { items: CHECKED.map(({ label, detail }) => ({ label, detail })) } };
