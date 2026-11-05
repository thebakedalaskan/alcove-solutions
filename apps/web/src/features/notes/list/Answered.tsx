/*
 * A question across every note, on the water above the list: reading, then the answer, with each note and moment it
 * comes from. While an answer cites anything, the list and the preview follow it, whatever the filters were.
 */
import type { NoteFound } from '@alcove/api';
import { Avatar, Button, Dots, IconButton } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import type { Answer } from '~/features/notes/answer';
import { MomentChip, othersIn } from './parts';

/** Each note an answer cites, once, with its moments in order. A cite at 0:00 is the note as a whole, without a moment of its own. */
function sources(answer: Answer, notes: NoteFound[]): { note: NoteFound; at: number[] }[] {
  const rows: { note: NoteFound; at: number[] }[] = [];
  for (const c of answer.cites) {
    if (c.type !== 'cite') continue;
    const row = rows.find((r) => r.note.id === c.noteId);
    const moment = c.at > 0 ? [c.at] : [];
    if (row) row.at = [...new Set([...row.at, ...moment])].sort((a, b) => a - b);
    else {
      const note = notes.find((n) => n.id === c.noteId);
      if (note) rows.push({ note, at: moment });
    }
  }
  return rows;
}

export function Answered({ answer, lost, notes, me, onClose, onAgain, onPick }: {
  answer: Answer | null; lost: string | null; notes: NoteFound[]; me: string | undefined;
  onClose: () => void; onAgain: () => void; onPick: (e: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const cited = answer ? sources(answer, notes) : [];
  return (
    <section className="nt-ans" aria-live="polite" aria-busy={!!answer && !answer.done} aria-label="Answer from your notes">
      {lost ? (
        <div className="nt-ans-g"><p className="nt-ans-t">A note this read was deleted while it was written.</p><Button size="sm" className="nt-tint" onClick={onAgain}>Ask again</Button></div>
      ) : answer && answer.done ? (
        <>
          <p className="nt-ans-t">{answer.text}</p>
          {cited.length > 0 && (
            <div className="nt-cites">
              {cited.map(({ note, at }) => {
                const face = othersIn(note.people, me)[0];
                return (
                  <span key={note.id} className="nt-cite">
                    <Link to="/notes/$noteId" params={{ noteId: note.id }} className="nt-cite-n" title={`Show ${note.title}`} onClick={(e) => onPick(e, note.id)}>
                      {face && <Avatar person={face} size={20} />}<span className="ac-clamp-1">{note.title}</span>
                    </Link>
                    {at.map((s) => <MomentChip key={s} noteId={note.id} noteTitle={note.title} at={s} />)}
                  </span>
                );
              })}
            </div>
          )}
        </>
      ) : <p className="nt-ans-r"><Dots />Reading your notes in confidential compute</p>}
      <IconButton icon="x" size={16} label="Close the answer" className="nt-ans-x" onClick={onClose} />
    </section>
  );
}
