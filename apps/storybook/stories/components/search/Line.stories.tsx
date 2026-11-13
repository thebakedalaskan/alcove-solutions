/*
 * The palette's line (PaletteLine): on the window itself, not a pill inside it. The magnifier, someone's token when the
 * search is narrowed to what they said (PaletteToken), what you type (`<input className="pal-in">`), and esc. While Ask is
 * lit the magnifier becomes the Ask mark, in sun-text. On a phone the window takes the screen and esc becomes Cancel.
 * Pin a note has a line of its own, with the pin.
 */
import { PaletteLine, PaletteToken } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { MAYA } from '../../../src/world/people';

const FIND = 'Search everything said, or ask a question';

/** The line across the top of the window, on its own. */
const Pane = ({ children }: { children: ReactNode }) => <div className="sbc-pane is-line" style={{ width: 'min(1000px, 92vw)' }}>{children}</div>;
const Input = ({ value, placeholder = FIND }: { value?: string | undefined; placeholder?: string | undefined }) => (
  <input className="pal-in" defaultValue={value} placeholder={placeholder} aria-label="Search or ask your notes" role="combobox" aria-expanded="true" aria-autocomplete="list" autoComplete="off" spellCheck={false} />
);

const meta = {
  title: 'Components/Search/Line',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed yet. */
export const Empty: Story = {
  render: () => <Pane><PaletteLine onCancel={did('cancel')}><Input /></PaletteLine></Pane>
};

/** A word typed: the magnifier, since Ask isn't lit. */
export const Typed: Story = {
  render: () => <Pane><PaletteLine onCancel={did('cancel')}><Input value="flag" /></PaletteLine></Pane>
};

/** A question typed: Ask is lit, and the magnifier is the Ask mark, in sun-text. */
export const AskLit: Story = {
  name: 'Ask lit',
  render: () => <Pane><PaletteLine ask onCancel={did('cancel')}><Input value="When does onboarding ship?" /></PaletteLine></Pane>
};

/** Narrowed to Maya: her token, and the line says it searches what she said. The cross, or Backspace, shows everyone again. */
export const WithAToken: Story = {
  name: 'With a token',
  render: () => (
    <Pane>
      <PaletteLine token={<PaletteToken person={MAYA} name="Maya" clearLabel="Show everyone" onClear={did('clear')} />} onCancel={did('cancel')}>
        <Input placeholder="Search what Maya said" />
      </PaletteLine>
    </Pane>
  )
};

/** Narrowed to Maya, with a word to narrow it further. */
export const WithATokenAndAWord: Story = {
  name: 'With a token and a word',
  render: () => (
    <Pane>
      <PaletteLine token={<PaletteToken person={MAYA} name="Maya" clearLabel="Show everyone" onClear={did('clear')} />} onCancel={did('cancel')}>
        <Input value="flag" placeholder="Search what Maya said" />
      </PaletteLine>
    </Pane>
  )
};

/** Pin a note: the same line with the pin. */
export const PinANote: Story = {
  name: 'Pin a note',
  render: () => <Pane><PaletteLine icon="pin" onCancel={did('cancel')}><Input placeholder="Find a note to pin" /></PaletteLine></Pane>
};

/** On a phone: Cancel in place of esc. */
export const OnAPhone: Story = {
  name: 'On a phone',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => <Pane><PaletteLine onCancel={did('cancel')}><Input value="flag" /></PaletteLine></Pane>
};
