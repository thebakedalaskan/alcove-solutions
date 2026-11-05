/*
 * PickList: people to find and press, inside a popover, as Team has it. A line to type in, then rows with their arches:
 * someone not on Alcove yet stands in an empty one. Without `ticks` pressing someone is the whole thing (finding someone
 * on the Team page); with `ticks` it picks several and the popover's foot finishes (inviting people, adding to a group).
 * ↑ and ↓ move, Enter presses; a comma, a space or Tab after a whole address ticks it. Who's found is the caller's: here
 * the stories filter the company's directory the way the Team page does.
 */
import type { Person } from '@alcove/api';
import { Button, Icon, PickList, Popover, type PickRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { fold, isEmail, sameEmail, typedIn } from '~/lib/people';
import { did } from '../../../src/component';
import { ART, DIRECTORY, personAt } from '../../../src/world/people';

type Args = ComponentProps<typeof PickList>;

/** Everyone at the company, you first, as the Team page's Find someone lists them. */
const everyone: PickRow[] = [
  { key: ART.email, name: ART.name, sub: 'You', person: ART },
  ...DIRECTORY.map((c): PickRow => ({ key: c.person.email, name: c.person.name, person: c.person, ghost: !c.onAlcove, sub: c.onAlcove ? c.title : 'Not on Alcove yet' }))
].sort((a, b) => a.name.localeCompare(b.name));
/** Who hasn't come to Alcove and hasn't been asked: who Invite people offers. */
const notYet = DIRECTORY.filter((c) => !c.onAlcove && !c.invited);

const matches = (query: string) => (r: PickRow) => {
  const typed = fold(query.trim());
  return !typed || fold(r.name).includes(typed) || r.person.email.toLowerCase().includes(typed);
};

/** Find someone: no ticks, pressing someone is the whole thing. */
function Find(args: Args) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(args.query);
  return (
    <Popover open={open} onOpenChange={setOpen} align="center" caret label="Everyone at your company" className="tp-pop is-list"
      anchor={<Button size="sm" icon="search">Everyone</Button>}>
      <PickList {...args} query={query} onQuery={setQuery} rows={everyone.filter(matches(query))} onPress={(r) => { args.onPress(r); setOpen(false); }} />
    </Popover>
  );
}

/** Invite people: ticks, a whole address counts as it's typed, and the foot sends what's ticked. */
function Invite(args: Args) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(args.query);
  const [picked, setPicked] = useState<Person[]>([]);
  const typed = typedIn(query);
  const whole = isEmail(typed);
  const has = (p: { email: string }) => picked.some((x) => sameEmail(x, p));
  const known = (email: string) => DIRECTORY.some((c) => sameEmail(c.person, { email }));
  const row = (p: Person, sub: string): PickRow => ({ key: p.email, name: p.name, sub, person: p, ghost: true, on: has(p) });
  const offered = whole && !has({ email: typed }) && !sameEmail(ART, { email: typed })
    ? notYet.find((c) => sameEmail(c.person, { email: typed }))?.person ?? (known(typed) ? undefined : personAt(typed)) : undefined;
  const rows = [
    ...picked.filter((p) => !known(p.email)).map((p) => row(p, 'New to you')),
    ...notYet.map((c) => row(c.person, c.title))
  ].filter(matches(typed));
  if (offered && !known(offered.email)) rows.unshift(row(offered, 'New to you'));
  const shown = rows.map((r) => (offered && sameEmail(r.person, offered) ? { ...r, on: true, typed: true } : r));
  const going = offered ? [...picked, offered] : picked;
  const toggle = (r: PickRow) => { args.onPress(r); setPicked((now) => (now.some((p) => sameEmail(p, r.person)) ? now.filter((p) => !sameEmail(p, r.person)) : [...now, r.person])); };
  const send = () => { if (going.length) { args.onFinish?.(); setPicked([]); setOpen(false); } };
  return (
    <Popover open={open} onOpenChange={setOpen} align="center" caret label="Invite people" className="tp-pop is-list"
      anchor={<Button size="sm" icon="addUser">Invite people</Button>}>
      <PickList {...args} query={query} onQuery={setQuery} address={whole ? typed : undefined} rows={shown} onPress={toggle} onFinish={send}
        foot={<>
          <Button variant="quiet" size="sm" icon="link">Copy link</Button>
          <Button variant={going.length ? 'primary' : 'secondary'} size="sm" icon="mail" disabled={!going.length} onClick={send}>{going.length ? `Invite ${going.length}` : 'Invite'}</Button>
        </>} />
    </Popover>
  );
}

const meta = {
  title: 'Components/Forms/PickList',
  component: PickList,
  parameters: { layout: 'centered' },
  args: {
    label: 'Find someone', placeholder: 'Find someone', query: '', rows: [], none: 'Nobody here by that name.', ticks: false, tall: true,
    onQuery: did('onQuery'), onPress: did('onPress'), onFinish: did('onFinish')
  },
  argTypes: {
    query: { control: 'text', description: 'What’s on the line when the story opens' },
    rows: { control: false }, foot: { control: false }, address: { control: false }, none: { control: 'text' }
  },
  decorators: [(Story) => <div style={{ minHeight: 560, paddingTop: 8 }}><Story /></div>],
  render: (args) => <Find {...args} />
} satisfies Meta<typeof PickList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Finding someone on the Team page: everyone at the company, those not on Alcove yet in an empty arch. */
export const FindSomeone: Story = { name: 'Find someone' };
/** What's typed narrows the list, by name or address. */
export const Narrowed: Story = { args: { query: 'ma' } };
/** Nobody matches: the list says so. */
export const NobodyFound: Story = { name: 'Nobody found', args: { query: 'Kramer' } };
/** Inviting people: several can be ticked, and the foot sends them. */
export const PickSeveral: Story = {
  name: 'Pick several',
  args: { label: 'Name or email', placeholder: 'Name or email', ticks: true, tall: false, none: 'Everyone here has been asked.' },
  render: (args) => <Invite {...args} />
};
/** A whole address typed counts as it's typed: its row is ticked, and finishing takes it without pressing Enter first. */
export const AnAddressTyped: Story = { ...PickSeveral, name: 'An address typed', args: { ...PickSeveral.args, query: 'jonas@weber.design' } };
/** Adding people to a group, on a popover's surface: one ticked, and the foot says who sees the group. */
export const AddingToAGroup: Story = {
  name: 'Adding to a group',
  args: {
    label: 'Name or email', placeholder: 'Name or email', ticks: true, tall: false,
    rows: everyone.filter((r) => r.person !== ART).slice(0, 5).map((r, i) => ({ ...r, on: i === 1 })),
    foot: <><span className="tp-priv"><Icon name="lock" size={14} />Only you see your groups</span><Button variant="primary" size="sm">Add 1</Button></>
  },
  render: (args) => <div className="ac-pop tp-pop is-list sbc-pop"><PickList {...args} /></div>
};
