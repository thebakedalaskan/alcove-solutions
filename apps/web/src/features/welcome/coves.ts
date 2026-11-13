/*
 * The coves the welcome page looks out of, so it isn't Home's open sea. The hero's is the one signing in sails out of, so it's
 * the sail-out's (features/onboarding/sailOut.ts); the last ask's cliffs stand a little way into the water.
 */
import type { SkyCove } from './Sky';

export const CLOSE_COVE: SkyCove = { seed: 11, foot: (sky) => sky + 110 };
/** Plans, at night with the last of the sun: a narrower bay, its cliffs a little way into the water. */
export const PLANS_COVE: SkyCove = { seed: 8, foot: (sky) => sky + 84 };
