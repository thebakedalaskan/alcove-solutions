/*
 * Where a guest from outside is, as the organizer says: their calendar can't be read, so nothing else can say. It only
 * changes what the scheduler shows ("Berlin, 1 h ahead", "12:00 for Jonas"), and it's kept nowhere: the call itself is
 * always one moment, which the guest's browser reads in their own time.
 */
import { timeZone } from '~/lib/time';

/** Somewhere a guest can be, by the clock it keeps. */
export interface Place { zone: string; name: string }

export const PLACES: readonly Place[] = [
  { zone: 'Pacific/Honolulu', name: 'Honolulu' }, { zone: 'America/Los_Angeles', name: 'San Francisco' }, { zone: 'America/Denver', name: 'Denver' },
  { zone: 'America/Chicago', name: 'Chicago' }, { zone: 'America/New_York', name: 'New York' }, { zone: 'America/Sao_Paulo', name: 'São Paulo' },
  { zone: 'Europe/London', name: 'London' }, { zone: 'Europe/Lisbon', name: 'Lisbon' }, { zone: 'Europe/Paris', name: 'Paris' },
  { zone: 'Europe/Berlin', name: 'Berlin' }, { zone: 'Europe/Athens', name: 'Athens' }, { zone: 'Africa/Nairobi', name: 'Nairobi' },
  { zone: 'Asia/Dubai', name: 'Dubai' }, { zone: 'Asia/Kolkata', name: 'Mumbai' }, { zone: 'Asia/Singapore', name: 'Singapore' },
  { zone: 'Asia/Tokyo', name: 'Tokyo' }, { zone: 'Australia/Sydney', name: 'Sydney' }, { zone: 'Pacific/Auckland', name: 'Auckland' }
];

/** How far ahead of UTC the clocks in `zone` are at `at`, in minutes. */
function offsetOf(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at);
  const of = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(of('year'), of('month') - 1, of('day'), of('hour'), of('minute'));
  return Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** "Berlin, 1 h ahead", "New York, 5 h behind", "Lisbon, your time": a place and how its clock stands to yours at `at`. */
export function placeLine(p: Place, at: Date, here = timeZone()): string {
  const by = offsetOf(p.zone, at) - offsetOf(here, at);
  if (!by) return `${p.name}, your time`;
  const h = Math.floor(Math.abs(by) / 60);
  const m = Math.abs(by) % 60;
  return `${p.name}, ${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''} ${by > 0 ? 'ahead' : 'behind'}`;
}

/** What a clock in `zone` says at `at`: "12:00". */
export const clockIn = (zone: string, at: Date): string => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone });
