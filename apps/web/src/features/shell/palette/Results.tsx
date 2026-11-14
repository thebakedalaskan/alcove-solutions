/*
 * The palette's list (rows.ts says what's in it): before anything's typed, the people to pick and your recent notes;
 * then Ask, the people whose names have the words, what was said call by call, the notes, and See all; or, with nothing
 * to list, what to say instead. Each row is its own element with the kit's row inside: a link for a moment or a note,
 * which opens it there and closes the palette, or an option the palette acts on (Ask, someone, more, See all).
 */
import {
  Button, EmptyState, Icon, PaletteAllLine, PaletteAskLine, PaletteCallHead, PaletteGroup, PaletteMomentLine, PaletteMoreLine, PaletteNoteLine, PalettePeople, PalettePersonLine,
  PaletteWaiting, buttonClass, cn, coverFor, paletteRow, type IconName
} from '@alcove/ui';
import type { NoteFound, Person } from '@alcove/api';
import { Link } from '@tanstack/react-router';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { marked, nearMatch } from '~/features/notes/highlight';
import { noteLine } from '~/features/notes/meta';
import { inNote } from '~/features/notes/parts';
import { callName, spokenName } from '~/lib/people';
import { noteDay, position } from '~/lib/time';
import { together, type Listed, type Row, type Section } from './rows';

/* A moment's words have two lines: a line is cut to start a little before what matched only when that's further in than this. */
const LONG = 64;
const LEAD = 28;

/** How a list of rows is drawn and what its rows do. The arrays and handlers stay the same objects while the lit row moves. */
export interface RowsProps {
  /** The ID of a row's element: the line points at the lit one (aria-activedescendant). */
  idOf: (row: Row) => string;
  /** The lit row's key. */
  lit: string | undefined;
  /** The words searched for, marked in what was said and in titles. */
  terms: string[];
  /** The words typed, marked in the names they start. */
  words: string[];
  me: string | undefined;
  /** The pointer moved onto a row. */
  onLight: (key: string) => void;
  /** A row the palette acts on was pressed: Ask, someone, more or See all. */
  onGo: (row: Row) => void;
  /** A moment or a note was opened from its link: the palette closes. */
  onOpen: () => void;
}

/** Who said a line, as Notes says it: "You", their first name, or where it was said when nobody can tell. */
const saidBy = (row: Extract<Row, { kind: 'moment' }>, me: string | undefined): string =>
  (row.line.speaker ? spokenName(row.line.speaker, me) : row.note.kind === 'room' ? 'In the room' : 'Someone');

/* A press keeps the caret in the line: the row is lit, and the keys go on working. */
const keepCaret = (e: MouseEvent<HTMLElement>) => e.preventDefault();

/** A row: memoised, so moving the lit row renders the two rows it moves between, not the whole list. */
const Option = memo(function Option({ row, id, active, terms, words, me, onLight, onGo, onOpen }: Omit<RowsProps, 'idOf' | 'lit'> & {
  row: Row;
  /** Its element's ID, which the line points at while it's lit. */
  id: string;
  active: boolean;
}) {
  const own = {
    id, role: 'option', 'aria-selected': active, className: paletteRow(row.kind, active), onMouseDown: keepCaret,
    onMouseMove: () => { if (!active) onLight(row.key); }
  };
  /* A link followed in this tab closes the palette; one opened in another tab leaves it as it is. */
  const followed = (e: MouseEvent<HTMLAnchorElement>) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onOpen(); };
  switch (row.kind) {
    case 'moment': {
      const { note, line } = row;
      const speaker = line.speaker ? line.speaker.person ?? { name: line.speaker.name } : undefined;
      return (
        <Link {...own} tabIndex={-1} to="/calls/$noteId" params={{ noteId: note.id }} {...inNote(line.at, line.room)} onClick={followed}>
          <PaletteMomentLine person={speaker} name={marked(saidBy(row, me), terms, true)} made={line.made} time={position(line.at)}>
            {marked(nearMatch(line.text, terms, LONG, LEAD), terms)}
          </PaletteMomentLine>
          <span className="sr-only">{`, in ${note.title}${line.room ? `, ${line.room.name}` : ''}, ${noteDay(note.startedAt)}`}</span>
        </Link>
      );
    }
    case 'note':
      return (
        <Link {...own} tabIndex={-1} to="/calls/$noteId" params={{ noteId: row.note.id }} onClick={followed}>
          <PaletteNoteLine cover={coverFor(row.note.id)} room={row.note.kind === 'room'} title={marked(row.note.title, terms)} meta={noteLine(row.note)} />
        </Link>
      );
    case 'ask':
      return <div {...own} onClick={() => onGo(row)}><PaletteAskLine text={row.text} keyLabel={active ? '↵' : 'Tab'} /></div>;
    case 'person': {
      const { someone } = row;
      return (
        <div {...own} onClick={() => onGo(row)}>
          <PalettePersonLine person={someone.person} name={marked(someone.person.name, words, true)} meta={[...(someone.title ? [someone.title] : []), together(someone)].join(' · ')} />
        </div>
      );
    }
    case 'more':
      return <div {...own} onClick={() => onGo(row)}><PaletteMoreLine>{row.count} more in {row.note.title}</PaletteMoreLine></div>;
    case 'all':
      return <div {...own} onClick={() => onGo(row)}><PaletteAllLine>{row.label}</PaletteAllLine></div>;
  }
});

