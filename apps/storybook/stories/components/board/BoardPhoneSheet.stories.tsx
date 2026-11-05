/*
 * The board on a phone: for looking round and adding a sticky. BoardPhoneAdd is its one tool, in the corner; BoardPhoneSheet
 * rises from the bottom with one sticky to write, its colour, and a button that says where it's going, which waits for words.
 * Here in the Support room, on a phone. Type, pick a colour, and add it.
 */
import { BoardPhoneAdd, BoardPhoneSheet, BoardPill, BoardPointer, useTheme } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, SupportRoom } from './parts';

const PHONE = { viewport: { value: 'phone', isRotated: false } };
const CAM = { x: 27, y: 110, z: 0.8 };

/**
 * The Support room's board filling the phone, with the room's time and Lena looking round it. `over` goes on the board;
 * `rising` over the whole phone, in the person's theme as the board is: the stage makes everything else night.
 */
function OnThePhone({ over, rising }: { over?: ReactNode; rising?: ReactNode }) {
  const { resolved } = useTheme();
  return (
    <div className="sbb-phone">
      <KitSheet phone width="100%" height="100%" cam={CAM} pointers={<BoardPointer x={56} y={318} person={FOLK.lena.person} name="Lena" colour={FOLK.lena.colour} />}
        over={<><BoardPill icon="door" title="Support" time="6:40" />{over}</>}>
        <SupportRoom hide={[5]} />
      </KitSheet>
      {rising && <div className={resolved}>{rising}</div>}
    </div>
  );
}

const meta = {
  title: 'Components/Board/BoardPhoneSheet',
  component: BoardPhoneSheet,
  subcomponents: { BoardPhoneAdd },
  ...onStage,
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
export const LookingRound: Story = { name: 'Looking round', render: () => <OnThePhone over={<BoardPhoneAdd onAdd={did('onAdd')} />} /> };
/** + pressed: one sticky to write, in its colour, going to Support. */
export const AddingASticky: Story = { name: 'Adding a sticky' };
/** Nothing written yet: the button waits. */
export const NothingWritten: Story = { name: 'Nothing written', args: { text: '' } };
