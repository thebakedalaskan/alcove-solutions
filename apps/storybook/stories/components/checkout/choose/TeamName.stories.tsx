import { TeamName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../../src/component';
import { Step } from '../parts';

/**
 * A team's name, typed into a box with its label inside, under a heading and a word on it: starting one (PlanTeamStart, in the
 * popover Plans' Team card opens and in checkout opened on Team with no team, the company's name to start with where the
 * directory knows it) and renaming one (TeamRename).
 */
const meta = {
  title: 'Components/Checkout/Choose/TeamName', component: TeamName, parameters: { layout: 'centered' },
  args: { value: 'Vandelay Industries', onChange: did('onChange'), label: 'Start a team', hint: 'It’s free', placeholder: 'Your company or team' },
  argTypes: { value: { control: 'text' }, label: { control: 'text' }, disabled: { control: 'boolean' }, hint: { control: 'text' }, placeholder: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <TeamName {...args} onChange={(name) => { args.onChange(name); update({ value: name }); }} />;
  }
} satisfies Meta<typeof TeamName>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The company's name, from its directory. */
export const Named: Story = {};
export const NamedNight: Story = { globals: { theme: 'dark' } };
/** At a personal address: the name starts as yours. */
export const AtAPersonalAddress: Story = { name: 'At a personal address', args: { value: 'Art’s team' } };
/** Emptied: nothing to start yet. */
export const Empty: Story = { args: { value: '' } };
/** Renaming the team. */
export const Renaming: Story = { args: { label: 'Rename team', hint: 'Everyone on it sees it' } };
/** While its name is what it is. */
export const Fixed: Story = { args: { disabled: true } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
