/*
 * The palette: one window over the page, to search everything said in your notes and to ask them. ⌘K (Ctrl+K), though
 * not where a page keeps it for its own search, Search or ask at the top of every page and the phone's search button open
 * it, and ⌘K closes it again. It's the only thing open while it's open, and closing it puts focus back where it was.
 *
 * Find keeps what's typed, someone's token and the lit row. palette/rows.ts works out the list from them,
 * palette/Results.tsx draws it, palette/Preview.tsx shows the lit row beside it from 1100px, and palette/Answered.tsx puts
 * an answer in its place. ↑ and ↓ light a row (so does the pointer), Enter does it, Tab asks about what's typed, Backspace
 * on an empty line takes the token off, and Escape closes it (from an answer, it goes back to the results first). Pin a
 * note opens the same window, narrow, to pick notes to pin (palette/PinNotes.tsx).
 *
 * The words searched for and whose lines go in the search's request body: never in an address, and never in a log line.
 */
import { MAX_QUESTION, MAX_SEARCH_TEXT, searchOf, type AnswerPart, type Note, type NoteFound, type Person } from '@alcove/api';
import { PaletteBody, PaletteFoot, PaletteLine, PaletteToken, Sheet, Unencrypted, type PaletteKeys } from '@alcove/ui';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useAnswer, type Cite } from '~/features/notes/answer';
import { inNote } from '~/features/notes/parts';
import { NoNotesLeftDoor, useAskRanOut } from '~/features/plans/notesDoors';
import { api } from '~/lib/api';
import { isUnencrypted, useAiModels } from '~/features/notes/models';
import { useMedia, useOnline, useSettled } from '~/lib/live';
import { callName } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { isNoteSearch, noteQueries } from '~/features/notes/queries';
import { teamQueries } from '~/features/team/queries';
import { Answered } from './palette/Answered';
import { keepInView } from './palette/keepInView';
import { PinNotes } from './palette/PinNotes';
import { Asking, Preview } from './palette/Preview';
import { Results } from './palette/Results';
import { citedOf, listOf, searchFor, type Row } from './palette/rows';
import { peopleOf } from '~/features/team/data';

const askAll = (question: string): AsyncIterable<AnswerPart> => api.notes.askAll(question);
/** From this width the lit row's preview sits beside the list (palette/palette.css); narrower, the list is alone. */
const WIDE = '(min-width: 1101px)';
/** A phone, where the window takes the screen and the line has room for fewer words. */
const PHONE = '(max-width: 860px)';
/** What Enter does on the lit row, as the foot says it. */
const ENTER: Record<Row['kind'], string> = { ask: 'Ask', person: 'Pick', moment: 'Open', note: 'Open', more: 'Show', all: 'See all' };

/**
 * What the line says before anything's typed. A phone's line has room for fewer words, and beside someone's token for
 * fewer still: the list under it says whose words they are.
 */
const placeholder = (token: Person | undefined, phone: boolean): string =>
  (token ? (phone ? 'Search' : `Search what ${callName(token)} said`) : phone ? 'Search what was said, or ask' : 'Search everything said, or ask a question');

/** What a search finds when there's nothing to ask it. */
const NOTHING_FOUND: NoteFound[] = [];
/** What an answer cites before it cites anything, and the words an answer's rows mark in names (none). */
const NO_CITES: Cite[] = [];
const NO_WORDS: string[] = [];
/** The notes an answer cites, as they're read: by ID, and whether any is still on its way. */
const readOf = (results: UseQueryResult<Note>[]): { read: ReadonlyMap<string, Note>; pending: boolean } => ({
  read: new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data] as const] : []))),
  pending: results.some((r) => r.isPending)
});

/** What Escape does inside the window before it closes it, if anything: true when it did something. */
type Escape = () => boolean;

/**
 * Where Pin a note leaves focus when the pin that opened it has gone, as it does with the last note unpinned (Pinned goes
 * with it): the side panel's place you're on.
 */
