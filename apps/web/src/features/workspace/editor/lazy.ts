/*
 * The way in. ProseMirror and everything around it stay out of the app until a document opens: `Editor` here is a
 * lazy component, so render it inside a Suspense. Types are free to import from `./types`.
 */
import { lazy } from 'react';

const load = () => import('./Editor');

export const Editor = lazy(load);

/** Starts fetching the editor early, for when a document is about to open. */
export const preloadEditor = (): void => { void load(); };
