/*
 * Notes: the sun has just set, and the search sits in the middle of the sky. It finds the words, not just the note: a row
 * quotes the line and who said it, with a chip for each moment. Enter asks every note you have, and the list and the
 * preview follow what the answer cites. Who and what to look through sit under the line: `#with=<address>` narrows the
 * list to someone. On a wide screen the note picked in the list shows beside it; narrower, a note opens on its own page.
 * Before the first notes, Start a call takes the middle.
 */
import { EmailParamSchema, errorCode, errorMessage, searchOf, type NoteFound } from '@alcove/api';
import { Evening } from '@alcove/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import { useAnswer } from '~/features/notes/answer';
import { NoteRefsRow, useNoteRefs } from '~/features/notes/ask-refs';
import { Answered } from '~/features/notes/list/Answered';
import { FirstDay } from '~/features/notes/list/FirstDay';
import { Nothing } from '~/features/notes/list/Nothing';
import { citedLine, peopleIn, type Said } from '~/features/notes/list/parts';
import { Preview } from '~/features/notes/list/Preview';
import { Row } from '~/features/notes/list/Row';
import { SearchLine, ShowTabs, WithPeople, type Show } from '~/features/notes/list/Sky';
import { useSettled } from '~/lib/live';
import { byEmail, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';
import { noteGroup } from '~/lib/time';
import { plural } from '~/lib/words';

export const Route = createFileRoute('/_app/notes/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(q.notes()),
  component: Notes
});

/** The most of what's typed that a search looks at: a question can be longer. */
const SEARCHED = 200;

/**
 * The person after `#with=` in the address (the hash never leaves the browser, so their address never reaches a
 * server's logs), when it's an email address; anything else means no one. The address arrives as
 * encodeURIComponent wrote it, and the router leaves `%40` as it is.
 */
