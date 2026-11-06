/*
 * BoardEdit: where typing goes, over the thing being typed in and in its type, so nothing moves as typing starts. In a
 * sticky it takes the whole sticky; in a frame it takes the title's place, on one line; over text or a shape it keeps the
 * words where they sit at rest (`fitBoardEdit`). Its label says what's being edited, as in "Edit this sticky". Type in it.
 */
import { shapePath } from '@alcove/board';
import { BoardEdit, BoardFrame, BoardSelectionBox, BoardShape, BoardSticky, BoardText, fitBoardEdit, type BoardBox, type BoardCamera } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';
import { KitSheet, pickedAt } from './parts';

/** The field, focused with the caret at the end, as the surface opens one. `fit` keeps it over text or a shape's words. */
function Typing({ label, value, fit = false, onChange }: { label: string; value: string; fit?: boolean | undefined; onChange: (text: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return undefined;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    return fit ? fitBoardEdit(el) : undefined;
  }, [fit]);
  return <BoardEdit ref={field} label={label} rows={1} value={value} onChange={(e) => onChange(e.target.value)} />;
}

const STICKY_CAM = { x: 60, y: 40, z: 1 }, TITLE_CAM = { x: 40, y: 50, z: 0.8 }, TEXT_CAM = { x: 40, y: 50, z: 1 }, SHAPE_CAM = { x: 60, y: 60, z: 1 };
/** The ring the surface keeps round what's being typed in, with no handles while it is. */
const typingIn = (box: BoardBox, cam: BoardCamera) => <BoardSelectionBox {...pickedAt(box, cam).ring} handles={false} />;

const meta = {
  title: 'Components/Board/BoardEdit',
  component: BoardEdit,
  args: { label: 'Edit this sticky' },
  render: function Render(args) {
    const [words, setWords] = useState('Beta sign-ups beat the plan');
    return (
      <KitSheet width={300} height={240} cam={STICKY_CAM} over={typingIn({ x: 0, y: 0, w: 150, h: 150 }, STICKY_CAM)}>
        <BoardSticky id="w1" x={0} y={0} w={150} h={150} colour="butter" text={words} selected editor={<Typing label={args.label} value={words} onChange={setWords} />} />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardEdit>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a new sticky in Went well. */
export const InASticky: Story = { name: 'In a sticky' };

/** In a frame's title. */
export const InATitle: Story = {
  name: 'In a title',
  args: { label: 'Edit this title' },
  render: function Render(args) {
    const [words, setWords] = useState('Went well');
    return (
      <KitSheet width={420} height={240} cam={TITLE_CAM} over={typingIn({ x: 0, y: 0, w: 360, h: 530 }, TITLE_CAM)}>
        <BoardFrame id="well" x={0} y={0} w={360} h={530} title={words} hint="What should we keep doing?" editor={<Typing label={args.label} value={words} onChange={setWords} />} />
      </KitSheet>
    );
  }
};

/** Over text on the board. */
export const InText: Story = {
  name: 'In text',
  args: { label: 'Edit this text' },
  render: function Render(args) {
    const [words, setWords] = useState('What should change?');
    return (
      <KitSheet width={400} height={160} cam={TEXT_CAM} over={typingIn({ x: 0, y: 0, w: 290, h: 34 }, TEXT_CAM)}>
        <BoardText id="t1" x={0} y={0} w={290} h={34} text={words} selected editor={<Typing label={args.label} value={words} fit onChange={setWords} />} />
      </KitSheet>
    );
  }
};

/** Over a shape's words. */
export const InAShape: Story = {
  name: 'In a shape',
  args: { label: 'Edit this shape' },
  render: function Render(args) {
    const [words, setWords] = useState('Verify email');
    return (
      <KitSheet width={320} height={220} cam={SHAPE_CAM} over={typingIn({ x: 0, y: 0, w: 170, h: 76 }, SHAPE_CAM)}>
        <BoardShape id="s2" x={0} y={0} w={170} h={76} path={shapePath('rect', 170, 76)} text={words} selected editor={<Typing label={args.label} value={words} fit onChange={setWords} />} />
      </KitSheet>
    );
  }
};
