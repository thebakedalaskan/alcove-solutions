import { CheckoutNote } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from './parts';

/** A calm sentence in a step: caution for something to look at, info for what happens next. */
const meta = {
  title: 'Components/Checkout/CheckoutNote', component: CheckoutNote, parameters: { layout: 'centered' },
  args: { tone: 'caution', children: 'Only send USDC on Base. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.' },
  argTypes: { tone: { control: 'inline-radio', options: ['caution', 'info'] }, children: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof CheckoutNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnlyThisToken: Story = {};
export const OnlyThisTokenNight: Story = { globals: { theme: 'dark' } };
export const WhatArrivedStays: Story = { args: { tone: 'info', children: 'If you don’t, the 128 USDC that arrived stays in your balance.' } };
export const PriceChanged: Story = { args: { children: 'The price of Pro has changed. Look at it again before buying.' } };
