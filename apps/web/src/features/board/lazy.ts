/*
 * The way in to a board outside a call. Everything that draws one stays out of the app until a board opens: `BoardSurface`
 * here is a lazy component, so render it inside a Suspense.
 */
import { lazy } from 'react';

const load = () => import('./BoardSurface').then((m) => ({ default: m.BoardSurface }));

export const BoardSurface = lazy(load);

/** Starts fetching the board early, for when one is about to open. */
export const preloadBoard = (): void => { void load(); };
