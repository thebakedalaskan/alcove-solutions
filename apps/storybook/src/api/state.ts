/*
 * The world the stand-in is serving right now. The preview starts each story's scenario before the story renders
 * (`begin` in scenarios.ts); everything the stand-in answers is read from here at the moment it's asked.
 */
import type { Person } from '@alcove/api';
import type { Opening, World } from '../world';
import { ART } from '../world/people';
import { EMPTY_WORLD, QUIET } from './empty';

let world: World = EMPTY_WORLD();
let opening: Opening = QUIET;
let seq = 0;

export const current = (): World => world;
/** Whoever is signed in: you, Art Vandelay, at whichever address the scenario has you at. */
export const me = (): Person => world.session?.user ?? ART;
export const openedAs = (): Opening => opening;
export function serve(w: World, o: Opening): void {
  world = w;
  opening = o;
  seq = 0;
}
/** A new ID, unique in this story. */
export const nextId = (prefix: string): string => `${prefix}-${++seq}`;
