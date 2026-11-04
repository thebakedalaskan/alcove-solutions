/* What the workspace's components share. */
import { useReducedMotion } from 'motion/react';
import type { AvatarPerson } from '../people';
import { DURATION, EASE } from '../motion';

/** The first word of someone's name, which is what the workspace calls them. */
export const firstName = (person: AvatarPerson): string => person.name.split(' ')[0] || person.name;

/** A transition of one of the `--duration-*` tokens, on the `out` curve. Under reduced motion it's instant. */
export function useMove() {
  const reduce = useReducedMotion();
  return (d: keyof typeof DURATION) => ({ duration: reduce ? 0 : DURATION[d], ease: EASE.out });
}
