/*
 * ThemePreview: one choice of how Alcove looks: a small evening in that theme's own colours, whatever the page's theme
 * is (both, split across it, for System), named underneath. `pressed` rings the one in use. Settings' Appearance has
 * the three in a row. `small` is the window alone, about 40 by 26, named by its tooltip, as your menu's Theme has them.
 */
import { Icon, SettingRow, SettingsPanel, THEMES, ThemePreview, type ThemeChoice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

/** Saved, for a moment after each change, as the page says it. */
function useSaved(): [boolean, () => void] {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!n) return undefined;
    const t = setTimeout(() => setN(0), 2200);
    return () => clearTimeout(t);
  }, [n]);
  return [n > 0, () => setN((x) => x + 1)];
}

/** Settings' Appearance: the three in a row, the one in use ringed, and Saved for a moment after a change. */
function Appearance({ theme, onPick }: { theme: ThemeChoice; onPick: (theme: ThemeChoice) => void }) {
  const [saved, say] = useSaved();
  const pick = (t: ThemeChoice) => { if (t === theme) return; onPick(t); say(); };
  return (
    <div className="set-groups" style={{ width: 'min(940px, calc(100vw - 32px))' }}>
      <SettingsPanel title="Appearance" tag={<><Icon name="laptop" />This browser</>}>
        <SettingRow wide label="Theme" saved={saved ? 'Saved' : undefined}
          control={<div className="set-eves" role="group" aria-label="Appearance">{THEMES.map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => pick(t)} />)}</div>} />
      </SettingsPanel>
    </div>
  );
}

const meta = {
  title: 'Components/Layout/ThemePreview',
  component: ThemePreview,
  parameters: { layout: 'centered' },
  args: { theme: 'system', pressed: false, small: false, onClick: did('onClick') },
  argTypes: { theme: { control: 'inline-radio', options: THEMES }, pressed: { control: 'boolean' }, small: { control: 'boolean' } },
  /* Pressing one makes it the one in use, as on the page. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    /* A grid, as Settings' row of three is, so the preview takes the width it's given. */
    return <div style={{ display: 'grid', width: 176 }}><ThemePreview {...args} onClick={(e) => { args.onClick?.(e); update({ pressed: true }); }} /></div>;
  }
} satisfies Meta<typeof ThemePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

/** System: both evenings, split, since it follows the computer. */
export const System: Story = {};
export const Light: Story = { args: { theme: 'light' } };
export const Dark: Story = { args: { theme: 'dark' } };
/** The one in use, ringed in sun. */
export const Pressed: Story = { args: { theme: 'dark', pressed: true } };
/** Small, as your menu's Theme has them: the window alone, its name the tooltip. Hover it. */
export const Small: Story = { args: { small: true, pressed: true } };
export const SmallNight: Story = { ...Small, name: 'Small, night', globals: { theme: 'dark' } };
/**
 * Three in a row, as Settings' Appearance has them: pressing one makes it the one in use (the `theme` control), and
 * Saved shows for a moment. Here it doesn't change Storybook's theme; the toolbar does that.
 */
export const ThreeInARow: Story = {
  name: 'Three in a row',
  parameters: { layout: 'padded' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Appearance theme={args.theme} onPick={(theme) => update({ theme })} />;
  }
};
