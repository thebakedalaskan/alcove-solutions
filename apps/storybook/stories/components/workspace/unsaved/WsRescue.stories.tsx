/*
 * WsRescue: what someone can do with their own words that didn't reach Alcove, and only those: Copy text, Save as new
 * document for someone who can make one, and Discard, which asks once with the keyboard on Keep it. While the words may
 * still get there by themselves, only Copy text.
 */
import { WsDiscardAsk, WsRescue, type WsPop } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { did } from '../../../../src/component';

const ask = (open: boolean): WsPop => ({ open, onOpenChange: did('discard'), content: <WsDiscardAsk onDiscard={did('discard')} onKeep={did('keep it')} /> });

const all: ComponentProps<typeof WsRescue> = { onCopy: did('copy text'), onSaveAsNew: did('save as new document'), saving: false, discard: ask(false) };

const meta = {
  title: 'Components/Workspace/Unsaved/WsRescue',
  component: WsRescue,
  args: all,
  argTypes: { onCopy: { control: false }, onSaveAsNew: { control: false }, discard: { control: false } }
} satisfies Meta<typeof WsRescue>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllThree: Story = {};
/** For someone who can't make a document here. */
export const CopyOrDiscard: Story = { args: { onSaveAsNew: undefined } };
/** On a document that's left the list, before it's sure it's gone: nothing would let go of the words yet. */
export const CopyOnly: Story = { args: { onSaveAsNew: undefined, discard: undefined } };
/** The new document is being made. */
export const Saving: Story = { args: { saving: true } };
/** Discard asks once, starting on Keep it, so Enter twice loses nothing. */
export const DiscardAsks: Story = { args: { discard: ask(true) } };
