/* A world with nobody signed in and nothing in it, served until a story starts its scenario. */
import { paymentsOff } from '../world/plans/payments';
import { disconnectedDrive } from '../world/drive-exports';
import { notConnected } from '../world/build';
import { on } from '../world/clock';
import { newPlan } from '../world/plans/plans';
import { PREFS, type Opening, type World } from '../world/world';

export const EMPTY_WORLD = (): World => ({
  drive: disconnectedDrive(), payments: paymentsOff(), session: null, prefs: PREFS, team: null, notes: [], personal: {}, meetings: [], calendar: notConnected, plan: newPlan(),
  documents: { workspaces: [] }, workspaces: [], pages: {}, shares: {}, boards: {}, mentions: [], media: [], rings: [], writing: null
});

/** 16:12 on the demo day, a connection, and answers in a moment. */
export const QUIET: Opening = { now: on(0, 16, 12), browser: {}, signedInHere: false, tourSeen: true, latency: 60 };
