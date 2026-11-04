/* Recent notes: your four newest, as tiles that open them. */
import { firstName, type Inbox, type NoteSummary } from '@alcove/api';
import { Icon, NoteTile, coverFor } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { hoursAndMinutes, noteDay } from '~/lib/time';

/** Under the title: when, and how long or where; or who it's from. */
function metaOf(n: NoteSummary): string {
  const day = noteDay(n.startedAt);
  if (n.received) return `From ${firstName(n.received.by.name)} · ${day}`;
  return n.kind === 'room' ? `${day} · in the room` : `${day} · ${hoursAndMinutes(Math.max(1, Math.round(n.duration / 60)))}`;
}

/** At the end of the tile, the one thing to know: still being written, decisions to confirm, shared with you, or open follow-ups. */
function endOf(n: NoteSummary, toConfirm: number): string | undefined {
  if (n.status === 'recording') return 'Recording';
  if (n.status === 'pending') return 'Being written';
  if (toConfirm) return `${toConfirm} to confirm`;
  if (n.received?.role === 'shared') return 'Shared with you';
  return n.openActions ? `${n.openActions} follow-up${n.openActions === 1 ? '' : 's'}` : undefined;
}

export function Recent({ notes, inbox }: { notes: readonly NoteSummary[]; inbox: Inbox }) {
  const h = useId();
  return (
    <section className="hm-recent" aria-labelledby={h} style={{ '--d': 2 }}>
      <div className="hm-row-head"><h3 id={h}>Recent notes</h3><Link to="/notes">All notes<Icon name="right" size={14} /></Link></div>
      <div className="hm-tiles">
        {notes.slice(0, 4).map((n) => {
          const alone = n.people.length <= 1;
          return (
            <NoteTile key={n.id} cover={coverFor(n.id)} room={n.kind === 'room'} title={n.title} meta={metaOf(n)}
              excerpt={n.excerpt || (n.status === 'ready' ? 'Nothing was said while notes were on.' : n.status === 'pending' ? 'The summary, decisions and follow-ups show here once they’re written.' : 'Recording now.')}
              faces={alone ? undefined : n.people} who={alone ? <><Icon name="lock" size={14} />Only you</> : undefined}
              end={endOf(n, inbox.decisions.filter((d) => d.noteId === n.id).length)}
              link={<Link to="/notes/$noteId" params={{ noteId: n.id }} />} />
          );
        })}
      </div>
    </section>
  );
}
