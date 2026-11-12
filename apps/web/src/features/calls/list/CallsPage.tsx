/*
 * Calls: every call, ahead and past, in one place, just after sunset. On the sky, the title, the search and Schedule a call;
 * under the horizon, the places on a rail beside a sheet with what the open place holds. All calls is later today and
 * tomorrow, then the rest coming up behind one link, then the calls that happened by day; Coming up has the calls waiting
 * for a guest to pick a time first, then each day, with the week beside it as another way to see them.
 *
 * The search finds what was said (#273): each call quotes its line, with a chip for each moment, and Enter or Ask asks every
 * call, the answer on the sheet with the calls it read. A name in the line lists the calls with that person, coming up
 * first, and so does someone after `#with=` (the palette's and the Team page's Calls with Maya). See all in the palette hands
 * its words over in history state. None of it reaches the address.
 *
 * Scheduling a call happens here too: while the address says `schedule`, the scheduler takes the rail and the sheet
 * (features/calls/scheduling), and ← Calls goes back to the place that was open.
 */
import { EmailParamSchema, MAX_QUESTION, MAX_SEARCH_TEXT, NoteSearchBodySchema, errorCode, errorMessage, firstName, searchOf, type AnswerPart, type NoteFound, type Person } from '@alcove/api';
import { Avatar, Button, CallRow, CallsGroup, CallsMore, CallsSheet, Evening, IconButton, Segmented, SheetHead, SkyBar, SkySearch } from '@alcove/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { peopleOn } from '~/features/home/day';
import { Scheduling } from '~/features/calls/scheduling/Scheduling';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { useAnswer } from '~/features/notes/answer';
import { peopleOf } from '~/features/shell/palette/rows';
import { api } from '~/lib/api';
import { isUnencrypted } from '~/lib/aiModels';
import { ariaShortcut, overlayOpen, shortcut, withMod } from '~/lib/keys';
import { useNow, useSettled } from '~/lib/live';
import { byEmail, callName, fold, isEmail, sameEmail } from '~/lib/people';
import { q, useAiModels } from '~/lib/queries';
import { plural } from '~/lib/words';
import type { CallsSearch, CallsView } from './address';
import { byDay, isOn, listedAhead, nextLabel, seriesAhead, seriesTag, waitsForTime, whoWithYou, type Ahead } from './ahead';
import { Asked } from './Asked';
import { ConnectLine, FirstDay, NobodysCalls, NothingFound, NothingIn } from './Empty';
import { inTheRoom, pastGroups, sharedWithYou } from './past';
import { Chips, Rail, type Lit } from './Rail';
import { AheadRow, PastRow } from './Rows';
import { SeriesView } from './Series';
import { WeekView } from './Week';

const askAll = (question: string): AsyncIterable<AnswerPart> => api.notes.askAll(question);

/**
 * The person after `#with=` in the address (the hash never leaves the browser, so their address never reaches a server's
 * logs), when it's an email address; anything else means nobody. It arrives as encodeURIComponent wrote it.
 */
