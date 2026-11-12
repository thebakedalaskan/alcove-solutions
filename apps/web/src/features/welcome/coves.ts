/*
 * The coves the welcome page looks out of, so it isn't Home's open sea: signing in sails out of the hero's (SailOut on Home).
 * The hero's nearest cliffs reach down to the foot of the window; the last ask's stand a little way into the water.
 */
import type { SkyCove } from './Sky';

export const HERO_COVE: SkyCove = { seed: 5, foot: (sky) => Math.max(sky + 110, sky + (document.documentElement.clientHeight - sky) * 0.94) };
export const CLOSE_COVE: SkyCove = { seed: 11, foot: (sky) => sky + 110 };
/** Plans, at night with the last of the sun: a narrower bay, its cliffs a little way into the water. */
export const PLANS_COVE: SkyCove = { seed: 8, foot: (sky) => sky + 96 };
