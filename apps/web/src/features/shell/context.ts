import type { Meeting } from '@alcove/api';
import { createContext, useContext } from 'react';

/** Opens the composer from anywhere inside the app shell: for a new call, or to change `meeting`. */
export const ComposerContext = createContext<(meeting?: Meeting) => void>(() => {});
export const useOpenComposer = () => useContext(ComposerContext);

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
