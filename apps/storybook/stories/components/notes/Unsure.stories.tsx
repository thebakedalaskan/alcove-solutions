/*
 * Unsure: something in a transcript it can't vouch for: words that were hard to hear (`words`), or who said them
 * (`speaker`, heard on more than one microphone). A dotted underline, never colour alone; the reason on hover or focus,
 * and in words for screen readers. Calm on purpose: it says the transcript isn't sure, not that anything is wrong.
 * UnsureKey is one quiet line under a transcript saying what its dotted marks mean, for the kinds it has.
 */
import { Unsure, UnsureKey } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

/** A spoken line, set as the transcript sets it. */
const Said = ({ children }: { children: ReactNode }) => <p style={{ maxWidth: 560, font: '400 15.5px/24px var(--font-sans)', color: 'var(--ink)' }}>{children}</p>;
/** A speaker's name over their line. */
const Name = ({ children }: { children: ReactNode }) => <p style={{ font: '600 13.5px/22px var(--font-sans)', color: 'var(--ink)' }}>{children}</p>;
const Key = ({ children }: { children: ReactNode }) => <div style={{ display: 'grid', gap: 10, maxWidth: 560 }}>{children}</div>;
const noControls = { controls: { disable: true } };

const meta = {
  title: 'Components/Notes and transcript/Unsure',
  component: Unsure,
  subcomponents: { UnsureKey },
  parameters: { layout: 'centered' },
  args: { of: 'words', children: 'the last coffee changes' },
  argTypes: { of: { control: 'inline-radio', options: ['words', 'speaker'] }, children: { control: 'text' }, className: { control: false } },
  render: (args) => <Said>The new onboarding is done. Design signed off last night and <Unsure {...args} /> went in first thing.</Said>
} satisfies Meta<typeof Unsure>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Words that were hard to hear: they may not be exactly what was said. Point at them, or tab to them, for why. */
export const Words: Story = {};
/** A name heard on more than one microphone: someone else may have said it. */
export const Speaker: Story = {
  args: { of: 'speaker', children: 'Kofi' },
  render: (args) => <div><Name><Unsure {...args} /></Name><Said>Rollout’s fine. We start with one per cent and go from there.</Said></div>
};
/** The key, for a transcript with words that were hard to hear. */
export const KeyForWords: Story = { name: 'Key for words', parameters: noControls, render: () => <Key><UnsureKey words speaker={false} /></Key> };
/** The key, for a transcript with a speaker it isn't sure of. */
export const KeyForASpeaker: Story = { name: 'Key for a speaker', parameters: noControls, render: () => <Key><UnsureKey words={false} speaker /></Key> };
/** The key, for both kinds. */
export const KeyForBoth: Story = { name: 'Key for both', parameters: noControls, render: () => <Key><UnsureKey words speaker /></Key> };
/** Nothing unsure, so no key: under this line, there's nothing to explain. */
export const NothingUnsure: Story = {
  name: 'Nothing unsure',
  parameters: noControls,
  render: () => <Key><Said>Good. Thanks, all. Same time next week.</Said><UnsureKey words={false} speaker={false} /></Key>
};
