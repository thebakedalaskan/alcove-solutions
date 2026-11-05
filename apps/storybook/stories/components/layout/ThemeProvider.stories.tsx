/*
 * ThemeProvider and useTheme: the theme this browser keeps, light, dark or the system's, and the `dark` class on the
 * document that follows it. The app's root gives it, and so does the preview to every story: the toolbar's Theme is what
 * it reads as a story opens, so the toolbar already drives it. useTheme() gives the choice (`theme`), what's showing
 * (`resolved`), `setTheme` and `toggle`. themeBootScript is inlined in the page's head, so the right theme paints before
 * React starts.
 */
import { Button, Card, Segmented, ThemeProvider, themeBootScript, useTheme, type ThemeChoice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const NAME: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Reads the theme with useTheme() and changes it, as Settings' Appearance does. */
function Appearance() {
  const { theme, resolved, setTheme, toggle } = useTheme();
  return (
    <Card title="Appearance" className="w-[min(440px,100%)]">
      <p className="mb-4 text-[14px] text-ink-2">Chosen: <b className="text-ink">{NAME[theme]}</b>. Showing: <b className="text-ink">{NAME[resolved]}</b>.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<ThemeChoice> label="Theme" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Button variant="quiet" size="sm" onClick={toggle}>Switch to {resolved === 'dark' ? 'light' : 'dark'}</Button>
      </div>
    </Card>
  );
}

const meta = {
  title: 'Components/Layout/ThemeProvider',
  component: ThemeProvider,
  parameters: { layout: 'centered' },
  args: { children: <Appearance /> },
  argTypes: { children: { control: false } }
} satisfies Meta<typeof ThemeProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Choose a theme here and the page follows; the toolbar's Theme sets it again. */
export const ChoosingATheme: Story = { name: 'Choosing a theme' };
/** The script the page's head runs before anything paints: the stored choice, or the system's, sets the class. */
export const BootScript: Story = {
  name: 'Boot script',
  render: () => (
    <Card title="themeBootScript" className="w-[min(640px,100%)]">
      <pre className="ac-mono mt-2 rounded-[var(--radius-sm)] bg-sunk px-4 py-3 text-[12.5px] leading-[1.6] break-all whitespace-pre-wrap text-ink-2">{themeBootScript}</pre>
    </Card>
  )
};
