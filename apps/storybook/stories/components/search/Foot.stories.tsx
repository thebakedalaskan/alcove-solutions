/*
 * The palette's foot (PaletteFoot): what's private on the left, the keys on the right. "Only you can see what you search."
 * with a lock; while Ask is lit or an answer shows, that answers are written in confidential compute, from your notes only,
 * with the sealed shield in sun-text; when the chosen model is outside a secure enclave, the caution and the Unencrypted
 * badge instead. The keys say what Enter does for the lit row. A phone shows no keys.
 */
import { PaletteFoot, Unencrypted, type PaletteKeys } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

const keys = (enter: string, tab: boolean, esc = 'Close'): PaletteKeys[] => [
  { keys: ['↑', '↓'], label: 'Move' },
  { keys: ['↵'], label: enter },
  ...(tab ? [{ keys: ['Tab'], label: 'Ask' }] : []),
  { keys: ['esc'], label: esc }
];

/** The foot across the bottom of the window, on its own. */
const Pane = ({ children }: { children: ReactNode }) => <div className="sbc-pane is-line" style={{ width: 'min(1000px, 92vw)' }}>{children}</div>;

const meta = {
  title: 'Components/Search/Foot',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Searching: only you can see what you search. A moment is lit, so ↵ opens it, and Tab asks. */
export const OnlyYou: Story = {
  name: 'Only you',
  render: () => <Pane><PaletteFoot keys={keys('Open', true)}>Only you can see what you search.</PaletteFoot></Pane>
};

/** Before anything's typed: no Tab. */
export const NothingTyped: Story = {
  name: 'Nothing typed',
  render: () => <Pane><PaletteFoot keys={keys('Open', false)}>Only you can see what you search.</PaletteFoot></Pane>
};

/** Someone lit: ↵ picks them. */
export const PersonLit: Story = {
  name: 'Someone lit',
  render: () => <Pane><PaletteFoot keys={keys('Pick', true)}>Only you can see what you search.</PaletteFoot></Pane>
};

/** Ask lit: sealed, in confidential compute. ↵ asks. */
export const Sealed: Story = {
  render: () => <Pane><PaletteFoot sealed keys={keys('Ask', false)}>Answers are written in confidential compute, from your notes only.</PaletteFoot></Pane>
};

/** An answer showing: sealed, and esc goes back to the results. */
export const Answered: Story = {
  render: () => <Pane><PaletteFoot sealed keys={keys('Open', false, 'Back')}>Answers are written in confidential compute, from your notes only.</PaletteFoot></Pane>
};

/** The chosen model is outside a secure enclave: the caution, and the Unencrypted badge. */
export const OutsideAnEnclave: Story = {
  name: 'Outside an enclave',
  render: () => (
    <Pane>
      <PaletteFoot sealed outside keys={keys('Ask', false)}>Answers come from your notes only, written by an AI model outside a secure enclave. <Unencrypted compact /></PaletteFoot>
    </Pane>
  )
};

/** On a phone: no keys. */
export const OnAPhone: Story = {
  name: 'On a phone',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => <Pane><PaletteFoot keys={keys('Open', true)}>Only you can see what you search.</PaletteFoot></Pane>
};
