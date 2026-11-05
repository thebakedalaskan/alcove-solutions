/*
 * A question across every note, on the water above the list: reading, then the answer, with each note and moment it
 * comes from. While an answer cites anything, the list and the preview follow it, whatever the filters were.
 */
import type { NoteFound } from '@alcove/api';
import { Avatar, Button, Dots, IconButton } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import type { Answer } from '~/features/notes/answer';
import { MomentChip, byTime, othersIn, type Said } from './parts';

/** Each note an answer cites, once, in the order it uses them. A note that's gone isn't shown. */
const sources = (answer: Answer, notes: NoteFound[]) =>
  [...new Set(answer.cites.flatMap((c) => (c.type === 'cite' ? [c.noteId] : [])))].flatMap((id) => notes.filter((n) => n.id === id));

export function Answered({ answer, lost, notes, me, saidOf, onClose, onAgain, onPick }: {
  answer: Answer | null; lost: string | null; notes: NoteFound[]; me: string | undefined;
  /** The moments it cites in a note. */
  saidOf: (n: NoteFound) => Said;
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
              {cited.map((note) => {
                const face = othersIn(note.people, me)[0];
                return (
                  <span key={note.id} className="nt-cite">
                    <Link to="/notes/$noteId" params={{ noteId: note.id }} className="nt-cite-n" title={`Show ${note.title}`} onClick={(e) => onPick(e, note.id)}>
                      {face && <Avatar person={face} size={20} />}<span className="ac-clamp-1">{note.title}</span>
                    </Link>
                    {byTime(saidOf(note).lines).map((l) => <MomentChip key={l.id} noteId={note.id} noteTitle={note.title} at={l.at} room={l.room} />)}
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
