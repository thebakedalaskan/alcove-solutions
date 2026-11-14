/*
 * On the water: what your agents did, newest first and only for you, grouped by day, each row a sentence with what it was
 * about a link to the note or call; Show more reads on. Beside it, things to ask your agent, each with the mark of the row
 * it will make, and once an agent is connected, which of your agents can do it, or what they can't. What they did goes
 * with the agents that did it, so with none connected it has nothing to hold: the water is then only what you can ask.
 */
import { errorCode, errorMessage, type AgentActivity, type AgentConnection, type Meeting, type NoteSummary, type Person } from '@alcove/api';
import { AgentDay, AgentDid, AgentNone, AgentQuestion, Button, cn, Dots, Icon } from '@alcove/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { callName, listNames } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { noteQueries } from '~/features/notes/queries';
import { teamQueries } from '~/features/team/queries';
import { agentQueries } from './queries';
import { daysFromToday, hm, noteDay, shortDay } from '~/lib/time';
import { plural } from '~/lib/words';
import { useCopy } from './copy';
import { ENDS_IT, GONE, SAID } from './did';
import { namesInLine } from './line';
import { questionsFor, whoCan } from './questions';

const NO_NOTES: NoteSummary[] = [];
const NO_CALLS: Meeting[] = [];

/**
 * The water under the line. What your agents did shows while any agent is connected, or while the line is still on its
 * way; with none, the questions take the water, two across. `down`: the page couldn't reach Alcove, and the sky says so.
 */
export function OnTheWater({ connections, down, now }: { connections: readonly AgentConnection[] | undefined; down: boolean; now: Date }) {
  const log = !down && connections?.length !== 0;
  return (
    <div className={cn('ag-water', !log && 'is-solo')} style={{ '--d': 1 }}>
      {log && <WhatTheyDid connections={connections} now={now} />}
      <AskYourAgent connections={connections ?? []} />
    </div>
  );
}

/** Days, newest first, each with what happened that day. */
function byDay(items: readonly AgentActivity[], now: Date): { day: string; items: AgentActivity[] }[] {
  const days: { day: string; items: AgentActivity[] }[] = [];
  for (const a of items) {
    const day = noteDay(a.at, now);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(a);
    else days.push({ day, items: [a] });
  }
  return days;
}

/** What they did, or one row where the first will be: nothing yet, its dots on the way, or Try again. */
function WhatTheyDid({ connections, now }: { connections: readonly AgentConnection[] | undefined; now: Date }) {
  const head = useId();
  const activity = useInfiniteQuery(agentQueries.agentActivity());
  const notes = useQuery(noteQueries.notes()).data ?? NO_NOTES;
  const calls = useQuery(callQueries.upcoming()).data ?? NO_CALLS;
  const items = activity.data?.pages.flatMap((p) => p.items) ?? [];

  const row = (a: AgentActivity) => {
    const said = SAID[a.tool];
    const who = connections?.find((c) => c.id === a.connectionId)?.name ?? 'An agent';
    const title = said.about === 'note' ? a.noteTitle : said.about === 'call' ? a.meetingTitle : null;
    const note = a.noteId ? notes.find((n) => n.id === a.noteId) : undefined;
    const call = a.meetingId ? calls.find((m) => m.id === a.meetingId) : undefined;
    let about: ReactNode = null;
    if (said.about === 'note') about = title && a.noteId ? <Link className="ag-obj" to="/calls/$noteId" params={{ noteId: a.noteId }}>{title}</Link> : GONE.note;
    else if (said.about === 'call') {
      const id = a.meetingId;
      about = title && id ? <Link className="ag-obj" to="/calls/upcoming/$meetingId" params={{ meetingId: id }}>{title}</Link> : GONE.call;
    }
    const sub = said.sub ?? (said.counts && a.count !== null ? plural(a.count, said.counts[0], said.counts[1])
      : said.about && !title ? (ENDS_IT.has(a.tool) ? undefined : 'Not there any more')
        : said.about === 'note' && note ? callDay(note.startedAt, now)
          : said.about === 'call' && a.meetingStartsAt ? callLine(a.meetingStartsAt, call) : undefined);
    return (
      <AgentDid key={a.id} icon={said.icon} tone={said.tone} at={a.at} time={hm(a.at)} sub={sub}>
        <b>{who}</b> {said.verb}{about && <> {about}</>}
      </AgentDid>
    );
  };

  let body: ReactNode;
  if (items.length) {
    body = (
      <>
        {byDay(items, now).map((d) => <AgentDay key={d.day} day={d.day}>{d.items.map(row)}</AgentDay>)}
        {activity.hasNextPage && (
          <div className="ag-log-f">
            <Button variant="quiet" size="sm" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>Show more</Button>
            {activity.isFetchNextPageError && <p role="alert" className="ac-agent-problem">{errorMessage(activity.error)}</p>}
          </div>
        )}
      </>
    );
  } else if (activity.isError) {
    body = (
      <AgentNone problem title="Didn’t load"
        action={<Button variant="quiet" size="sm" icon="retry" loading={activity.isFetching} onClick={() => void activity.refetch()}>Try again</Button>}>
        {errorCode(activity.error) === 'network' ? 'Alcove couldn’t reach the server.' : errorMessage(activity.error)}
      </AgentNone>
    );
  } else if (activity.isPending) {
    body = <div className="ag-waiting" role="status"><Dots /><span className="sr-only">Looking for what your agents did</span></div>;
  } else {
    /* One agent is named: what Claude reads and changes. */
    const [only, more] = namesInLine(connections ?? []);
    body = <AgentNone title="Nothing yet">What {only && !more ? `${only} reads and changes` : 'your agents read and change'} in Alcove shows here, newest first.</AgentNone>;
  }
  return (
    <section aria-labelledby={head}>
      <div className="ag-h"><h2 id={head}>What your agents did</h2><span className="ag-only"><Icon name="lock" size={14} />Only you see this</span></div>
      {body}
    </section>
  );
}

