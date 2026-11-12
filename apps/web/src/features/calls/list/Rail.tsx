/*
 * The places beside Calls' sheet: All calls; Coming up, with how many; Past calls, with In the room and Shared with you under
 * it; each series with its next call; and at the foot the calendar that's connected, which opens Settings at it. Nothing is
 * lit while a search or an answer is on the sheet. On a phone the places are chips at the top of the sheet.
 */
import { PlaceChips, PlaceFoot, PlaceHead, PlaceRow, PlaceTree, type LinkProps } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { CallsSearch, CallsView } from './address';
import { nextLabel, type SeriesAhead } from './ahead';

/** What's on the sheet, as the rail lights it: a place, a series, or nothing (a search, an answer, someone's calls). */
export type Lit = { kind: 'view'; view: CallsView } | { kind: 'series'; id: string } | { kind: 'none' };

/** A place's link: it goes there, and leaves the search line, as moving to another place does. */
const placeLink = (search: CallsSearch, onGo: () => void) => (p: LinkProps) => <Link to="/calls" search={search} {...p} onClick={onGo} />;

export function Rail({ lit, first, soon, rooms, shared, series, calendar, now, onGo }: {
  lit: Lit;
  /** Nothing yet, ahead or past: All calls is all there is. */
  first: boolean;
  /** How many calls are ahead. */
  soon: number; rooms: number; shared: number;
  series: SeriesAhead[];
  /** What's connected, for the foot: Google Calendar, a demo account's sample calendar, or nothing. */
  calendar: 'google' | 'sample' | null;
  now: number;
  onGo: () => void;
}) {
  const on = (view: CallsView) => lit.kind === 'view' && (lit.view === view || (view === 'soon' && lit.view === 'week'));
  const place = (view: CallsView) => placeLink({ view }, onGo);
  const foot = calendar === 'google' ? <PlaceFoot icon="cal" title="Google Calendar" detail="Connected" link={(p) => <Link to="/settings" hash="calendar" {...p} />} />
    : calendar === 'sample' ? <PlaceFoot icon="cal" title="Sample calendar" detail="Demo account" link={(p) => <Link to="/settings" hash="calendar" {...p} />} /> : undefined;
  return (
    <PlaceTree label="Your calls" foot={first ? undefined : foot}>
      <PlaceRow icon="calls" label="All calls" current={on('all')} link={place('all')} />
      {!first && (
        <>
          <PlaceRow icon="cal" label="Coming up" count={soon} current={on('soon')} link={place('soon')} />
          <PlaceRow icon="clock" label="Past calls" current={on('past')} link={place('past')} />
          <PlaceRow icon="mic" label="In the room" count={rooms} depth={1} current={on('room')} link={place('room')} />
          <PlaceRow icon="share" label="Shared with you" count={shared} depth={1} current={on('shared')} link={place('shared')} />
          {series.length > 0 && <PlaceHead>Series</PlaceHead>}
          {series.map((s) => (
            <PlaceRow key={s.id} icon="repeat" label={s.title} trail={nextLabel(s.next, new Date(now))} current={lit.kind === 'series' && lit.id === s.id}
              link={placeLink({ series: s.id }, onGo)} />
          ))}
        </>
      )}
    </PlaceTree>
  );
}

/** The places on a phone: All, Coming up, Past and Series. */
export function Chips({ lit, onGo }: { lit: Lit; onGo: () => void }) {
  const is = (views: CallsView[]) => lit.kind === 'view' && views.includes(lit.view);
  const chip = (key: string, label: string, view: CallsView, current: boolean) => ({ key, label, current, link: placeLink({ view }, onGo) });
  return (
    <PlaceChips label="Your calls" chips={[
      chip('all', 'All', 'all', is(['all'])),
      chip('soon', 'Coming up', 'soon', is(['soon', 'week'])),
      chip('past', 'Past', 'past', is(['past', 'room', 'shared'])),
      chip('series', 'Series', 'series', is(['series']) || lit.kind === 'series')
    ]} />
  );
}
