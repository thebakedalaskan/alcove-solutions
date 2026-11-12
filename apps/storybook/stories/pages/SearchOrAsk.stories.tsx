/*
 * The palette: one line over the page, from Search or ask at the top right of every page (⌘K on a Mac, Ctrl+K elsewhere).
 * Before anything is typed it lists the five newest notes; typing finds notes, and Enter asks every note you have. The pin
 * beside the side panel's Pinned opens it to pick notes to pin (user-flows 2).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/Search or ask', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
/** ⌘ on a Mac, Ctrl elsewhere, as the app reads it. */
const mod = () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control');
const open: Play = async ({ canvas, userEvent, step }) => {
  await step('Press ⌘K (Ctrl+K off a Mac): the palette drops from the top, with the five newest notes', async () => {
    await canvas.findByRole('button', { name: /^Start now/ }, { timeout: 8000 });
    await userEvent.keyboard(`{${mod()}>}k{/${mod()}}`);
    await screen.findByRole('combobox', { name: /Search or ask your notes/ });
  });
};
const typing = (text: string, said: string): Play => async (ctx) => {
  await open(ctx);
  await ctx.step(said, async () => {
    await ctx.userEvent.type(await screen.findByRole('combobox', { name: /Search or ask your notes/ }), text);
  });
};

export const Open = page('/home', 'busy', { play: open });
export const OpenPhone = phone(Open);
/** Typing finds the notes whose titles, summaries or transcripts have the words, with the match marked. */
export const Found = page('/home', 'busy', { play: typing('launch', 'Type “launch”') });
/** Enter asks every note: the answer appears under the line with the notes and moments it comes from. */
export const Asked = page('/home', 'busy', { play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch, and press Enter') });
/**
 * Typing @ offers the notes you can open, your team's included, by title: the one picked sits under the line, is read first
 * and goes with the question (up to five).
 */
const referring: Play = async (ctx) => {
  await typing('What did we decide in @', 'Type a question, then @: the notes you can open are offered')(ctx);
  await ctx.step('Find Roadmap review, a note Priya made visible to the team, and press Enter', async () => {
    await ctx.userEvent.type(await screen.findByRole('combobox', { name: 'Notes to refer to' }, { timeout: 8000 }), 'roadmap{Enter}');
  });
  await ctx.step('Finish the question and ask', async () => {
    await ctx.userEvent.type(await screen.findByRole('combobox', { name: /Search or ask your notes/ }), ' about the admin page?{Enter}');
  });
};
export const PickingANoteToReferTo = page('/home', 'team-member', { play: typing('What did we decide in @', 'Type a question, then @: the notes you can open are offered') });
export const AskWithAReference = page('/home', 'team-member', { play: referring });
export const AskWithAReferenceNight = page('/home', 'team-member', { play: referring, globals: { theme: 'dark' } });
export const AskWithAReferencePhone = phone(AskWithAReference);
/** The pin beside Pinned, in the side panel: a wide screen's, since a phone has no side panel. */
const pinning = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: (async ({ canvas, userEvent, step }) => {
    await step('Press the pin beside Pinned, in the side panel', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Pin a note' }, { timeout: 8000 }));
      await screen.findByRole('combobox', { name: 'Find a note to pin' });
    });
  }) satisfies Play
};
/** Pick notes to pin, up to eight. */
export const Pinning = page('/home', 'busy', pinning);
/** Eight are pinned already: it says to unpin one first. */
export const PinningWithEightPinned = page('/home', 'lots', pinning);
