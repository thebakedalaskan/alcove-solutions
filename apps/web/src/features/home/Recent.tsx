/*
 * Recent notes: your newest eight as a row of cards, each with its own small sunset, scrolling sideways. Before your first
 * notes, the example note's card (the tour points at it), then a place where yours will land.
 */
import type { NoteSummary } from '@alcove/api';
import { Dots, Icon, NoteCard, RecDot, Widget, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { exampleNote } from '~/features/examples/note';
import { othersIn } from '~/features/calls/list/said';
import { accountQueries } from '~/features/account/queries';
import { callLength, pastDay } from '~/lib/time';
import { capital } from '~/lib/words';

const CARDS = 8;

export function Recent({ notes, me, now }: { notes: readonly NoteSummary[]; me: string | undefined; now: number }) {
  const session = useQuery(accountQueries.session()).data;
  const written = notes.some((n) => n.status === 'ready');
  const example = !written && session ? exampleNote(session.user) : undefined;
  return (
    <Widget bare icon="notes" title="Recent notes" className="hm-notes"
      end={<Link to="/calls" search={{ view: 'past' }} className="hm-all">View all<Icon name="right" size={14} /></Link>}>
      <div className="hm-cards">
        {notes.slice(0, CARDS).map((n) => (
          <NoteCard key={n.id} cover={coverFor(n.id)} people={othersIn(n.people, me)} room={n.kind === 'room'} writing={n.status !== 'ready'}
            title={<Link to="/calls/$noteId" params={{ noteId: n.id }}>{n.title}</Link>}
            when={n.status === 'pending' ? <>Being written<Dots /></> : n.status === 'recording' ? <><RecDot />Still recording</> : `${capital(pastDay(n.startedAt, new Date(now)))} · ${callLength(n.duration)}`} />
        ))}
        {example && (
          <NoteCard cover={coverFor(example.id)} people={othersIn(example.people, me)} tag="Example" data-tour="notes-example"
            title={<Link to="/calls/$noteId" params={{ noteId: example.id }}>{example.title}</Link>} when={`Example · ${callLength(example.duration)}`} />
        )}
        {!notes.length && <div className="hm-slot"><Icon name="notes" size={20} />Notes from your calls land here</div>}
      </div>
    </Widget>
  );
}
