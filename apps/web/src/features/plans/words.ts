/*
 * How the plans' numbers are said wherever a door says them (the call when notes run out, an hour left, none left when a call
 * starts): hours of notes as the plans count them, and the pack of more hours as its button says it. What a plan brings a
 * period is said as Plans and the plan choice say it.
 */
import type { PlanOffers } from '@alcove/api';
import { hoursAndMinutes } from '~/lib/time';
import { plural, usd } from '~/lib/words';

/** What a plan brings a period, said to the hour since it's an estimate: "5 hours", or "45 min" under an hour. */
export const periodHours = (minutes: number): string => (minutes < 60 ? `${minutes} min` : plural(Math.round(minutes / 60), 'hour'));
/** How often a plan's notes come back, as the notes it brings are said: "a month" for a period of about a month. */
export const perPeriod = (days: number): string => (days >= 28 && days <= 31 ? 'a month' : days === 7 ? 'a week' : `every ${days} days`);

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
