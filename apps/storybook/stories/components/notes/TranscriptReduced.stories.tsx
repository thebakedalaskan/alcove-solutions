/*
 * TranscriptReduced: the notice over a transcript some of which was made at reduced quality, without the detail that says
 * how sure each word was. `now` while it's being made (a call's Transcript, the workspace's), `then` once it's in the
 * notes. Its lines carry no marks of their own, so it's said once, above them, in caution.
 */
import { TranscriptReduced } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Notes and transcript/TranscriptReduced',
  component: TranscriptReduced,
  parameters: { layout: 'centered' },
  args: { when: 'now' },
  argTypes: { when: { control: 'inline-radio', options: ['now', 'then'] }, className: { control: false } },
  render: (args) => <div style={{ width: 'min(560px, 100vw - 32px)' }}><TranscriptReduced {...args} /></div>
} satisfies Meta<typeof TranscriptReduced>;
export default meta;
type Story = StoryObj<typeof meta>;

/** While it's being made: in a call, or in the workspace's Transcript page. */
export const Now: Story = {};
/** Once the notes are written: above the note's Transcript tab. */
export const Then: Story = { args: { when: 'then' } };
