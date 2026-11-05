/*
 * The palette: one line over the page, to find a note or to ask your notes. ⌘K (Ctrl+K), Search or ask
 * at the top of every page and the phone's search button open it. Typing lists the notes that match; Enter
 * asks every note you have, and the answer arrives here with the notes and moments it comes from.
 * ↑ and ↓ pick a note instead, and Enter opens it. "Pin a note" opens the same line to pick notes to
 * pin. It's the only thing open while it's open. Escape closes it, and focus goes back where it was.
 */
import { MAX_PINS, errorMessage, firstName, searchOf, type AnswerPart, type NoteSummary } from '@alcove/api';
import { ArchThumb, Button, ComposerLine, Dots, Icon, Kbd, Scope, Sheet, cn, coverFor, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnswerView, useAnswer, type Cite } from '~/features/notes/answer';
import { marked } from '~/features/notes/highlight';
import { noteMeta } from '~/features/notes/meta';
import { api } from '~/lib/api';
import { useSettled } from '~/lib/live';
import { q, usePins } from '~/lib/queries';
import { noteDay, position } from '~/lib/time';
import type { PaletteStart } from './context';

const askAll = (question: string): AsyncIterable<AnswerPart> => api.notes.askAll(question);
/** Notes listed before anything is typed, and at most while typing. */
const RECENT = 5;
const FOUND = 8;

export function Palette({ open, onOpenChange, start }: { open: boolean; onOpenChange: (open: boolean) => void; start: PaletteStart }) {
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={start.mode === 'pin' ? 'Pin a note' : 'Search or ask'} className="pal">
      {start.mode === 'pin' ? <PinNotes onClose={close} /> : <Find onClose={close} />}
    </Sheet>
  );
}

/** A note in the palette: its sky, its title with what matched marked, when it was and what it holds. */
function NoteLine({ n, term }: { n: NoteSummary; term: string }) {
  return (
    <>
      <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} width={26} />
      <span className="t"><b>{marked(n.title, searchOf(term).terms)}</b><small>{noteDay(n.startedAt)} · {n.received ? `From ${firstName(n.received.by.name)}` : noteMeta(n)}</small></span>
    </>
  );
}

