/*
 * The Transcript tab of a call's page: find in it, download it, and what was said chapter by chapter, the line being said lit
 * as the call plays and kept in sight while it does (until you scroll it yourself). From the start goes back to the top. At
 * the breakout rooms it says which room you were in and with whom, and names the others, each of which shows its own lines in
 * place: a room's talk isn't in the recording, so its lines have no moment to play. Pressing a line plays from it; its tools
 * correct it, bookmark it for you alone, or start a decision or a follow-up from it.
 */
import type { Note, NoteRoom, TranscriptLine } from '@alcove/api';
import { EmptyState, Icon, IconButton, UnsureKey, cn } from '@alcove/ui';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { listNames, sameEmail } from '~/lib/people';
import { position } from '~/lib/time';
import type { Correcting, FromLine, LineMarks } from './lines';
import { TranscriptLines, type Focus, type LineKinds, type ScreensShown } from './parts';
import { usePlayerAt, type PlayerState } from './Player';

/** How long after someone scrolls the transcript it leaves them where they are, rather than follow the line being said. */
const LET_BE_MS = 5000;

/** Whether a line has every word looked for, in what was said or who said it. */
const has = (l: TranscriptLine, words: readonly string[]) => {
  const text = `${l.text} ${l.speaker?.name ?? ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
};

/** The breakout room you were in, if any: the first whose people include you. */
const yourRoom = (rooms: readonly NoteRoom[], me: string | undefined) => rooms.find((r) => !!me && r.people.some((p) => p.person && sameEmail(p.person, { email: me })));

/** At the breakout rooms: which room you were in and with whom, and the others, each to show in its place. */
function Rooms({ note, me, words, correct, fromLine, marks }: { note: Note; me: string | undefined; words: readonly string[]; correct: Correcting | undefined; fromLine: FromLine | undefined; marks: LineMarks | undefined }) {
  const mine = yourRoom(note.rooms, me);
  const [picked, setPicked] = useState<string | null>(null);
  const room = note.rooms.find((r) => r.id === picked) ?? mine ?? note.rooms[0];
  if (!room) return null;
  const with_ = (r: NoteRoom) => r.people.flatMap((p) => (p.person && !(me && sameEmail(p.person, { email: me })) ? [p.person] : []));
  const others = note.rooms.filter((r) => r.id !== room.id);
  const lines = words.length ? room.transcript.filter((l) => has(l, words)) : room.transcript;
  return (
    <div className="cd-rooms-said">
      <p className="cd-roomnote">
        <Icon name="rooms" size={15} />
        <span>{room === mine ? `You were in ${room.name}${with_(room).length ? `, with ${listNames(with_(room))}` : ''}.` : `In ${room.name}${with_(room).length ? `, with ${listNames(with_(room))}` : ''}.`}{others.length > 0 && ' Other rooms:'}</span>
        {others.map((r) => <button key={r.id} type="button" onClick={() => setPicked(r.id)}>{r.name}{with_(r).length ? `, ${listNames(with_(r))}` : ''}</button>)}
        {room !== mine && mine && <button type="button" onClick={() => setPicked(mine.id)}>Back to {mine.name}</button>}
      </p>
      {lines.length > 0 ? <TranscriptLines lines={lines} gaps={words.length ? [] : room.gaps} me={me} correct={correct} fromLine={fromLine} marks={marks} className="is-room" />
        : <p className="cd-quiet">{words.length ? `Nothing said in ${room.name} has those words.` : `Nothing was said in ${room.name} while notes were on.`}</p>}
    </div>
  );
}

export interface TranscriptPaneProps {
  note: Note;
  me: string | undefined;
  player: PlayerState;
  here: number;
  /** Goes to a line's moment, playing from it when there's a recording. */
  onSeek: ((s: number, play?: boolean) => void) | undefined;
  /** Where the page last went: the transcript goes to the line said then. */
  focus: Focus | undefined;
  /** The scroll area the tab is in, which the line being said is kept in sight of. */
  pane: RefObject<HTMLDivElement | null>;
  screens: ScreensShown | undefined;
  correct: Correcting | undefined;
  fromLine: FromLine | undefined;
  marks: LineMarks | undefined;
  kinds: LineKinds;
  onDownload: (() => void) | undefined;
}

export function TranscriptPane({ note, me, player, here, onSeek, focus, pane, screens, correct, fromLine, marks, kinds, onDownload }: TranscriptPaneProps) {
  const [find, setFind] = useState('');
  const words = useMemo(() => find.toLowerCase().split(/\s+/).filter(Boolean), [find]);
  const lines = useMemo(() => note.transcript ?? [], [note.transcript]);
  const plays = player.total > 0;
  const heard = usePlayerAt(player, (p) => Math.floor(p * 2) / 2);
  const at = plays ? heard : here;
  const lit = plays ? (heard > 0 ? lines.findLast((l) => l.at <= at + 0.5)?.id : undefined) : focus ? lines.findLast((l) => l.at <= focus.at + 0.5)?.id : undefined;
  /* The chapters, each with the lines said in it, and the breakout rooms where they were. */
  const chapters = note.chapters.length ? note.chapters : [{ at: 0, title: '', summary: '' }];
  const roomsAt = note.rooms.length ? Math.min(...note.rooms.map((r) => r.from)) : null;
  const roomsGroup = roomsAt === null ? -1 : Math.max(0, chapters.findLastIndex((c) => c.at <= roomsAt + 2));
  const groups = chapters.map((c, i) => {
    const next = chapters[i + 1]?.at ?? Infinity;
    const said = lines.filter((l) => l.at >= c.at && l.at < next);
    return { c, said: words.length ? said.filter((l) => has(l, words)) : said, from: c.at, to: next };
  });
  // The chapter the moment gone to is in: only its lines say which line that is.
  const focusGroup = focus ? groups.findLastIndex((g) => g.from <= focus.at + 0.5) : -1;
  const found = words.length ? groups.reduce((n, g) => n + g.said.length, 0) + note.rooms.reduce((n, r) => n + r.transcript.filter((l) => has(l, words)).length, 0) : null;

  /* Kept in sight as it plays, unless you've scrolled the transcript yourself a moment ago; and From the start, once you're down it. */
  const scrolledAt = useRef(0);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const el = pane.current;
    if (!el) return undefined;
    const mine = () => { scrolledAt.current = Date.now(); };
    const where = () => setDown(el.scrollTop > 240);
    el.addEventListener('wheel', mine, { passive: true });
    el.addEventListener('touchmove', mine, { passive: true });
    el.addEventListener('scroll', where, { passive: true });
    where();
    return () => { el.removeEventListener('wheel', mine); el.removeEventListener('touchmove', mine); el.removeEventListener('scroll', where); };
  }, [pane]);
  const playing = player.playing;
  useEffect(() => {
    const el = pane.current;
    if (!el || !lit || !playing || words.length || Date.now() - scrolledAt.current < LET_BE_MS) return;
    // Only a pane that scrolls by itself follows: in one column the page scrolls, and the stage would go out of sight.
    if (getComputedStyle(el).overflowY === 'visible' || el.scrollHeight <= el.clientHeight) return;
    el.querySelector('.nd-l.is-on')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [lit, playing, words.length, pane]);
  // Going to a moment brings its line into view, wherever the transcript was: it's the one a moment's link lands on.
  useEffect(() => {
    if (focus) pane.current?.querySelector('#moment')?.scrollIntoView({ block: 'center' });
  }, [focus, pane]);

  const unsure = { words: lines.some((l) => l.unsure?.words), speaker: lines.some((l) => l.unsure?.speaker) };
  if (note.status === 'recording') return <EmptyState title="Still recording" art={null} className="cd-empty">What was said shows here once the recording stops.</EmptyState>;
  if (!lines.length && !note.rooms.some((r) => r.transcript.length)) {
    return !note.kept.transcript
      ? <EmptyState title="No transcript" art={null} className="cd-empty">It was deleted after the notes were written, as the call was set to.</EmptyState>
      : <EmptyState title="Nothing was said" art={null} className="cd-empty">Nothing was said while notes were on.</EmptyState>;
  }
  const press = onSeek && ((s: number) => onSeek(s, plays));
  return (
    <div className="cd-said">
      <div className="cd-tools">
        <label className="cd-find">
          <Icon name="search" size={15} />
          <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && find) { e.preventDefault(); setFind(''); } }}
            placeholder="Find in the transcript" aria-label="Find in the transcript" autoComplete="off" />
          {found !== null && <small>{found === 1 ? '1 line' : `${found} lines`}</small>}
          {find && <IconButton icon="x" label="Clear" size={14} onClick={() => setFind('')} />}
        </label>
        {onDownload && <IconButton icon="download" label="Download the transcript" onClick={onDownload} />}
      </div>
      {(unsure.words || unsure.speaker) && <UnsureKey words={unsure.words} speaker={unsure.speaker} className="cd-key" />}
      {down && !words.length && <button type="button" className="cd-start" onClick={() => pane.current?.scrollTo({ top: 0, behavior: 'smooth' })}><Icon name="arrowUp" size={14} />From the start</button>}
      {found === 0 && <p className="cd-quiet">Nothing said has those words.</p>}
      {groups.map((g, i) => {
        const shownLines = g.said;
        const rooms = i === roomsGroup;
        if (!shownLines.length && !rooms) return null;
        return (
          <section key={`${g.from}-${g.c.title}`} className="cd-said-g" aria-label={g.c.title || 'What was said'}>
            {g.c.title && <p className="cd-said-h"><span>{position(g.from)}</span>{g.c.title}</p>}
            {shownLines.length > 0 && (
              <TranscriptLines lines={shownLines} gaps={words.length ? [] : note.gaps.filter((x) => x.at >= g.from && x.at < g.to)} me={me} onSeek={press && ((s) => press(s))} plays={plays}
                focus={i === focusGroup && !words.length ? focus?.at : undefined} lit={lit ? shownLines.findIndex((l) => l.id === lit) : -1} screens={words.length ? undefined : screens && { ...screens, moments: screens.moments.filter((m) => m.at >= g.from && m.at < g.to) }}
                correct={correct} fromLine={fromLine} marks={marks} kinds={kinds} className={cn(lit && shownLines.some((l) => l.id === lit) && 'has-lit')} />
            )}
            {rooms && <Rooms note={note} me={me} words={words} correct={correct} fromLine={fromLine} marks={marks} />}
          </section>
        );
      })}
    </div>
  );
}
