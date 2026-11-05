/*
 * People to find and press, inside a popover: a line to type in, then rows with their arches. With `ticks` it picks
 * several and the popover's foot finishes; without, pressing someone is the whole thing. ↑ and ↓ move through the rows
 * and Enter presses one, so hands stay on the line. Enter ticks whoever's found and clears the line, and Enter again
 * finishes. A comma, a space or Tab after a whole address ticks it too.
 */
import type { Person } from '@alcove/api';
import { Avatar, GhostArch, Icon, cn } from '@alcove/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isEmail, sameEmail } from '~/lib/people';

export interface PickRow {
  key: string; name: string; sub?: string | undefined; person: Person; ghost?: boolean | undefined; on?: boolean | undefined;
  /** Ticked because the whole address is on the line: pressing it is what makes that stick. */
  typed?: boolean | undefined;
}

/** What's on the line, to match against: a comma or semicolon pasted after an address isn't part of it. */
export const typedIn = (query: string) => query.trim().replace(/[,;\s]+$/, '').toLowerCase();

export function PickList({ label, placeholder = 'Name or email', query, onQuery, rows, none, ticks = false, tall = false, onPress, onFinish, foot }: {
  label: string; placeholder?: string | undefined; query: string; onQuery: (q: string) => void; rows: PickRow[];
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
  const at = Math.max(0, Math.min(act, rows.length - 1));

  useEffect(() => {
    const t = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, []);
  useEffect(() => { list.current?.querySelector('[data-act]')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  const move = (to: number) => { moved.current = true; setAct(to); };
  const clear = () => { onQuery(''); setAct(0); };
  const press = (row: PickRow) => { onPress(row); if (ticks) clear(); };
  /* Found by typing, someone gets ticked and never unticked: already ticked, the line just clears. */
  const tick = (row: PickRow) => { if (!row.on || row.typed) press(row); else clear(); };
  const enter = () => {
    const row = rows[at];
    const reached = moved.current;
    moved.current = false;
    if (row && reached) press(row);
    else if (row && query.trim()) tick(row);
    else if (onFinish && rows.some((r) => r.on)) onFinish();
    else if (row) press(row);
  };
  /* An address is finished by what comes after it, as it is in a mail app. */
  const separate = (key: string, stop: () => void) => {
    const typed = typedIn(query);
    if (!ticks || !isEmail(typed) || ![',', ';', ' ', 'Tab'].includes(key)) return;
    const row = rows.find((r) => sameEmail(r.person, { email: typed }));
    if (row || key !== 'Tab') stop();
    if (row) tick(row);
  };
  return (
    <>
      <label className="tp-find">
        <Icon name="search" size={18} />
        <input ref={input} value={query} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-label={label} role="combobox" aria-expanded="true" aria-controls={id}
          aria-activedescendant={rows.length ? `${id}-${at}` : undefined}
          onChange={(e) => { onQuery(e.target.value); setAct(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(Math.min(rows.length - 1, at + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(Math.max(0, at - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); enter(); }
            else separate(e.key, () => e.preventDefault());
          }} />
      </label>
      <div ref={list} id={id} className={cn('tp-list', tall && 'is-tall')} role="listbox" aria-label={label} aria-multiselectable={ticks || undefined}>
        {rows.map((r, i) => (
          <button key={r.key} id={`${id}-${i}`} type="button" role="option" aria-selected={ticks ? r.on === true : i === at} tabIndex={-1} data-act={i === at || undefined} className={cn('tp-l', i === at && 'is-act')}
            onMouseMove={() => setAct(i)} onClick={() => { press(r); input.current?.focus({ preventScroll: true }); }}>
            {r.ghost ? <GhostArch size={32} initial={r.name} /> : <Avatar person={r.person} size={32} />}
            <span className="tp-l-t"><b className="ac-clamp-1">{r.name}</b>{r.sub && <small className="ac-clamp-1">{r.sub}</small>}</span>
            {ticks && <span className={cn('tp-ck', r.on && 'is-on')} aria-hidden="true"><Icon name="check" size={13} /></span>}
          </button>
        ))}
        {!rows.length && <p className="tp-none">{none}</p>}
      </div>
      {foot && <div className="tp-pop-f">{foot}</div>}
    </>
  );
}