function withOf(hash: string): string | undefined {
  const raw = /^with=(.+)$/.exec(hash)?.[1];
  const email = EmailParamSchema.safeParse(raw?.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  return email.success ? email.data : undefined;
}

/** The preview sits beside the list from 1241px; narrower, the list is alone and a note opens on its own page. */
const WIDE = '(min-width: 1241px)';
const onWide = (changed: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener('change', changed);
  return () => m.removeEventListener('change', changed);
};
const useWide = () => useSyncExternalStore(onWide, () => matchMedia(WIDE).matches, () => true);

function Notes() {
  const all = useQuery(q.notes()).data ?? [];
  const me = useQuery(q.session()).data?.user;
  return all.length ? <Library all={all} me={me?.email} /> : <FirstDay me={me} />;
}

function Library({ all, me }: { all: NoteFound[]; me: string | undefined }) {
  const navigate = useNavigate();
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<string | null>(null);
  /* The question whose answer wasn't shown, because a note it read went while it was written. */
  const [lost, setLost] = useState<string | null>(null);
  const refused = useCallback((e: unknown, question: string) => {
    if (errorCode(e) !== 'conflict') return false;
    setLost(question);
    return true;
  }, []);
  const refs = useNoteRefs();
  const { answer, ask, reset } = useAnswer(refs.ask, refused);
  const term = useSettled(text.trim(), 160).slice(0, SEARCHED);
  const search = searchOf(term);
  const who = withOf(useRouterState({ select: (s) => s.location.hash }));
  const kind = show === 'call' || show === 'room' ? show : undefined;
  const searched = useQuery(q.notes(kind, term || undefined));
  const found = searched.data ?? [];
  const plain = useQuery(q.notes(kind)).data ?? [];
  const inbox = useQuery(q.inbox()).data;
  const pinned = useQuery(q.prefs()).data?.pinned ?? [];
  const known = peopleIn(all, me);
  const inNotes = who ? known.find((k) => sameEmail(k.person, { email: who }))?.person : undefined;
  const team = useQuery({ ...q.team(), enabled: !!who && !inNotes }).data;
  const person = who ? inNotes ?? team?.members.find((m) => sameEmail(m.person, { email: who }))?.person ?? byEmail(who) : undefined;

  /* An answer takes over the list: a question goes across every note, so what it cites shows whatever the filters were. */
  const cites = answer?.done ? answer.cites.flatMap((c) => (c.type === 'cite' ? [c] : [])) : [];
  const cited = all.filter((n) => cites.some((c) => c.noteId === n.id));
  const read = useQueries({ queries: cited.map((n) => ({ ...q.note(n.id), retry: false })) });
  /** What an answer cites in a note, in the order it uses it. A cite at 0:00 is the note as a whole, without a moment of its own. */
  const citedIn = (n: NoteFound): Said => {
    const note = read.find((r) => r.data?.id === n.id)?.data;
    const lines = [...new Set(cites.filter((c) => c.noteId === n.id && c.at > 0).map((c) => c.at))].map((at) => citedLine(note, n.id, at));
    return { lines, count: lines.length };
  };

  const shown = (n: NoteFound) => (show !== 'shared' || n.received?.role === 'shared') && (!who || n.people.some((p) => sameEmail(p, { email: who })));
  const matched = found.filter(shown);
  /* While a question is being typed, a list with nothing in it would only be in the way. */
  const list = cited.length ? cited : !matched.length && search.question ? plain.filter(shown) : matched;
  const current = list.find((n) => n.id === picked) ?? list[0];
  const groups = [...new Set(list.map((n) => noteGroup(n.startedAt)))];
  const toConfirm = (id: string) => inbox?.decisions.filter((d) => d.noteId === id).length ?? 0;
  const saidOf = (n: NoteFound): Said => (cited.length ? citedIn(n) : { lines: n.said, count: n.saidCount });
  const narrowed = !!term || show !== 'all' || !!who;

  /* The answer's first note is the one to read first. */
  const firstCited = cites[0]?.noteId;
  useEffect(() => { if (firstCited) setPicked(firstCited); }, [firstCited]);
  /* A different list starts at its top. Coming back to this one, the router puts your place back, so that's left alone. */
  const listed = useRef({ term, show, who, firstCited });
  useEffect(() => {
    const was = listed.current;
    listed.current = { term, show, who, firstCited };
    if (was.term !== term || was.show !== show || was.who !== who || was.firstCited !== firstCited) box.current?.scrollTo({ top: 0 });
  }, [term, show, who, firstCited]);
  /* An empty list says what it's for once the search is answered: until then, the last one that was. */
  const [answered, setAnswered] = useState(term);
  useEffect(() => { if (!searched.isPlaceholderData) setAnswered(term); }, [term, searched.isPlaceholderData]);

  const change = (typed: string) => {
    setText(refs.typed(typed, text));
    setLost(null);
    if (answer) reset();
  };
  const clear = () => change('');
  const putAway = () => { reset(); setLost(null); };
  const asked = !!answer && answer.q === text.trim();
  const run = () => { if (!text.trim() || asked) return; setLost(null); void ask(text); };

  const withSomeone = (email: string | undefined) => void navigate({ to: '/notes', hash: email ? `with=${encodeURIComponent(email)}` : '', hashScrollIntoView: false, resetScroll: false });
  /* Narrowing the list says you want the list again: the answer steps aside. */
  const narrow = (email: string | undefined) => { putAway(); withSomeone(email); };
  /* Taking the person off moves focus to +, where the chip that had it was. */
  const add = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => { if (!who && refocus.current) { refocus.current = false; add.current?.focus(); } }, [who]);
  const anyone = () => { refocus.current = true; narrow(undefined); };

  /* After notes go, focus moves to the note the list settles on. */
  const dropped = useRef(false);
  useEffect(() => {
    if (!dropped.current) return;
    dropped.current = false;
    box.current?.querySelector<HTMLElement>('.nt-row.is-on a')?.focus();
  }, [current?.id]);

  /* On a wide screen a click picks a note for the preview; a double click, Enter, or a click with a modifier opens it, as a link does. */
  const pick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!wide || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.detail !== 1) return;
    e.preventDefault();
    setPicked(id);
  };
  /* The list is one stop for Tab: arrows, Home and End move through it, and the preview follows. */
  const focusRow = (id: string | undefined) => { if (id) box.current?.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"] a`)?.focus(); };
  const move = (e: KeyboardEvent<HTMLAnchorElement>, id: string) => {
    if (!wide) return;
    const ids = list.map((n) => n.id);
    const i = ids.indexOf(id);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to < 0) { line.current?.focus(); return; }
    const next = ids[Math.min(ids.length - 1, to)];
    if (!next) return;
    setPicked(next);
    focusRow(next);
  };

  return (
    <Evening moment="notes" className="nt" data-asking={(!!answer && !answer.done) || undefined}>
      <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Notes</h1></header>
      <section className="nt-sky" aria-label="Find what was said" style={{ '--d': 1 }}>
        <SearchLine line={line} text={text} asked={asked} asking={!!answer && !answer.done} onText={change} onClear={clear} onAsk={run} onDown={() => focusRow(current?.id)} />
        <NoteRefsRow refs={refs} className="nt-refs" onBack={() => { if (answer) reset(); line.current?.focus(); }} />
        <WithPeople known={known} person={person} add={add} onPick={(email) => (email ? narrow(email) : anyone())} />
        <ShowTabs show={show} onShow={(s) => { putAway(); setShow(s); }} />
      </section>
      <p className="sr-only" role="status">{narrowed ? plural(list.length, 'note') : ''}</p>
      <div className="nt-water" style={{ '--d': 2 }}>
        {(answer || lost) && <Answered answer={answer} lost={lost} notes={all} me={me} saidOf={citedIn} onClose={putAway} onAgain={() => { if (lost) { setLost(null); void ask(lost); } }} onPick={pick} />}
        {list.length ? (
          <div className="nt-split">
            <div ref={box} className="nt-list" role="group" aria-label={person ? `Notes with ${person.name}` : 'Notes'} data-scroll-restoration-id="notes-list">
              {groups.map((g) => (
                <div key={g} className="nt-g">
                  <h2 className="nt-gh">{g}</h2>
                  {list.filter((n) => noteGroup(n.startedAt) === g).map((n) => (
                    <Row key={n.id} n={n} me={me} terms={search.terms} said={saidOf(n)} cited={cited.length > 0} toConfirm={toConfirm(n.id)} pinned={pinned.includes(n.id)} on={wide && n.id === current?.id} wide={wide} onPick={pick} onMove={move} />
                  ))}
                </div>
              ))}
            </div>
            {wide && current && <Preview key={current.id} s={current} me={me} terms={search.terms} said={saidOf(current)} onDropped={() => { dropped.current = true; }} />}
          </div>
        ) : <Nothing term={searched.isPlaceholderData ? answered : term} show={show} person={person} failed={searched.isError ? errorMessage(searched.error) : undefined} onRetry={() => void searched.refetch()} onClear={clear} onAll={() => { setShow('all'); if (who) anyone(); }} onAnyone={anyone} />}
      </div>
    </Evening>
  );
}
