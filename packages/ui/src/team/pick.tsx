/*
 * People to find and press, inside a popover: a line to type in, then rows with their arches. With `ticks` it picks
 * several and the popover's foot finishes; without, pressing someone is the whole thing. ↑ and ↓ move through the rows
 * and Enter presses one, so hands stay on the line. Enter ticks whoever's found and clears the line, and Enter again
 * finishes. A comma, a semicolon, a space or Tab after a whole address ticks it too. A row that can't be picked says why
 * under its name and isn't ticked by anything. It takes plain rows and handlers: who's found, and what counts as an
 * address, are the caller's. Team's look (team/team.css, `tp-`), where it began.
 */
import type { Person } from '@alcove/api';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Avatar, GhostArch } from '../foundation/people';

export interface PickRow {
  key: string; name: string; sub?: string | undefined; person: Person;
  /** Not on Alcove yet: an empty arch in place of their face. */
  ghost?: boolean | undefined;
  /** Ticked. */
  on?: boolean | undefined;
  /** Ticked because the whole address is on the line: pressing it is what makes that stick. */
  typed?: boolean | undefined;
  /** A small tag at the row's end, before its tick: "Invited". */
  tag?: string | undefined;
  /** Why it can't be picked now ("Sent today", "Invited by Priya"): said under the name, and pressing it does nothing. */
  unavailable?: string | undefined;
  /** What pressing it does, for a screen reader: "Invite Diego Ruiz". */
  label?: string | undefined;
}

/** What finishes an address on the line, as it does in a mail app. */
const SEPARATORS = new Set([',', ';', ' ', 'Tab']);

export function PickList({ label, placeholder = 'Name or email', query, onQuery, address, rows, none, note, noteId, ticks = false, tall = false, onPress, onFinish, foot }: {
  label: string; placeholder?: string | undefined; query: string; onQuery: (q: string) => void;
  /** A quiet line under the field, said once: what pressing the foot's button does beyond the obvious. */
  note?: ReactNode;
  /** The note's ID, so what it's about (the foot's button) can point at it too. The field always does. */
  noteId?: string | undefined;
  /** The whole address on the line, in lower case, when what's typed is one: a separator after it ticks its row. */
  address?: string | undefined;
  rows: PickRow[];
  /** What the list says with nobody in it. */
  none: ReactNode;
  ticks?: boolean | undefined; tall?: boolean | undefined;
  onPress: (row: PickRow) => void;
  /** Enter once someone's ticked, with nothing typed and nobody else reached for. */
  onFinish?: (() => void) | undefined;
  foot?: ReactNode;
}) {
  const [act, setAct] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /* Reaching for a row with ↑ or ↓ is choosing it: Enter then ticks or unticks that one. */
  const moved = useRef(false);
  const id = useId();
  const noted = note !== undefined && note !== null && note !== false;
  const said = noteId ?? `${id}-note`;
  const at = Math.max(0, Math.min(act, rows.length - 1));

  useEffect(() => {
    const t = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, []);
  useEffect(() => { list.current?.querySelector('[data-act]')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  const move = (to: number) => { moved.current = true; setAct(to); };
  const clear = () => { onQuery(''); setAct(0); };
  const press = (row: PickRow) => { if (row.unavailable !== undefined) return; onPress(row); if (ticks) clear(); };
  /* Found by typing, someone gets ticked and never unticked: already ticked, the line just clears. */
  const tick = (row: PickRow) => { if (!row.on || row.typed) press(row); else clear(); };
  const enter = () => {
    const row = rows[at];
    const reached = moved.current;
    moved.current = false;
    if (row && reached) press(row);
    else if (row && query.trim() && row.unavailable === undefined) tick(row);
    else if (onFinish && rows.some((r) => r.on)) onFinish();
    else if (row) press(row);
  };
  /* An address is finished by what comes after it. Tab after an address nobody has goes on to the next control. */
  const separate = (key: string, stop: () => void) => {
    if (!ticks || !address || !SEPARATORS.has(key)) return;
    const row = rows.find((r) => r.person.email.toLowerCase() === address);
    if (row || key !== 'Tab') stop();
    if (row) tick(row);
  };
  return (
    <>
      <label className="tp-find">
        <Icon name="search" size={18} />
        {/* Finding people, not signing in: 1Password's offer to fill a name or an email doesn't belong on it. */}
        <input ref={input} value={query} placeholder={placeholder} autoComplete="off" spellCheck={false} data-1p-ignore aria-label={label} role="combobox" aria-expanded="true" aria-controls={id}
          aria-activedescendant={rows.length ? `${id}-${at}` : undefined} aria-describedby={noted ? said : undefined}
          onChange={(e) => { onQuery(e.target.value); setAct(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(Math.min(rows.length - 1, at + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(Math.max(0, at - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); enter(); }
            else separate(e.key, () => e.preventDefault());
          }} />
      </label>
      {noted && <p className="tp-pick-note" id={said}>{note}</p>}
      <div ref={list} id={id} className={cn('tp-list', tall && 'is-tall')} role="listbox" aria-label={label} aria-multiselectable={ticks || undefined}>
        {rows.map((r, i) => {
          const off = r.unavailable !== undefined;
          const sub = r.unavailable ?? r.sub;
          return (
            <button key={r.key} id={`${id}-${i}`} type="button" role="option" aria-selected={ticks ? r.on === true : i === at} aria-disabled={off || undefined}
              aria-label={r.label} aria-describedby={sub ? `${id}-${i}-s` : undefined} tabIndex={-1} data-act={i === at || undefined}
              className={cn('tp-l', i === at && 'is-act', off && 'is-off', r.tag !== undefined && 'has-tag')}
              onMouseMove={() => setAct(i)} onClick={() => { press(r); input.current?.focus({ preventScroll: true }); }}>
              {r.ghost ? <GhostArch size={32} initial={r.name} /> : <Avatar person={r.person} size={32} />}
              <span className="tp-l-t"><b className="ac-clamp-1">{r.name}</b>{sub && <small id={`${id}-${i}-s`} className="ac-clamp-1">{sub}</small>}</span>
              {r.tag !== undefined && <span className="tp-l-tag">{r.tag}</span>}
              {ticks && <span className={cn('tp-ck', r.on && 'is-on', off && 'is-off')} aria-hidden="true"><Icon name="check" size={13} /></span>}
            </button>
          );
        })}
        {!rows.length && <p className="tp-none">{none}</p>}
      </div>
      {foot && <div className="tp-pop-f">{foot}</div>}
    </>
  );
}
