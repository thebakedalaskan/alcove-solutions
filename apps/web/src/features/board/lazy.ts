/*
 * The way in to a board outside a call. Everything that draws one, or reads one, stays out of the app until a board opens:
 * `BoardSurface` here is a lazy component, so render it inside a Suspense, and `loadCounts` brings what counts a board's frames
 * and stickies with it.
 */
import { lazy } from 'react';

const load = () => import('./BoardSurface').then((m) => ({ default: m.BoardSurface }));

export const BoardSurface = lazy(load);

/** Starts fetching the board early, for when one is about to open. */
export const preloadBoard = (): void => { void load(); };

/** What counts what's on a board (counts.ts), fetched as a board's card comes on screen. */
export const loadCounts = () => import('./counts');
