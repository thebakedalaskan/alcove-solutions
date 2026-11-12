/*
 * Where the workspace's Ask found what was said about some words, outside a call: the notes the answer from every note
 * cites, under the answer (Ask.tsx). Styles in styles/workspace.css (`wv-src`, `wv-cite`).
 */
import type { NoteSummary } from '@alcove/api';
import { ArchThumb, coverFor } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { Cite } from '~/features/notes/answer';
import { noteDay, position } from '~/lib/time';

/**
 * Each note an answer cites, once, with its moments in order, each opening the note there. A note that's gone isn't
 * shown. `onPick` runs as one is opened, so the popover the answer is in can be put away.
 */
export function Sources({ cites, notes, onPick }: { cites: Cite[]; notes: NoteSummary[]; onPick: () => void }) {
  const rows: { note: NoteSummary; at: number[] }[] = [];
  for (const c of cites) {
    // Asking every note cites moments in notes; screens and a series' calls come from asking about one note or one series.
    if (c.type !== 'cite') continue;
    const row = rows.find((r) => r.note.id === c.noteId);
    if (row) { if (!row.at.includes(c.at)) row.at.push(c.at); continue; }
    const note = notes.find((n) => n.id === c.noteId);
    if (note) rows.push({ note, at: [c.at] });
  }
  if (!rows.length) return null;
  return (
    <div className="wv-src">
      <div className="wv-src-h">From your notes</div>
      <ul>
        {rows.map(({ note, at }) => {
          /* A cite at 0:00 is the note as a whole: it opens at the start, without a moment of its own. */
          const moments = at.filter((s) => s > 0).sort((a, b) => a - b);
          return (
            <li key={note.id} className="wv-cite">
              <ArchThumb cover={coverFor(note.id)} room={note.kind === 'room'} width={26} />
              <Link to="/notes/$noteId" params={{ noteId: note.id }} search={{ at: moments[0] }} className="t" onClick={onPick}>
                <b>{note.title}</b><small>{noteDay(note.startedAt)}</small>
              </Link>
              {moments.length > 0 && (
                <span className="at">
                  {moments.map((s) => (
                    <Link key={s} to="/notes/$noteId" params={{ noteId: note.id }} search={{ at: s }} className="ac-time-chip" aria-label={`${note.title} at ${position(s)}`} onClick={onPick}>{position(s)}</Link>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