const toPanelPlace = (): boolean => {
  const here = document.querySelector('aside.sb a[aria-current="page"]');
  if (!(here instanceof HTMLElement)) return false;
  here.focus({ preventScroll: true });
  return true;
};

/** What the palette opens for: finding a note or asking your notes, or picking notes to pin. */
export type PaletteStart = { mode: 'find' } | { mode: 'pin' };

export function Palette({ open, onOpenChange, start }: { open: boolean; onOpenChange: (open: boolean) => void; start: PaletteStart }) {
  const close = () => onOpenChange(false);
  /* Escape is the window's: it closes it, unless what's in it goes back a step first (an answer, to its results). */
  const back = useRef<Escape | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={start.mode === 'pin' ? 'Pin a note' : 'Search or ask'} className="pal" overlayClassName="pal-scrim"
      onEscapeKeyDown={(e) => { if (back.current?.()) e.preventDefault(); }} onCloseFocus={start.mode === 'pin' ? toPanelPlace : undefined}>
      {start.mode === 'pin' ? <PinNotes onClose={close} /> : <Find onClose={close} back={back} />}
    </Sheet>
  );
}

/** Search everything said, or ask every note you have. `back` is where it says what Escape does first. */
function Find({ onClose, back }: { onClose: () => void; back: RefObject<Escape | null> }) {
  const navigate = useNavigate();
  const list = useId();
  const line = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [token, setToken] = useState<Person | undefined>(undefined);
  /** Calls whose other moments were opened in place (More). */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** The row the keys or the pointer lit, by its key, and whether the keys did; null while the list's own first choice is lit. */
  const [chosen, setChosen] = useState<{ key: string; byKeys: boolean } | null>(null);
  /** The keys moved the lit row, so the list keeps it in view; the pointer lights only what's in view already. */
  const keyed = useRef(false);
  /* Asking with no notes left this period: the door to more, in the answer's place. */
  const ranOut = useAskRanOut();
  const { answer, ask: run, reset } = useAnswer(askAll, ranOut.refused);
  const online = useOnline();
  const wide = useMedia(WIDE);
  const phone = useMedia(PHONE);
  const me = useQuery(accountQueries.session()).data?.user.email;
  const notes = useQuery(noteQueries.notes()).data;
  const team = useQuery(teamQueries.team()).data;
  const inbox = useQuery(noteQueries.inbox()).data;
  const models = useAiModels();
  const outside = isUnencrypted(models.data, useQuery(accountQueries.prefs()).data?.model ?? null);
  const people = useMemo(() => peopleOf(notes ?? [], team, me), [notes, team, me]);

  const typed = text.trim();
  /* The search waits for a pause in typing. With nothing typed (someone's token alone) there's nothing to wait for. */
  const settled = useSettled(text, 160);
  const searched = typed ? settled : '';
  /* What's typed now asks for, and what the list's search asked for once typing paused: they differ until it pauses. */
  const now = searchFor(text, token);
  const wanted = searchFor(searched, token);
  const search = useQuery({
    ...noteQueries.notes(undefined, wanted?.text, wanted?.by),
    enabled: !!wanted && online,
    /* While the next search is on its way, the last search's list stays, dimmed: never the whole list of notes. */
    placeholderData: (prev, last) => (last && isNoteSearch(last.queryKey) ? prev : undefined)
  });
  /*
   * Until the search for what's typed now has answered, the last search's list stays, dimmed, or there are dots when there's
   * none to keep: never "Nothing matches" for words that haven't been searched. Nothing to ask for (under two letters, or
   * a question of small words alone) has nothing to wait for.
   */
  const answered = !!now && !!wanted && now.text === wanted.text && now.by === wanted.by && !search.isPlaceholderData;
  const kept = !answered && !!wanted && !!search.data?.length;
  const found = !now ? NOTHING_FOUND : answered || kept ? search.data : undefined;
  const failed = answered && search.isError;

  /* An answer cites moments in notes: each note is read for the lines it cites. */
  const cites = answer?.cites ?? NO_CITES;
  const citedIds = [...new Set(cites.flatMap((c) => (c.type === 'cite' ? [c.noteId] : [])))];
  const reads = useQueries({ queries: citedIds.map((id) => ({ ...noteQueries.note(id), retry: false })), combine: readOf });
  /*
   * The list and an answer's rows are worked out again only when what they come from changes: not as the lit row moves,
   * nor as an answer's words arrive, so the rows (memoised in Results.tsx) stay the same objects.
   */
  const question = answer?.q;
  const cited = useMemo(() => (question === undefined ? undefined : citedOf(cites, notes ?? NOTHING_FOUND, reads.read, question)), [question, cites, notes, reads.read]);
  const listed = useMemo(() => listOf({ typed: text, searched, token, notes, people, found, opened, offline: !online, failed }), [text, searched, token, notes, people, found, opened, online, failed]);
  const words = useMemo(() => searchOf(typed).terms, [typed]);
  const rows = cited ? cited.rows : listed.rows;
  const lit = rows.find((r) => r.key === chosen?.key) ?? rows.find((r) => r.key === (cited ? cited.lit : listed.lit));
  const ids = useMemo(() => new Map(rows.map((r, i) => [r.key, `${list}-${i}`])), [rows, list]);
  const idOf = (r: Row) => ids.get(r.key) ?? list;
  const answering = answer !== null;

  /** A different list: the lit row is its own first choice again, and every call shows its first moments. */
  const fresh = () => { setChosen(null); setOpened(new Set()); };
  const toResults = useCallback(() => { reset(); ranOut.clear(); setChosen(null); }, [reset, ranOut.clear]);
  const ask = () => {
    if (!typed || !online) return;
    setChosen(null);
    ranOut.clear();
    void run(typed);
  };
  const pick = (person: Person) => {
    setToken(person);
    setText('');
    fresh();
    if (answering) reset();
    line.current?.focus();
  };
  const unpick = () => { setToken(undefined); fresh(); line.current?.focus(); };
  const light = (key: string, byKeys: boolean) => {
    if (key === lit?.key) return;
    keyed.current = byKeys;
    setChosen({ key, byKeys });
  };
  const seeAll = () => {
    onClose();
    // The words searched go in history state and the person after #with=: neither reaches a server. Notes reads the words once.
    void navigate({ to: '/calls', hashScrollIntoView: false, ...(token ? { hash: `with=${encodeURIComponent(token.email)}` } : {}), ...(typed ? { state: { searched: typed.slice(0, MAX_SEARCH_TEXT) } } : {}) });
  };
  const go = (row: Row) => {
    switch (row.kind) {
      case 'ask': ask(); return;
      case 'person': pick(row.someone.person); return;
      case 'moment':
        onClose();
        void navigate({ to: '/calls/$noteId', params: { noteId: row.note.id }, ...inNote(row.line.at, row.line.room) });
        return;
      case 'note':
        onClose();
        void navigate({ to: '/calls/$noteId', params: { noteId: row.note.id } });
        return;
      case 'more':
        setOpened((o) => new Set(o).add(row.note.id));
        light(row.reveal, true);
        return;
      case 'all': seeAll(); return;
    }
  };
  /* What the rows call goes through `latest`, so their handlers stay the same as the lit row moves and only two rows render again. */
  const latest = useRef({ go, light, onClose });
  latest.current = { go, light, onClose };
  const onGo = useCallback((row: Row) => latest.current.go(row), []);
  const onLight = useCallback((key: string) => latest.current.light(key, false), []);
  const onOpen = useCallback(() => latest.current.onClose(), []);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const at = lit ? rows.indexOf(lit) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)];
      if (next) light(next.key, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (lit) go(lit);
    } else if (e.key === 'Tab' && !e.shiftKey && typed && !answering && online && !!notes?.length) {
      e.preventDefault();
      ask();
    } else if (e.key === 'Backspace' && token && !text) {
      e.preventDefault();
      unpick();
    }
  };

  /* Escape goes from an answer back to the results before it closes the window. */
  useEffect(() => {
    back.current = answering ? () => { toResults(); return true; } : null;
    return () => { back.current = null; };
  }, [back, answering, toResults]);

  /* The lit row stays in view as the keys move it, inside the list. */
  const litId = lit ? idOf(lit) : undefined;
  const litFirst = !!lit && rows[0]?.key === lit.key;
  useEffect(() => {
    if (!keyed.current || !litId) return;
    keyed.current = false;
    const el = document.getElementById(litId);
    if (el) keepInView(el, litFirst);
  }, [litId, litFirst]);

  const sealed = lit?.kind === 'ask' || answering;
  const toConfirm = (id: string) => inbox?.decisions.filter((d) => d.noteId === id).length ?? 0;
  const rowProps = { idOf, lit: lit?.key, me, onLight, onGo, onOpen };
  /* While an answer is read, and its cited notes after it, the question stays beside it: the window doesn't change size. */
  const preview = !wide ? undefined : lit ? (
    <Preview row={lit} byKeys={chosen?.key === lit.key && chosen.byKeys} me={me} terms={cited ? cited.terms : listed.terms} typed={text} token={token} whose={listed.whose} counts={listed.counts} notes={notes?.length ?? 0}
      toConfirm={toConfirm} onOpen={onClose} onPick={pick} onAsk={ask} onSeeAll={seeAll} onSettled={() => line.current?.focus()} />
  ) : answer && (!answer.done || reads.pending) ? <Asking question={answer.q} notes={notes?.length ?? 0} /> : undefined;
  const footKeys: PaletteKeys[] = [
    ...(rows.length ? [{ keys: ['↑', '↓'], label: 'Move' }] : []),
    ...(lit ? [{ keys: ['↵'], label: lit.kind === 'all' && token ? 'Open' : ENTER[lit.kind] }] : []),
    ...(typed && !answering && lit?.kind !== 'ask' && online && notes?.length ? [{ keys: ['Tab'], label: 'Ask' }] : []),
    { keys: ['esc'], label: answering ? 'Back' : 'Close' }
  ];

  return (
    <>
      <PaletteLine ask={sealed} token={token && <PaletteToken person={token} name={callName(token)} onClear={unpick} clearLabel="Show everyone" />} onCancel={onClose}>
        <input ref={line} className="pal-in" value={text} placeholder={placeholder(token, phone)}
          aria-label="Search or ask your notes, for you alone" role="combobox" aria-expanded={rows.length > 0} aria-controls={rows.length ? list : undefined}
          aria-autocomplete="list" aria-activedescendant={litId} autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={MAX_QUESTION}
          onChange={(e) => { setText(e.target.value); fresh(); ranOut.clear(); if (answering) reset(); }} onKeyDown={keys} />
      </PaletteLine>
      <PaletteBody preview={preview}>
        {ranOut.out && !answer && <NoNotesLeftDoor alone beforeCheckout={onClose} className="pal-door" />}
        {answer && cited
          ? <Answered answer={answer} cited={cited} listId={list} onBack={toResults} terms={cited.terms} words={NO_WORDS} {...rowProps} />
          : <Results listed={listed} listId={list} stale={kept} typed={text} token={token} notes={notes?.length ?? 0} onPick={pick} onRetry={() => void search.refetch()}
              terms={listed.terms} words={words} {...rowProps} />}
      </PaletteBody>
      <PaletteFoot sealed={sealed} outside={sealed && outside} keys={footKeys}>
        {!sealed ? 'Only you can see what you search.'
          : outside ? <>Answers come from your notes only, written by an AI model outside a secure enclave. <Unencrypted compact /></>
            : 'Answers are written in confidential compute, from your notes only.'}
      </PaletteFoot>
    </>
  );
}
