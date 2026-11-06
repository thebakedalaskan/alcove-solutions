/* A world with nobody signed in and nothing in it, served until a story starts its scenario. */
import { notConnected } from '../world/build';
import { on } from '../world/clock';
import { PREFS, WELCOME_CREDITS, type Opening, type World } from '../world';

export const EMPTY_WORLD = (): World => ({
  session: null, prefs: PREFS, team: null, notes: [], personal: {}, meetings: [], calendar: notConnected, credits: WELCOME_CREDITS,
  documents: { workspaces: [] }, workspaces: [], pages: {}, shares: {}, boards: {}, media: [], rings: [], writing: null
});

/** 16:12 on the demo day, a connection, and answers in a moment. */
export const QUIET: Opening = { now: on(0, 16, 12), browser: {}, signedInHere: false, tourSeen: true, latency: 60 };
