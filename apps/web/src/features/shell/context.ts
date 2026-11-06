import type { Document, Meeting, Person } from '@alcove/api';
import { createContext, useContext } from 'react';

/** A board to open for everyone once a call starts, where it's saved, by its name. */
export interface BoardToOpen { workspaceId: string; documentId: string; name: string }
/**
 * What Start a call opens with: people already picked, the group's name when they're one, `later` to go straight to scheduling
 * (to When, with people picked), and what the call brings from your library. `open` is a board among them that opens for
 * everyone as the call starts: Start a call here, on a board's page, asks for that.
 */
export interface StartOptions { people?: Person[] | undefined; name?: string | undefined; later?: boolean | undefined; documents?: Document[] | undefined; open?: BoardToOpen | undefined }
/**
 * Starting and opening calls, from anywhere inside the app shell. `start` opens Start a call. `open` opens a call's
 * card; `onGone` is where focus goes if the call is cancelled from it, since the row it came from goes too.
 */
export interface CallFlow {
  start(opts?: StartOptions): void;
  open(meeting: Meeting, opts?: { onGone?: (() => void) | undefined }): void;
}
export const CallFlowContext = createContext<CallFlow>({ start: () => {}, open: () => {} });
export const useCallFlow = () => useContext(CallFlowContext);

/** What the palette opens for: finding a note or asking your notes, or picking notes to pin. */
export type PaletteStart = { mode: 'find' } | { mode: 'pin' };

/** Calls scheduled moments ago, so their row on Home can say so once. */
export const freshCalls = new Set<string>();
