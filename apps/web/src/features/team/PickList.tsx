/*
 * People to find and press, inside a popover: a line to type in, then rows with their arches. With `ticks` it picks
 * several and the popover's foot finishes; without, pressing someone is the whole thing. ↑ and ↓ move through the rows
 * and Enter presses one, so hands stay on the line. Enter again, with someone ticked, finishes.
 */
import type { Person } from '@alcove/api';
import { Avatar, GhostArch, Icon, cn } from '@alcove/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PickRow { key: string; name: string; sub?: string | undefined; person: Person; ghost?: boolean | undefined; on?: boolean | undefined }

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
  const moved = useRef(false);
  const id = useId();
  const at = Math.max(0, Math.min(act, rows.length - 1));

  useEffect(() => {
    const t = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, []);
  useEffect(() => { list.current?.querySelector('[data-act]')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  const move = (to: number) => { moved.current = true; setAct(to); };
  const enter = () => {
    const row = rows[at];
    if (!query.trim() && !moved.current && onFinish && rows.some((r) => r.on)) onFinish();
    else if (row) onPress(row);
    moved.current = false;
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
          }} />
      </label>
      <div ref={list} id={id} className={cn('tp-list', tall && 'is-tall')} role="listbox" aria-label={label} aria-multiselectable={ticks || undefined}>
        {rows.map((r, i) => (
          <button key={r.key} id={`${id}-${i}`} type="button" role="option" aria-selected={ticks ? r.on === true : i === at} tabIndex={-1} data-act={i === at || undefined} className={cn('tp-l', i === at && 'is-act')}
            onMouseMove={() => setAct(i)} onClick={() => { onPress(r); input.current?.focus({ preventScroll: true }); }}>
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
