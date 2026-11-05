/*
 * Notes shared with a group, newest share first, from the notes list: who shared each with which of their groups, and
 * when ("Priya shared it with Product"). Each opens its note.
 */
import type { NoteSummary, Person } from '@alcove/api';
import { Avatar, Button } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { callName, sameEmail } from '~/lib/people';
import { pastDay } from '~/lib/time';
import { capital } from '~/lib/words';
import { groupShares } from './data';

/** Rows shown before "Show all". */
const SHARES = 5;

export function SharedWithGroups({ notes, me, now }: { notes: NoteSummary[]; me: Person; now: Date }) {
  const [all, setAll] = useState(false);
  const h = useId();
  const shares = groupShares(notes);
  return (
    <section className="tp-s tp-sh" aria-labelledby={h}>
      <div className="tp-h"><h2 id={h}>Shared with groups</h2></div>
      {shares.length > 0 ? (
        <ul className="tp-rows">
          {(all ? shares : shares.slice(0, SHARES)).map((s) => (
            <li key={`${s.note.id} ${s.by.email} ${s.group}`}>
              <Link to="/notes/$noteId" params={{ noteId: s.note.id }} className="tp-nr">
                <Avatar person={s.by} size={26} />
                <span className="tp-nr-t"><b className="ac-clamp-1">{s.note.title}</b><small className="ac-clamp-1">{sameEmail(s.by, me) ? 'You' : callName(s.by)} shared it with {s.group}</small></span>
                <span className="tp-nr-w">{capital(pastDay(s.at, now))}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="tp-none">Notes shared with a group show up here.</p>}
      {shares.length > SHARES && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${shares.length}`}</Button></div>
      )}
    </section>
  );
}
