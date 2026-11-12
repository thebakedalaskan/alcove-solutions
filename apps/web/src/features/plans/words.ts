/*
 * How the plans' numbers are said wherever a door says them (the call when notes run out, an hour left, none left when a call
 * starts): hours of notes as the plans count them, and the pack of more hours as its button says it.
 */
import type { PlanOffers } from '@alcove/api';
import { hoursAndMinutes } from '~/lib/time';
import { usd } from '~/lib/words';

/** Hours of notes as the plans say them: "5 hours", "1 hour", or "4 h 30 min" when it isn't whole hours. */
export function hoursOfNotes(minutes: number): string {
  if (minutes % 60 !== 0) return hoursAndMinutes(minutes);
  const h = minutes / 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** The pack of more notes for this period, as a button says it: "Add 10 hours · $15". */
export const hoursLabel = (hours: NonNullable<PlanOffers['hours']>): string => `Add ${hoursOfNotes(hours.minutes)} · ${usd(hours.microUsd)}`;
/** "10 more hours of notes", "1 more hour of notes": more notes bought for this period, as Done says it. */
export function moreHoursOfNotes(minutes: number): string {
  if (minutes % 60 !== 0) return `${hoursAndMinutes(minutes)} more of notes`;
  const h = minutes / 60;
  return `${h} more ${h === 1 ? 'hour' : 'hours'} of notes`;
}
