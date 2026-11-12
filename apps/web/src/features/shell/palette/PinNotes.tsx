/*
 * Pin a note: the palette's narrow window with its own line (the pin), to pick notes to pin or unpin. They stay in the side
 * panel in the order they were pinned, up to MAX_PINS. What was pinned as it opened comes first, and rows keep their places
 * while you pin and unpin. ↑ and ↓ move, Enter or a press pins or unpins, each press is saved at once, and Done closes it.
 */
import { MAX_PINS, errorMessage, searchOf, type NoteSummary } from '@alcove/api';
import { Button, PaletteBody, PaletteFoot, PaletteGroup, PaletteLine, PaletteNoteLine, PalettePin, PaletteWaiting, cn, coverFor, paletteRow, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { marked } from '~/features/notes/highlight';
import { noteLine } from '~/features/notes/meta';
import { useSettled } from '~/lib/live';
import { q, usePins } from '~/lib/queries';
import { keepInView } from './keepInView';
import { Nothing } from './Results';

/** Notes listed before anything is typed, and at most while typing. */
const RECENT = 5;
const FOUND = 8;

export function PinNotes({ onClose }: { onClose: () => void }) {
  const list = useId();
  const toast = useToast();
  const qc = useQueryClient();
  const pins = usePins();
  const all = useQuery(q.notes()).data;
  /* A pin whose note is gone (deleted, or removed from yours) is dropped, never sent back. */
  const pinned = (useQuery(q.prefs()).data?.pinned ?? []).filter((id) => !all || all.some((n) => n.id === id));
  /* Rows keep their places while you pin and unpin: what was pinned when this opened comes first. */
  const [before] = useState(() => qc.getQueryData(q.prefs().queryKey)?.pinned ?? []);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const keyed = useRef(false);
  const term = useSettled(text.trim(), 160);
  const found = useQuery(q.notes(undefined, term || undefined));
  const terms = searchOf(term).terms;
  const first = term ? [] : before.flatMap((id) => all?.filter((n) => n.id === id) ?? []);
  const rest = term ? (found.data ?? []).slice(0, FOUND) : (all ?? []).filter((n) => !before.includes(n.id)).slice(0, RECENT);
  const rows = [...first, ...rest];
  const at = Math.max(0, Math.min(active, rows.length - 1));
  const lit = rows[at];
  const full = pinned.length >= MAX_PINS;
  const id = (i: number) => `${list}-${i}`;

  /* The lit row stays in view as ↑ and ↓ move it, inside the list. */
  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    const el = document.getElementById(id(at));
    if (el) keepInView(el, at === 0);
  });

  const toggle = (n: NoteSummary) => {
    const on = !pinned.includes(n.id);
    if (pins.isPending || (on && full)) return;
    // Its own promise, so the error is shown even when another save of preferences is queued behind it.
    pins.mutateAsync(on ? [...pinned, n.id] : pinned.filter((p) => p !== n.id)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const move = (to: number) => { keyed.current = true; setActive(to); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(Math.min(rows.length - 1, at + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(Math.max(0, at - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (lit) toggle(lit); }
  };
  const row = (n: NoteSummary, i: number) => {
    const on = pinned.includes(n.id);
    return (
      <div key={n.id} id={id(i)} role="option" aria-selected={on} aria-disabled={!on && full} className={cn(paletteRow('note', i === at), !on && full && 'is-off')}
        onMouseDown={(e) => e.preventDefault()} onMouseMove={() => { if (i !== at) setActive(i); }} onClick={() => toggle(n)}>
        <PaletteNoteLine cover={coverFor(n.id)} room={n.kind === 'room'} title={marked(n.title, terms)} meta={noteLine(n)}
          end={<PalettePin pinned={on} label={on ? 'Unpin' : full ? '' : 'Pin'} />} />
      </div>
    );
  };

  return (
    <>
      <PaletteLine icon="pin" onCancel={onClose}>
        <input className="pal-in" value={text} placeholder="Find a note to pin" aria-label="Find a note to pin"
          role="combobox" aria-expanded={rows.length > 0} aria-controls={rows.length ? list : undefined} aria-autocomplete="list"
          aria-activedescendant={rows.length ? id(at) : undefined} autoComplete="off" spellCheck={false} enterKeyHint="done"
          onChange={(e) => { setText(e.target.value); setActive(0); }} onKeyDown={keys} />
      </PaletteLine>
      <PaletteBody>
        {rows.length ? (
          <div role="listbox" id={list} aria-label="Notes" aria-multiselectable="true" className={cn(found.isPlaceholderData && term && 'is-stale')}>
            {first.length > 0 && <PaletteGroup label="Pinned">{first.map((n, i) => row(n, i))}</PaletteGroup>}
            {rest.length > 0 && <PaletteGroup label={term ? 'Notes' : 'Recent notes'}>{rest.map((n, i) => row(n, first.length + i))}</PaletteGroup>}
          </div>
        ) : found.isFetching ? (
          <PaletteWaiting label="Searching" />
        ) : term ? (
          <Nothing icon="search" title={`Nothing matches “${term}”`}>Search looks through titles, summaries and everything said.</Nothing>
        ) : all && !all.length ? (
          <Nothing icon="pin" title="No notes yet">Notes from your calls and recordings show up here, and you can pin them.</Nothing>
        ) : null}
      </PaletteBody>
      <PaletteFoot icon="pin" keys={[...(lit ? [{ keys: ['↑', '↓'], label: 'Move' }, { keys: ['↵'], label: pinned.includes(lit.id) ? 'Unpin' : 'Pin' }] : []), { keys: ['esc'], label: 'Close' }]}
        action={<Button variant="primary" size="sm" onClick={onClose}>Done</Button>}>
        {full ? `${MAX_PINS} pinned, the most there can be. Unpin one to pin another.` : 'Pinned notes stay in the side panel, in the order you pin them.'}
      </PaletteFoot>
    </>
  );
}