function withIn(hash: string): string | undefined {
  const raw = /^with=(.+)$/.exec(hash)?.[1];
  const email = EmailParamSchema.safeParse(raw?.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  return email.success ? email.data : undefined;
}

/** The words See all handed over from the palette, when they're a search's words as its request takes them. */
function handedOf(state: unknown): string {
  const words = NoteSearchBodySchema.shape.text.safeParse(state);
  return words.success ? words.data ?? '' : '';
}

/** Someone the line names: all of what's typed is their name, their first name, or their address. */
function namedIn(typed: string, people: readonly Person[]): Person | undefined {
  const t = fold(typed).trim().replace(/\s+/g, ' ');
  if (t.length < 2 || searchOf(typed).question) return undefined;
  if (isEmail(t)) return people.find((p) => sameEmail(p, { email: t })) ?? byEmail(t);
  return people.find((p) => fold(p.name).trim().replace(/\s+/g, ' ') === t) ?? people.find((p) => fold(firstName(p.name)) === t);
}

/** Calls ahead in All: later today and tomorrow, or with nothing then, the next day that has any. */
const NEAR_DAYS = 1;

export function CallsPage({ search }: { search: CallsSearch }) {
  const navigate = useNavigate();
  const router = useRouter();
  const schedule = useOpenScheduling();
  const now = useNow();
  const me = useQuery(q.session()).data?.user;
  const all = useQuery(q.notes()).data;
  const calls = useQuery(q.upcoming()).data;
  const calendar = useQuery(q.calendar()).data;
  const inbox = useQuery(q.inbox()).data;
  const prefs = useQuery(q.prefs()).data;
  const team = useQuery(q.team()).data;
  const models = useAiModels();
  const sheet = useRef<HTMLElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const notes = all ?? [];
  const pinned = prefs?.pinned ?? [];
  const google = calendar?.source === 'google' && !calendar.needsAccess;
  const connected = google || calendar?.source === 'sample';
  const ahead = listedAhead(calls ?? [], connected ? calendar.events : [], me?.email, now);
  const first = all !== undefined && calls !== undefined && !notes.length && !ahead.length;

  /* The words See all handed over, in history state: in the line as Calls opens, and out of the entry as they're read. */
  const handed = useRouterState({ select: (s) => s.location.state.searched });
  const [text, setText] = useState(() => handedOf(handed));
  useEffect(() => {
    if (handed === undefined) return;
    void navigate({ to: '/calls', search: true, hash: true, state: (s) => ({ ...s, searched: undefined }), replace: true, resetScroll: false, hashScrollIntoView: false });
  }, [handed, navigate]);

  /* Someone the list is narrowed to, after #with=: shown as a token in the line, whose × shows everyone's calls again. */
  const tokenEmail = withIn(useRouterState({ select: (s) => s.location.hash }));
  const people = [...peopleOf(notes, team, me?.email).map((s) => s.person), ...ahead.flatMap((a) => peopleOn(a, me?.email))];
  const token = tokenEmail ? people.find((p) => sameEmail(p, { email: tokenEmail })) ?? byEmail(tokenEmail) : undefined;
  const unpick = () => void navigate({ to: '/calls', search: true, hash: '', hashScrollIntoView: false, resetScroll: false });

  /* A question across every call. One a call it read went from while it was written isn't shown: Ask again. */
  const [lost, setLost] = useState<string | null>(null);
  const refused = useCallback((e: unknown, question: string) => {
    if (errorCode(e) !== 'conflict') return false;
    setLost(question);
    return true;
  }, []);
  const { answer, ask, reset } = useAnswer(askAll, refused);
  const asked = !!answer && answer.q === text.trim();
  const run = () => { if (!text.trim() || asked) return; setLost(null); void ask(text); };
  const putAway = () => { reset(); setLost(null); };
  const change = (typed: string) => { setText(typed); setLost(null); if (answer) reset(); };
  const clear = () => change('');

  /* A search looks at as much of what's typed as the server takes, once typing pauses. */
  const term = useSettled(text.trim(), 160).slice(0, MAX_SEARCH_TEXT);
  const looked = searchOf(term);
  const named = token ? undefined : namedIn(term, people);
  const searching = !!term && !named;
  const searched = useQuery({ ...q.notes(undefined, term || undefined), enabled: searching });
  const found = (searched.data ?? []).filter((n) => !token || n.people.some((p) => sameEmail(p, token)));
  const cites = answer?.done ? answer.cites.flatMap((c) => (c.type === 'cite' ? [c.noteId] : [])) : [];
  const reads = useQueries({ queries: [...new Set(cites)].map((id) => ({ ...q.note(id), retry: false })) });
  const read = (id: string) => reads.find((r) => r.data?.id === id)?.data;

  /* What the sheet shows: an answer, someone's calls, what a search found, a series, or a place. */
  type Mode = { kind: 'asked' } | { kind: 'person'; person: Person } | { kind: 'found' } | { kind: 'series'; id: string } | { kind: 'view'; view: CallsView };
  const mode: Mode = answer || lost ? { kind: 'asked' }
    : named ? { kind: 'person', person: named }
      : searching && (found.length || !looked.question) ? { kind: 'found' }
        : token ? { kind: 'person', person: token }
          : search.series ? { kind: 'series', id: search.series }
            : { kind: 'view', view: search.view ?? 'all' };
  const lit: Lit = mode.kind === 'series' ? { kind: 'series', id: mode.id } : mode.kind === 'view' ? { kind: 'view', view: mode.view } : { kind: 'none' };
  const modeKey = mode.kind === 'view' ? `view:${mode.view}` : mode.kind === 'series' ? `series:${mode.id}` : mode.kind === 'person' ? `person:${mode.person.email}` : mode.kind;
  /* A different place starts at its top. */
  useEffect(() => { sheet.current?.scrollTo({ top: 0 }); }, [modeKey]);
  /* Which week is open, kept while the scheduler is up so ← Calls finds it as it was. */
  const scheduling = !!search.schedule;
  const [week, setWeek] = useState(0);
  useEffect(() => { if (!scheduling && (mode.kind !== 'view' || mode.view !== 'week')) setWeek(0); }, [modeKey, scheduling]);

  /* The line takes ⌘K here, in the capture phase, so the shell doesn't open the palette as well. */
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (!withMod(e) || e.key.toLowerCase() !== 'k' || overlayOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      line.current?.focus();
      line.current?.select();
    };
    addEventListener('keydown', on, { capture: true });
    return () => removeEventListener('keydown', on, { capture: true });
  }, []);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { clear(); e.currentTarget.blur(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sheet.current?.querySelector<HTMLElement>('.cs-link')?.focus(); }
    else if (e.key === 'Backspace' && token && !text) { e.preventDefault(); unpick(); }
  };

  const nowAt = new Date(now);
  const isWeek = mode.kind === 'view' && mode.view === 'week';
  const toggle = (
    <Segmented className="cs-view" label="Show as" value={isWeek ? 'week' : 'list'}
      onChange={(v) => { if ((v === 'week') !== isWeek) void navigate({ to: '/calls', search: { view: v === 'week' ? 'week' : 'soon' } }); }}
      options={[{ value: 'list', label: <span className="cs-vl">List</span>, icon: 'list' }, { value: 'week', label: <span className="cs-vl">Week</span>, icon: 'cal' }]} />
  );
  const row = (a: Ahead) => <AheadRow key={a.id} a={a} me={me?.email} now={now} />;
  const pastRow = (n: NoteFound, extra: { terms?: string[]; quote?: boolean } = {}) => (
    <PastRow key={n.id} n={n} me={me?.email} now={now} inbox={inbox} pinned={pinned.includes(n.id)} terms={extra.terms}
      said={extra.quote ? { lines: n.said, count: n.saidCount } : undefined} />
  );
  const past = (list: readonly NoteFound[], extra: { terms?: string[]; quote?: boolean } = {}) => pastGroups(list, nowAt).map((g) => (
    <CallsGroup key={g.label} label={g.label}>{g.rows.map((n) => pastRow(n, extra))}</CallsGroup>
  ));
  const daysAhead = (list: readonly Ahead[], near = false) => {
    const days = byDay(list, nowAt);
    const shown = near ? (days.some((d) => d.days <= NEAR_DAYS) ? days.filter((d) => d.days <= NEAR_DAYS) : days.slice(0, 1)) : days;
    return { days: shown, count: shown.reduce((n, d) => n + d.rows.length, 0) };
  };
  const connectLine = !connected && calendar !== undefined ? <ConnectLine /> : null;

  const body = ((): ReactNode => {
    switch (mode.kind) {
      case 'asked':
        return <Asked answer={answer} lost={lost} notes={notes} read={read} me={me?.email} now={now} inbox={inbox} pinned={pinned} outside={isUnencrypted(models.data, prefs?.model ?? null)} onClose={putAway} onAgain={() => { if (lost) { setLost(null); void ask(lost); } }} />;
      case 'person': {
        const p = mode.person;
        const theirs = ahead.filter((a) => isOn(a, p));
        const days = byDay(theirs, nowAt);
        const waiting = theirs.filter(waitsForTime);
        const had = notes.filter((n) => n.people.some((x) => sameEmail(x, p)));
        return (
          <>
            <SheetHead title={`Calls with ${callName(p)}`} sub={theirs.length && had.length ? 'Coming up, then the ones you’ve had' : undefined} />
            {!theirs.length && !had.length ? <NobodysCalls person={p} onAll={() => { clear(); if (token) unpick(); }} /> : (
              <>
                {waiting.length > 0 && <CallsGroup label="Waiting for a time" soon>{waiting.map(row)}</CallsGroup>}
                {days.map((d) => <CallsGroup key={d.key} label={d.label} soon>{d.rows.map(row)}</CallsGroup>)}
                {past(had)}
              </>
            )}
          </>
        );
      }
      case 'found': {
        const quoted = found.some((n) => n.said.length);
        const whose = token ? ` with ${callName(token)}` : '';
        return (
          <>
            {(found.length > 0 || token) && <SheetHead title={found.length ? `${quoted ? 'Said in' : 'In'} ${plural(found.length, 'call')}${whose}` : `Calls${whose}`} sub={quoted ? 'Each quotes the line it was said in.' : undefined} />}
            {found.length ? <div className={searched.isPlaceholderData ? 'cs-stale' : undefined}>{past(found, { terms: looked.terms, quote: true })}</div>
              : <NothingFound term={term} failed={searched.isError ? errorMessage(searched.error) : undefined} onClear={() => { clear(); line.current?.focus(); }} onRetry={() => void searched.refetch()} />}
          </>
        );
      }
      case 'series': {
        const next = ahead.find((a) => (a.kind === 'call' ? a.call.seriesId : a.event.seriesId) === mode.id);
        return <SeriesView id={mode.id} next={next} notes={notes} inbox={inbox} pinned={pinned} me={me?.email} now={now} toAll={<Link to="/calls" className="ac-btn is-secondary">All calls</Link>} />;
      }
      case 'view': {
        if (first) return <FirstDay calendar={connected} />;
        switch (mode.view) {
          case 'all': {
            const near = daysAhead(ahead, true);
            const more = ahead.length - near.count;
            return (
              <>
                <SheetHead title="All calls" actions={toggle} />
                {connectLine}
                {near.days.map((d, i) => (
                  <CallsGroup key={d.key} label={d.label} soon
                    more={i === near.days.length - 1 && more > 0 ? <CallsMore link={(p) => <Link to="/calls" search={{ view: 'soon' }} {...p} />}>Show {more} more coming up</CallsMore> : undefined}>
                    {d.rows.map(row)}
                  </CallsGroup>
                ))}
                {!near.days.length && more > 0 && <CallsGroup label="Coming up" soon more={<CallsMore link={(p) => <Link to="/calls" search={{ view: 'soon' }} {...p} />}>{plural(more, 'call')} coming up</CallsMore>}>{null}</CallsGroup>}
                {past(notes)}
              </>
            );
          }
          case 'soon': {
            const waiting = ahead.filter(waitsForTime);
            const days = byDay(ahead, nowAt);
            return (
              <>
                <SheetHead title="Coming up" actions={toggle} />
                {connectLine}
                {waiting.length > 0 && <CallsGroup label="Waiting for a time" soon>{waiting.map(row)}</CallsGroup>}
                {days.map((d) => <CallsGroup key={d.key} label={d.label} soon>{d.rows.map(row)}</CallsGroup>)}
                {!ahead.length && <NothingIn place="soon" />}
              </>
            );
          }
          case 'week':
            return <WeekView offset={week} onOffset={setWeek} notes={notes} calls={calls ?? []} inbox={inbox} me={me?.email} now={now} calendarOn={google} toggle={toggle} />;
          case 'past':
            return <><SheetHead title="Past calls" />{notes.length ? past(notes) : <NothingIn place="past" />}</>;
          case 'room': {
            const rooms = notes.filter(inTheRoom);
            return <><SheetHead title="Recorded in the room" />{rooms.length ? past(rooms) : <NothingIn place="room" />}</>;
          }
          case 'shared': {
            const shared = notes.filter(sharedWithYou);
            return <><SheetHead title="Shared with you" />{shared.length ? past(shared) : <NothingIn place="shared" />}</>;
          }
          case 'series': {
            const series = seriesAhead(ahead);
            return (
              <>
                <SheetHead title="Series" sub={series.length ? 'Calls that repeat, each with its next call' : undefined} />
                {series.length ? (
                  <CallsGroup label="Each with its next call">
                    {series.map((s) => {
                      const tag = seriesTag(s.next);
                      const faces = peopleOn(s.next, me?.email);
                      return (
                        <CallRow key={s.id} who={faces.length ? { faces } : { arch: 'repeat', solid: true }} title={s.title} soon
                          open={(p) => <Link to="/calls" search={{ series: s.id }} {...p} />} tag={tag ? { icon: 'repeat', text: tag } : undefined}
                          line={whoWithYou(s.next, me?.email)} when={{ at: nextLabel(s.next, nowAt) }} />
                      );
                    })}
                  </CallsGroup>
                ) : <NothingIn place="series" />}
              </>
            );
          }
        }
      }
    }
  })();

  /*
   * The scheduler opened from a place on this page goes back to it as it was, hash and all; opened from elsewhere (Home's
   * Schedule for later, a call's Change the time), it closes onto All calls.
   */
  const cameFrom = useRef(false);
  useEffect(() => { if (!scheduling) cameFrom.current = true; }, [scheduling]);
  const stopScheduling = () => {
    if (cameFrom.current) router.history.back();
    else void navigate({ to: '/calls', state: (s) => ({ ...s, scheduleWith: undefined }), replace: true });
  };
  return (
    <Evening moment="calls" className="cs">
      <SkyBar title="Calls"
        search={(
          <SkySearch inputRef={line} value={text} placeholder="Search every call, or ask" maxLength={MAX_QUESTION} keyHint={shortcut('K')} keyShortcuts={ariaShortcut('K')}
            asked={asked} asking={!!answer && !answer.done} onChange={change} onKeyDown={keys} onClear={() => { clear(); line.current?.focus(); }} onAsk={run}
            token={token && <span className="cs-q-tok"><Avatar person={token} size={22} /><span>{callName(token)}</span><IconButton icon="x" size={14} label="Show everyone’s calls" onClick={unpick} /></span>} />
        )}
        action={scheduling ? undefined : <Button variant="primary" icon="cal" onClick={() => schedule({ schedule: 'new' })}>Schedule a call</Button>} />
      <p className="sr-only" role="status">{mode.kind === 'found' ? plural(found.length, 'call') : ''}</p>
      {scheduling ? <Scheduling search={search} onClose={stopScheduling} /> : (
        <div className="cs-split" style={{ '--d': 1 }}>
          <Rail lit={lit} first={first} soon={ahead.length} rooms={notes.filter(inTheRoom).length} shared={notes.filter(sharedWithYou).length} series={seriesAhead(ahead)}
            calendar={google ? 'google' : calendar?.source === 'sample' ? 'sample' : null} now={now} onGo={() => { if (text) clear(); else if (answer || lost) putAway(); }} />
          <CallsSheet ref={sheet} label="Your calls">
            <Chips lit={lit} onGo={() => { if (text) clear(); }} />
            {body}
          </CallsSheet>
        </div>
      )}
    </Evening>
  );
}
