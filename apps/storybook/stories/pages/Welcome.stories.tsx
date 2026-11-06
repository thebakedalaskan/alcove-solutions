/*
 * Welcome and sign-in: signed out, the welcome page shows what Alcove does as one evening on the app's own scene, each part
 * with a scene that plays while it's on screen, and the ways in at the top and the bottom. Each part can be opened scrolled
 * to it. A sign-in that didn't happen says why (user-flows 1).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { SOON } from '../journeys/play';

const meta = { title: 'Pages/Welcome', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Welcome = page('/welcome', 'signed-out');
export const WelcomePhone = phone(Welcome);

/** A part of the welcome page, scrolled to once its heading is there. */
const at = (id: string, heading: string): PageStory => page('/welcome', 'signed-out', {
  play: async ({ step }) => {
    await step(`Scroll to ${heading}`, async () => {
      await screen.findByRole('heading', { name: heading }, SOON);
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });
  }
});
/** The note a call leaves: it writes itself, then its call runs along its own horizon. */
export const TheNote = at('notes', 'Notes that write themselves');
/** The call, a night window: each feature plays as its step scrolls past. */
export const TheCall = at('call', 'In the call');
/** The team on the horizon, and their week. */
export const FindATime = at('time', 'Find a time with your team');
/** An agent books a call over MCP. */
export const YourAgent = at('agents', 'Your agent can use Alcove');
/** Recording in the room without a connection, on Record's night. */
export const RecordingOffline = at('offline', 'Offline recordings');
/** The same note, as you see it and as Alcove's servers hold it. */
export const WhatAlcoveCanSee = at('privacy', 'What Alcove can see');
/** Morning comes up behind the last ask. */
export const StartYourFirstCall = at('start', 'Start your first call');
/** Alcove's front door, signed out: the welcome page. */
export const FrontDoor = page('/', 'signed-out');
/** Use single sign-on asks for a work email in place. */
export const SingleSignOn = page('/welcome', 'signed-out', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Use single sign-on. It asks for a work email in place', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Use single sign-on' });
      if (first) await userEvent.click(first);
    });
  }
});
/** Back from Google without signing in: cancelled. */
export const GoogleCancelled = page('/welcome?signin=cancelled', 'signed-out');
/** Back from Google: the sign-in took too long, or started in another tab. */
export const GoogleTookTooLong = page('/welcome?signin=expired', 'signed-out');
/** Google hasn't verified the account's address. */
export const GoogleUnverified = page('/welcome?signin=unverified', 'signed-out');
/** Google sign-in isn't set up on this server. */
export const GoogleNotSetUp = page('/welcome?signin=unavailable', 'signed-out');
/** Too many attempts: wait a minute. */
export const TooManyAttempts = page('/welcome?signin=busy', 'signed-out');
/** Opened without a connection, by someone not signed in here: the welcome page, to sign in once back. */
export const Offline = page('/welcome', 'signed-out', { parameters: { opening: { browser: { online: false } } } });
