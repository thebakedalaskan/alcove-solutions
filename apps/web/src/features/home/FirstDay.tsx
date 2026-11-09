/*
 * The first day, before any notes: what's worth doing first. Each tile takes you there, and only what's left to do
 * shows: a connected calendar isn't offered again, and someone on their own has no team to invite.
 */
import { Icon, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { q } from '~/lib/queries';

function Face({ icon, children }: { icon: IconName; children: ReactNode }) {
  return <><span className="hm-tile-i"><Icon name={icon} size={16} /></span><span className="hm-tile-t">{children}</span><Icon name="right" size={16} /></>;
}

export function GetSetUp() {
  const h = useId();
  const team = useQuery(q.team()).data;
  const calendar = useQuery(q.calendar()).data;
  const connect = <Face icon="cal">Connect your calendar</Face>;
  return (
    <section className="hm-panel" aria-labelledby={h}>
      <div className="hm-panel-h"><h2 id={h}>Get set up</h2></div>
      <div className="hm-tiles">
        <Link to="/notes/$noteId" params={{ noteId: 'example' }} className="hm-tile hm-setup" data-tour="notes-example"><Face icon="notes">Read an example note</Face></Link>
        {calendar?.needsAccess
          ? <Link to="/connect-calendar" className="hm-tile hm-setup">{connect}</Link>
          : calendar?.source === 'none' && <Link to="/settings" hash="calendar" className="hm-tile hm-setup">{connect}</Link>}
        {team && <Link to="/team" className="hm-tile hm-setup"><Face icon="people">Invite your team</Face></Link>}
      </div>
    </section>
  );
}
