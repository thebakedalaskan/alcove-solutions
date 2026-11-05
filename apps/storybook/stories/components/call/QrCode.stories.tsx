/*
 * QrCode: a link as a QR code, for a phone's camera, as Move to another device shows one. Dark modules on a light card
 * in either theme, the way every camera reads them, with the quiet zone the standard asks for. It's made in the
 * browser, so the link goes nowhere else. `label` says what it is to a screen reader; `size` is in px (196).
 */
import { QrCode } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/In a call/QrCode',
  component: QrCode,
  parameters: { layout: 'centered' },
  args: { value: 'https://alcove.app/join/dsn-revw-pka', label: 'A code for the call’s link, for a phone’s camera', size: 196 },
  argTypes: { size: { control: { type: 'range', min: 96, max: 320, step: 4 } } }
} satisfies Meta<typeof QrCode>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The design review's link. Change the value in Controls and the code follows. */
export const Default: Story = {};
/** 128, 196 (the default) and 256. */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      <QrCode {...args} size={128} />
      <QrCode {...args} size={196} />
      <QrCode {...args} size={256} />
    </Row>
  )
};
