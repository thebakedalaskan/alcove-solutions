/*
 * Reactions: the emoji under a chat message in a call. `Emoji` is one of the eight that can be used (Fluent Emoji, drawn
 * inline). `Reactions` shows each one with how many used it, yours marked; pressing one adds yours or takes it back, and
 * its tooltip says who, ending "+N" after about 40 characters. `ReactionAdd` is the button that opens the picker of eight,
 * and picking one you've already used takes it back. The call is always night, so it's shown on the stage.
 */
import { CALL_REACTIONS } from '@alcove/api';
import { Emoji, EMOJI_WORDS, ReactionAdd, ReactPicker, Reactions, type EmojiName, type ReactionShown } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did, onStage, Row } from '../../../src/component';

const YOU = 'You';

/** Who reacted with what, and the state that pressing changes: yours is "You" in the list, in the order they reacted. */
function Live({ start }: { start: Record<string, string[]> }) {
  const [by, setBy] = useState(start);
  const reactions: ReactionShown[] = Object.entries(by).flatMap(([name, names]) => {
    const emoji = CALL_REACTIONS.find((r) => r === name);
    return emoji && names.length ? [{ name: emoji, names, mine: names.includes(YOU) }] : [];
  });
  const toggle = (name: EmojiName, on: boolean) => {
    did('onToggle')(name, on);
    setBy((now) => {
      const had = now[name] ?? [];
      return { ...now, [name]: on ? [...had.filter((n) => n !== YOU), YOU] : had.filter((n) => n !== YOU) };
    });
  };
  return (
    <div className="sbc-stack">
      <Reactions reactions={reactions} onToggle={toggle} />
      {!reactions.length && <ReactionAdd mine={[]} onPick={toggle} />}
    </div>
  );
}

function Alone() {
  const [mine, setMine] = useState<EmojiName[]>([]);
  return <ReactionAdd mine={mine} onPick={(name, on) => { did('onPick')(name, on); setMine((now) => (on ? [...now, name] : now.filter((n) => n !== name))); }} />;
}

const meta = {
  title: 'Components/In a call/Reactions',
  component: Reactions,
  ...onStage,
  args: { reactions: [], onToggle: did('onToggle') },
  argTypes: { reactions: { control: false }, onToggle: { control: false }, className: { control: false } }
} satisfies Meta<typeof Reactions>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The eight emoji a message can be reacted to with. */
export const AllEight: Story = {
  name: 'All eight',
  render: () => (
    <Row>
      {CALL_REACTIONS.map((name) => (
        <span key={name} className="sbc-stack" style={{ alignItems: 'center', color: 'var(--stage-ink-2)', fontSize: 12 }}>
          <Emoji name={name} size={32} />{EMOJI_WORDS[name]}
        </span>
      ))}
    </Row>
  )
};
/** One reaction is yours (marked) and the others aren't. Press any to add yours or take it back. */
export const WithYours: Story = {
  name: 'One is yours',
  render: () => <Live start={{ 'thumbs-up': ['Priya', YOU], heart: ['Maya'], party: ['Aiko', 'Kofi', 'Maya'] }} />
};
/** Seven people on one emoji: the tooltip names as many as fit in about 40 characters, then "+N". Hover or focus it. */
export const LongList: Story = {
  name: 'Long list of names',
  render: () => <Live start={{ 'thumbs-up': ['Priya Raman', 'Kofi Mensah', 'Aiko Tanaka', 'Maya Okafor', 'Diego Alvarez', 'Sam Lindqvist', 'Ines Duarte'] }} />
};
/** The button alone, as it ends a message's reactions or stands by a message with none yet. */
export const Add: Story = {
  render: () => <Alone />
};
/** The eight emoji in their grid, as the dock's React opens it: pressing one sends it. */
export const Picker: Story = {
  render: () => <ReactPicker onPick={did('onPick')} />
};
