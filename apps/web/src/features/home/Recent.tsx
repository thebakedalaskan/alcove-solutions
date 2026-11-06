/* Recent notes: your four newest, one line each. */
import type { NoteSummary } from '@alcove/api';
import { ArchThumb, Avatar, EmptyState, Icon, coverFor } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { sameEmail } from '~/lib/people';
import { noteDay } from '~/lib/time';

export function Recent({ notes, me }: { notes: readonly NoteSummary[]; me: string | undefined }) {
  const h = useId();
  return (
    <section className="hm-panel" aria-labelledby={h}>
      <div className="hm-panel-h"><h2 id={h}><Link to="/notes" className="hm-panel-link">Recent notes<Icon name="right" size={14} /></Link></h2></div>
      {notes.length ? notes.slice(0, 4).map((n) => {
        const other = n.people.find((p) => !me || !sameEmail(p, { email: me }));
        return (
          <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }} className="hm-note">
            {other ? <Avatar person={other} size={26} /> : <ArchThumb cover={coverFor(n.id)} width={26} room={n.kind === 'room'} />}
            <b className="ac-clamp-1" title={n.title}>{n.title}</b>
            <small>{noteDay(n.startedAt)}</small>
          </Link>
        );
      }) : <EmptyState title="No notes yet" art={null} className="hm-none">Notes show up here after a call.</EmptyState>}
    </section>
  );
}