/** A call's head over its moments, memoised with the rows: nothing about it changes as the lit row moves. */
const Head = memo(function Head({ note }: { note: NoteFound }) {
  return <PaletteCallHead cover={coverFor(note.id)} room={note.kind === 'room'} title={note.title} meta={noteDay(note.startedAt)} />;
});

/** Rows on their own, and groups of them with a label, the calls in What was said each under its head. */
export function Sections({ sections, idOf, lit, ...rows }: RowsProps & { sections: Section[] }) {
  const option = (row: Row) => <Option key={row.key} row={row} id={idOf(row)} active={row.key === lit} {...rows} />;
  return (
    <>
      {sections.map((s) => (s.kind === 'row' ? option(s.row) : (
        <PaletteGroup key={s.key} label={s.label} count={s.count}>
          {s.parts.map((part) => (part.kind === 'head' ? <Head key={part.key} note={part.note} /> : option(part)))}
        </PaletteGroup>
      )))}
    </>
  );
}

/**
 * Nothing to list, as the palette says it: the kit's empty state, its art a dashed arch around the icon of what would be
 * there (palette/palette.css sizes it for the window). `caution` for a search that didn't go through.
 */
export function Nothing({ icon, caution = false, title, action, children }: { icon: IconName; caution?: boolean | undefined; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <EmptyState className={cn('pal-none', caution && 'is-caution')} art={<span className="pal-none-arch" aria-hidden="true"><Icon name={icon} size={22} /></span>} title={title} action={action}>
      {children}
    </EmptyState>
  );
}

/** What the listbox is called, for what it lists. */
const listName = (listed: Listed): string => (listed.state === 'idle' ? 'Recent notes' : listed.whose ? `What ${listed.whose} said` : 'What was found');

export function Results({ listed, listId, stale, typed, token, notes, onPick, onRetry, ...rows }: RowsProps & {
  listed: Listed;
  /** The listbox's ID, which the line controls. */
  listId: string;
  /** The search for what's typed now hasn't answered: the list is the last one, dimmed. */
  stale: boolean;
  /** What's in the line. */
  typed: string;
  /** Who the search is narrowed to, in the line: only what they said is searched. */
  token: Person | undefined;
  /** How many notes you have, all of which a search looks through. */
  notes: number;
  /** Someone was picked from the arches: what they said. */
  onPick: (person: Person) => void;
  /** Try the search again, after it didn't go through. */
  onRetry: () => void;
}) {
  const { state, pick, sections } = listed;
  const whose = token ? callName(token) : undefined;
  return (
    <>
      {pick.length > 0 && <PalettePeople label="People" people={pick.map((s) => ({ person: s.person, first: callName(s.person), onPick: () => onPick(s.person) }))} />}
      {sections.length > 0 && (
        <div role="listbox" id={listId} aria-label={listName(listed)} aria-busy={stale || undefined} className={cn(stale && 'is-stale')}>
          <Sections sections={sections} {...rows} />
        </div>
      )}
      {state === 'loading' && <PaletteWaiting label="Searching" />}
      {state === 'none' && (
        <Nothing icon="search" title={`Nothing matches “${typed.trim()}”`}>
          {whose ? `Search looked through everything ${whose} said in your notes.`
            : `Search looked through the names, titles, summaries, decisions, follow-ups and everything said in ${notes === 1 ? 'your one note' : `all ${notes} of your notes`}.`}
        </Nothing>
      )}
      {state === 'unsaid' && token && whose && (
        <Nothing icon="quote" title={`Nothing ${whose} said is in your notes`}
          action={<Link to="/calls" hash={`with=${encodeURIComponent(token.email)}`} hashScrollIntoView={false} className={buttonClass({ variant: 'quiet', size: 'sm' })} onClick={rows.onOpen}>Calls with {whose}</Link>}>
          Calls with {whose} lists the calls you’re both on.
        </Nothing>
      )}
      {state === 'failed' && (
        <Nothing icon="alert" caution title="The search didn’t go through" action={<Button size="sm" icon="retry" onClick={onRetry}>Try again</Button>}>
          Try again, or ask instead.
        </Nothing>
      )}
      {state === 'first' && (
        <Nothing icon="mic" title="Nothing to search yet">After your first call with notes on, everything said in it can be found here: who said it, and when.</Nothing>
      )}
      {state === 'offline' && (
        <Nothing icon="wifiOff" title="You’re offline">Search needs a connection. It works again as soon as you’re back.</Nothing>
      )}
    </>
  );
}
