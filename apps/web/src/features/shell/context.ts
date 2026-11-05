import type { Meeting, Person } from '@alcove/api';
import { createContext, useContext } from 'react';

/** What Start a call opens with: people already picked, and the group's name when they're one. */
export interface StartOptions { people?: Person[] | undefined; name?: string | undefined }
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

/**
 * What the palette opens for: finding a note or asking your notes (`ask` asks that question straight
 * away), or picking notes to pin.
 */
export type PaletteStart = { mode: 'find'; ask?: string | undefined } | { mode: 'pin' };
/** Opens the palette from anywhere inside the app shell. Finding is the default. */
export const PaletteContext = createContext<(start?: PaletteStart) => void>(() => {});
export const useOpenPalette = () => useContext(PaletteContext);

/** Calls scheduled moments ago, so their row on Home can say so once. */
export const freshCalls = new Set<string>();