/** When a note's call was: "11:58" today, else "Tue 27 Oct". */
const callDay = (startedAt: string, now: Date) => (daysFromToday(new Date(startedAt), now) === 0 ? hm(startedAt) : shortDay(new Date(startedAt)));

/** "Tue 10 Nov, 11:00 · with Priya and Kofi · notes on", the people and notes when the call is one of yours still to come. */
function callLine(startsAt: string, call: Meeting | undefined): string {
  const d = new Date(startsAt);
  const parts = [`${shortDay(d)}, ${hm(d)}`];
  if (call?.guests.length) parts.push(`with ${listNames(call.guests)}`);
  if (call?.notes === 'on') parts.push('notes on');
  return parts.join(' · ');
}

/** Up to two people you work with, by first name: your team on Alcove, or else the people in your notes. */
function peopleYouWorkWith(me: Person | undefined, team: readonly Person[] | undefined, notes: readonly NoteSummary[]): string[] {
  const seen = new Set<string>(me ? [me.email.toLowerCase()] : []);
  const names: string[] = [];
  for (const p of team ?? notes.flatMap((n) => n.people)) {
    const address = p.email.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    names.push(callName(p));
    if (names.length === 2) break;
  }
  return names;
}

function AskYourAgent({ connections }: { connections: readonly AgentConnection[] }) {
  const head = useId();
  const me = useQuery(accountQueries.session()).data?.user;
  const team = useQuery(teamQueries.team()).data;
  const notes = useQuery(noteQueries.notes()).data ?? NO_NOTES;
  const { copy, problem } = useCopy();
  const people = peopleYouWorkWith(me, team ? team.members.filter((m) => m.onAlcove).map((m) => m.person) : undefined, notes);
  return (
    <section aria-labelledby={head}>
      <div className="ag-h"><h2 id={head}>Ask your agent</h2></div>
      <ul className="ag-qs">
        {questionsFor(people).map((x) => {
          const who = whoCan(x, connections);
          const mark = SAID[x.does];
          return (
            <AgentQuestion key={x.id} icon={mark.icon} tone={mark.tone} question={x.ask} sub={who.sub} can={who.can !== undefined}
              onCopy={() => void copy(x.ask, `Copied. Paste it into ${who.can ?? 'your agent'}.`, 'Copy wasn’t available. Select the question and copy it.')} />
          );
        })}
      </ul>
      {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
    </section>
  );
}
