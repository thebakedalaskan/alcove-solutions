/*
 * The board on a phone: for looking round and adding a sticky. BoardPhoneAdd is its one tool, in the corner; BoardPhoneSheet
 * rises from the bottom with one sticky to write, its colour, and a button that says where it's going, which waits for words.
 * In a call it's night, as everything over the call is; on a board's own page it's in the person's theme. Here in the Support
 * room, on a phone. Type, pick a colour, and add it.
 */
import { BoardPhoneAdd, BoardPhoneSheet, BoardPill, BoardPointer } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, SupportRoom } from './parts';

const PHONE = { viewport: { value: 'phone', isRotated: false } };
const CAM = { x: 27, y: 110, z: 0.8 };

/**
 * The Support room's board filling the phone, with the room's time and Lena looking round it. `over` goes on the board; `rising`
 * over the whole phone, in whatever is round it: night on the call's stage, the person's theme on a page.
 */
function OnThePhone({ over, rising }: { over?: ReactNode; rising?: ReactNode }) {
  return (
    <div className="sbb-phone">
      <KitSheet phone width="100%" height="100%" cam={CAM} pointers={<BoardPointer x={56} y={318} person={FOLK.lena.person} name="Lena" colour={FOLK.lena.colour} />}
        over={<><BoardPill icon="door" title="Support" time="6:40" />{over}</>}>
        <SupportRoom hide={[5]} />
      </KitSheet>
      {rising}
    </div>
  );
}

const meta = {
  title: 'Components/Board/BoardPhoneSheet',
  component: BoardPhoneSheet,
  subcomponents: { BoardPhoneAdd },
  parameters: { layout: 'fullscreen' },
  globals: PHONE,
  args: { text: 'Tag plans before launch', colour: 'butter', target: 'Support', onText: did('onText'), onColour: did('onColour'), onAdd: did('onAdd') },
  argTypes: { text: { control: 'text' }, target: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <OnThePhone rising={<BoardPhoneSheet {...args} onText={(text) => { args.onText(text); update({ text }); }} onColour={(colour) => { args.onColour(colour); update({ colour }); }} />} />;
  }
} satisfies Meta<typeof BoardPhoneSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The Support room's board, with the room's time at the top, Lena looking round it, and + in the corner. */
export const LookingRound: Story = { name: 'Looking round', ...onStage, render: () => <OnThePhone over={<BoardPhoneAdd onAdd={did('onAdd')} />} /> };
/** + pressed: one sticky to write, in its colour, going to Support. */
export const AddingASticky: Story = { name: 'Adding a sticky', ...onStage };
/** Nothing written yet: the button waits. */
export const NothingWritten: Story = { name: 'Nothing written', ...onStage, args: { text: '' } };
/** On the board's own page, with no call round it: the sheet is in the person's theme, as the page is. */
export const OnItsPage: Story = { name: 'On its page' };
