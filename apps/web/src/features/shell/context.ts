import type { Document, Person } from '@alcove/api';
import { createContext, useContext } from 'react';

/** A board to open for whoever starts a call, once it's under way: where it's saved, by its name. */
export interface BoardToOpen { workspaceId: string; documentId: string; name: string }
/**
 * What Start a call opens with: people already picked, the group's name when they're one, `later` to go straight to scheduling
 * (to When, with people picked), and what the call brings from your library. `open` is a board among them that opens on
 * your stage as the call starts, just for you, for you to present: Start a call here, on a board's page, asks for that.
 */
export interface StartOptions { people?: Person[] | undefined; name?: string | undefined; later?: boolean | undefined; documents?: Document[] | undefined; open?: BoardToOpen | undefined }
/** Starting calls, from anywhere inside the app shell: `start` opens Start a call. A call ahead opens its own page. */
export interface CallFlow {
  start(opts?: StartOptions): void;
}
export const CallFlowContext = createContext<CallFlow>({ start: () => {} });
export const useCallFlow = () => useContext(CallFlowContext);

/** What the palette opens for: finding a note or asking your notes, or picking notes to pin. */
export type PaletteStart = { mode: 'find' } | { mode: 'pin' };

/** Calls scheduled moments ago, so their row can say so once: "Just scheduled". */
export const freshCalls = new Set<string>();
/** Calls moved moments ago, so their row can say so once: "Moved". */
export const movedCalls = new Set<string>();
