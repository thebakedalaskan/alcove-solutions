/*
 * Signed in with Google without sharing the calendar: one card that asks for it. "Not now" puts it away in
 * this browser; Settings can still connect the calendar.
 */
import { Button, Icon, buttonClass } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { log } from '~/lib/log';

const KEY = 'alcove-calendar-not-now';
const clog = log.child({ component: 'home' });
/* This browser may keep no storage (a private window, blocked site data): then the card shows each time Home loads. */
const putAway = () => {
  try { return localStorage.getItem(KEY) === 'yes'; } catch (e) { clog.warn('calendar card choice not read: no storage here', { err: e }); return false; }
};

/** Whether the card was put away in this browser, and putting it away. */
export function useNotNow() {
  const [away, setAway] = useState(putAway);
  const notNow = () => {
    setAway(true);
    // Without storage it stays away until the tab closes.
    try { localStorage.setItem(KEY, 'yes'); } catch (e) { clog.warn('calendar card choice not kept: no storage here', { err: e }); }
  };
  return { away, notNow };
}

export function ConnectCalendar({ onNotNow }: { onNotNow: () => void }) {
  const h = useId();
  return (
    <section className="hm-connect" aria-labelledby={h}>
      <span className="hm-tile-i"><Icon name="cal" size={18} /></span>
      <div className="min-w-0">
        <b id={h}>Connect Google Calendar</b>
        <p>See your meetings on Home, and put the calls you schedule on your calendar, with invitations.</p>
        <div className="acts">
          <Link to="/connect-calendar" className={buttonClass({ variant: 'primary', size: 'sm' })}>Connect</Link>
          <Button variant="quiet" size="sm" onClick={onNotNow}>Not now</Button>
        </div>
      </div>
    </section>
  );
}
