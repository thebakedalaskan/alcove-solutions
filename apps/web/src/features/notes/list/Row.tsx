/* A note in the list: who was there, what it says or the words that were found, and what's still open in it. */
import { termsIn, type NoteFound } from '@alcove/api';
import { Chip, Dots, Faces, Icon, NotesSign, cn } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { KeyboardEvent, MouseEvent } from 'react';
import { marked, nearMatch } from '~/features/notes/highlight';
import { spokenName } from '~/lib/people';
import { daysFromToday, hm, shortDay } from '~/lib/time';
import { plural } from '~/lib/words';
import { MomentChip, howOf, noSummary, othersIn, type Said } from './parts';

/** Moments a row links to; its preview lists more. */
const MOMENTS = 3;

export function Row({ n, me, terms, said, cited, toConfirm, pinned, on, wide, onPick, onMove }: {
  n: NoteFound; me: string | undefined; terms: string[]; said: Said;
  /** It's in the list because an answer cites it. */
  cited: boolean;
  toConfirm: number; pinned: boolean; on: boolean; wide: boolean;
  onPick: (e: MouseEvent<HTMLAnchorElement>, id: string) => void; onMove: (e: KeyboardEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const faces = othersIn(n.people, me).slice(0, 3);
  const how = howOf(n, me);
  const quote = said.lines.find((l) => l.text);
  // A summary that has the words says what the note is about; otherwise the line they were said in does.
  const quoted = quote && (cited || !termsIn(n.excerpt, terms));
  const recent = daysFromToday(new Date(n.startedAt)) >= -1;
  const moments = said.lines.slice(0, MOMENTS);
  const chips = moments.length > 0 || n.status !== 'ready' || toConfirm > 0 || n.openActions > 0;
  return (
    <div className={cn('nt-row', on && 'is-on')} data-note={n.id}>
      <span className="nt-lead" data-n={faces.length}>
        {faces.length ? <Faces people={faces} size={faces.length === 1 ? 40 : faces.length === 2 ? 34 : 28} max={3} /> : <span className="nt-arch"><Icon name={n.kind === 'room' ? 'mic' : 'video'} size={18} /></span>}
      </span>
      <span className="nt-b">
        <span className="nt-l1">
          <Link to="/notes/$noteId" params={{ noteId: n.id }} className="nt-title ac-clamp-1" aria-current={on ? 'true' : undefined} tabIndex={wide ? (on ? 0 : -1) : undefined}
            onClick={(e) => onPick(e, n.id)} onKeyDown={(e) => onMove(e, n.id)}>{marked(n.title, terms)}</Link>
          {how && <span className="nt-how"><Icon name={how.icon} size={13} /><span className="ac-clamp-1">{how.text}</span></span>}
        </span>
        <span className="nt-sum ac-clamp-1">
          {quoted
            ? <>{quote.speaker && <b className="nt-by">{spokenName(quote.speaker, me)}</b>}{marked(nearMatch(quote.text, terms), terms)}</>
            : n.excerpt ? marked(nearMatch(n.excerpt, terms), terms) : noSummary(n)}
        </span>
        {chips && (
          <span className="nt-chips">
            {moments.map((l) => <MomentChip key={l.id} noteId={n.id} noteTitle={n.title} at={l.at} room={l.room} tabIndex={wide && !on ? -1 : undefined} />)}
            {n.status === 'pending' && <Chip className="nt-k is-now"><Dots />Being written</Chip>}
            {n.status === 'recording' && <NotesSign className="nt-k is-rec">Still recording</NotesSign>}
            {toConfirm > 0 && <Chip className="nt-k is-decide" icon="badgeCheck">{toConfirm} to confirm</Chip>}
            {n.openActions > 0 && <Chip className="nt-k" icon="userCheck">{plural(n.openActions, 'follow-up')}</Chip>}
          </span>
        )}
      </span>
      <span className="nt-when">
        {pinned && <><Icon name="pin" size={14} className="nt-pinned" /><span className="sr-only">Pinned. </span></>}
        <span>{recent ? hm(n.startedAt) : shortDay(new Date(n.startedAt))}</span>
      </span>
    </div>
  );
}