/** A labelled run of options in the list. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div role="group" aria-labelledby={id}><div id={id} className="pal-grp">{label}</div>{children}</div>;
}

/** Find a note, or ask every note you have. */
function Find({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const list = useId();
  const [text, setText] = useState('');
  /** The note ↑ and ↓ picked; -1 is the line itself, where Enter asks. */
  const [active, setActive] = useState(-1);
  const { answer, ask: run, reset } = useAnswer(askAll);
  const term = useSettled(text.trim(), 160);
  const all = useQuery(q.notes()).data;
  const found = useQuery(q.notes(undefined, answer ? undefined : term || undefined));
  const rows = (found.data ?? []).slice(0, term ? FOUND : RECENT);
  const at = Math.min(active, rows.length - 1);
  const listed = !answer && rows.length > 0;
  const asking = !!answer && !answer.done;
  /* One question at a time: while its answer is on the way or on screen, Enter and Ask wait for a new one (editing the line clears the answer). */
  const ready = text.trim() !== '' && !answer;

  const submit = () => { if (!ready) return; setActive(-1); void run(text); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' && listed) { e.preventDefault(); setActive(Math.min(rows.length - 1, at + 1)); }
    else if (e.key === 'ArrowUp' && listed) { e.preventDefault(); setActive(Math.max(-1, at - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const n = listed ? rows[at] : undefined;
      if (!n) { submit(); return; }
      onClose();
      void navigate({ to: '/notes/$noteId', params: { noteId: n.id } });
    }
  };

  return (
    <>
      <ComposerLine icon="search" className="pal-line" action={<><Scope>Only you</Scope><Kbd className="pal-esc">esc</Kbd></>}>
        <input className="text" value={text} placeholder="Search your notes, or ask a question" aria-label="Search or ask your notes, for you alone"
          role="combobox" aria-expanded={listed} aria-controls={listed ? list : undefined} aria-autocomplete="list"
          aria-activedescendant={listed && at >= 0 ? `${list}-${at}` : undefined} autoComplete="off" spellCheck={false} enterKeyHint="search"
          onChange={(e) => { setText(e.target.value); setActive(-1); if (answer) reset(); }} onKeyDown={keys} />
      </ComposerLine>
      <div className="pal-body">
        {answer ? (
          <AnswerView answer={answer} waiting="Reading your notes"><Sources cites={answer.cites} notes={all ?? []} onPick={onClose} /></AnswerView>
        ) : listed ? (
          <div role="listbox" id={list} aria-label={term ? 'Notes that match' : 'Recent notes'} className={cn(found.isPlaceholderData && 'is-stale')}>
            <Group label={term ? 'Notes' : 'Recent notes'}>
              {rows.map((n, i) => (
                <Link key={n.id} id={`${list}-${i}`} role="option" aria-selected={i === at} tabIndex={-1} to="/notes/$noteId" params={{ noteId: n.id }}
                  className={cn('pal-row', i === at && 'is-active')} onMouseMove={() => { if (i !== at) setActive(i); }} onClick={onClose}>
                  <NoteLine n={n} term={term} /><Icon name="right" size={16} className="go" />
                </Link>
              ))}
            </Group>
          </div>
        ) : found.isFetching ? (
          <p className="pal-none"><Dots /></p>
        ) : term ? (
          <p className="pal-none"><b>Nothing matches “{term}”.</b>Ask instead, and the answer comes from every note you have.</p>
        ) : all && !all.length ? (
          <p className="pal-none"><b>No notes yet.</b>Notes from your calls and recordings show up here, and you can ask about them.</p>
        ) : null}
      </div>
      <div className="pal-foot">
        <span className="hint is-sealed"><Icon name="sealed" size={15} /><span>Answers come from your notes only, in confidential compute.</span></span>
        <Button variant="primary" icon="ask" kb="↵" disabled={!ready} loading={asking} onClick={submit}>Ask</Button>
      </div>
    </>
  );
}

/** Where an answer comes from: each note it cites, once, with its moments in order. A note that's gone isn't shown. */
function Sources({ cites, notes, onPick }: { cites: Cite[]; notes: NoteSummary[]; onPick: () => void }) {
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
    <div className="pal-src">
      <div className="pal-grp">From your notes</div>
      <ul>
        {rows.map(({ note, at }) => {
          /* A cite at 0:00 is the note as a whole: it opens at the start, without a moment of its own. */
          const moments = at.filter((s) => s > 0).sort((a, b) => a - b);
          return (
            <li key={note.id} className="pal-cite">
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

/** Pick notes to pin, or unpin them: they stay in the side panel in the order they were pinned. */
function PinNotes({ onClose }: { onClose: () => void }) {
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
  const term = useSettled(text.trim(), 160);
  const found = useQuery(q.notes(undefined, term || undefined));
  const first = term ? [] : before.flatMap((id) => all?.filter((n) => n.id === id) ?? []);
  const rest = term ? (found.data ?? []).slice(0, FOUND) : (all ?? []).filter((n) => !before.includes(n.id)).slice(0, RECENT);
  const rows = [...first, ...rest];
  const at = Math.max(0, Math.min(active, rows.length - 1));
  const full = pinned.length >= MAX_PINS;

  const toggle = (n: NoteSummary) => {
    const on = !pinned.includes(n.id);
    if (pins.isPending || (on && full)) return;
    // Its own promise, so the error is shown even when another save of preferences is queued behind it.
    pins.mutateAsync(on ? [...pinned, n.id] : pinned.filter((id) => id !== n.id)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(rows.length - 1, at + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, at - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const n = rows[at]; if (n) toggle(n); }
  };
  const row = (n: NoteSummary, i: number) => {
    const on = pinned.includes(n.id);
    return (
      <div key={n.id} id={`${list}-${i}`} role="option" aria-selected={on} aria-disabled={!on && full} className={cn('pal-row', i === at && 'is-active', !on && full && 'is-off')}
        onMouseMove={() => { if (i !== at) setActive(i); }} onClick={() => toggle(n)}>
        <NoteLine n={n} term={term} />
        <span className={cn('pal-pin', on && 'is-on')}><span className="pal-act">{on ? 'Unpin' : full ? '' : 'Pin'}</span>{on && <Icon name="pin" size={16} />}</span>
      </div>
    );
  };

  return (
    <>
      <ComposerLine icon="pin" className="pal-line" action={<Kbd className="pal-esc">esc</Kbd>}>
        <input className="text" value={text} placeholder="Find a note to pin" aria-label="Find a note to pin"
          role="combobox" aria-expanded={rows.length > 0} aria-controls={rows.length ? list : undefined} aria-autocomplete="list"
          aria-activedescendant={rows.length ? `${list}-${at}` : undefined} autoComplete="off" spellCheck={false}
          onChange={(e) => { setText(e.target.value); setActive(0); }} onKeyDown={keys} />
      </ComposerLine>
      <div className="pal-body">
        {rows.length ? (
          <div role="listbox" id={list} aria-label="Notes" aria-multiselectable="true" className={cn(found.isPlaceholderData && term && 'is-stale')}>
            {first.length > 0 && <Group label="Pinned">{first.map((n, i) => row(n, i))}</Group>}
            {rest.length > 0 && <Group label={term ? 'Notes' : 'Recent notes'}>{rest.map((n, i) => row(n, first.length + i))}</Group>}
          </div>
        ) : found.isFetching ? (
          <p className="pal-none"><Dots /></p>
        ) : term ? (
          <p className="pal-none"><b>Nothing matches “{term}”.</b>Search looks through titles, summaries and transcripts.</p>
        ) : all && !all.length ? (
          <p className="pal-none"><b>No notes yet.</b>Notes from your calls and recordings show up here, and you can pin them.</p>
        ) : null}
      </div>
      <div className="pal-foot">
        <span className="hint"><Icon name="pin" size={15} /><span>{full ? `${MAX_PINS} pinned, the most there can be. Unpin one to pin another.` : 'Pinned notes stay in the side panel, in the order you pin them.'}</span></span>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
