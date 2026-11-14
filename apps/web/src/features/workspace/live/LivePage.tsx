/*
 * A call's own pages: Notes, Follow-ups and the Transcript, as live as the call. Everything comes from the call as it stands
 * (`CallState`), so there's nothing here to keep in step. Each stays in the list whatever the notes are doing, and with
 * nothing to show and notes off, it says why it's empty and what to do about it.
 */
import { firstName, type CallState, type CatchUpItem } from '@alcove/api';
import { Button, Notice, WsDoc, WsDocHead, WsFollowBar, WsNotesOff, WsNotesPage, WsScroll, WsTranscript, type WsDecision, type WsSaid } from '@alcove/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFollow } from '~/features/call/notes/LiveLines';
import { organizerName } from '~/features/call/notes/Capture';
import { captureHere } from '~/lib/capture';
import { CallFollowUps } from '~/features/call/notes/FollowUps';
import { useLive } from '~/lib/live';
import { useLiveHost, type LiveHost } from './host';
import { clockAt, lineClock, modeHere, notesOnHere, speakerOf } from './lines';
import type { LiveCall, LivePageId } from './types';
import { useFollowUps } from './useFollowUps';

const NAMES: Record<LivePageId, string> = { notes: 'Notes', 'follow-ups': 'Follow-ups', transcript: 'Transcript' };
/** How many follow-ups Notes shows before All. */
const FIRST_FOLLOW_UPS = 3;
const FLASH_MS = 1600;

/** What's holding the notes back here, in a line, when something is. Turned off, anyone but the organizer can ask for them back. */
function heldBack(s: CallState, live: LiveCall): ReactNode {
  const organizer = organizerName(s);
  const here = captureHere(s.capture);
  const error = s.liveNotes.error;
  if (s.liveNotes.notes?.read.whileHere) return <Notice icon="lock">Only what was said while you were here.</Notice>;
  if (here.mode === 'paused') return <Notice icon="pause">{`Notes are paused. Nothing new is written down until ${s.isOrganizer ? 'you resume' : `${organizer} resumes`}.`}</Notice>;
  if (here.mode === 'off') {
    const asking = s.capture.asked?.state === 'asking';
    return (
      <Notice icon="notesPen" className="wl-off">
        {asking ? `Notes are off. You asked ${firstName(organizer)} for them.` : 'Notes are off. Nothing new is written down until they’re back on.'}
        {!s.isOrganizer && (asking
          ? <Button variant="quiet" size="xs" onClick={() => live.ask(false)}>Take back your ask</Button>
          : <Button variant="secondary" size="xs" icon="hand" onClick={() => live.ask(true)}>Ask {firstName(organizer)} for notes</Button>)}
      </Notice>
    );
  }
  if (here.mode === 'unavailable') return <Notice tone="caution" icon="alert">Nothing new is being captured right now. Notes pick up as soon as they can.</Notice>;
  return error ? <Notice tone="caution">{error}</Notice> : null;
}

/** Notes are off and there's nothing to show. Only the organizer can turn them on; anyone else asks, and can take that back. */
function Off({ live, state }: { live: LiveCall; state: CallState }) {
  const organizer = firstName(organizerName(state));
  if (state.isOrganizer) return <WsNotesOff organizer={organizer} onTurnOn={() => live.notes(true)} />;
  return state.capture.asked?.state === 'asking'
    ? <WsNotesOff organizer={organizer} onTakeBack={() => live.ask(false)} />
    : <WsNotesOff organizer={organizer} onAsk={() => live.ask(true)} />;
}

const decidedId = (d: CatchUpItem) => `${d.evidence[0]?.lineId ?? ''}:${d.text}`;

function NotesPage({ host, state }: { host: LiveHost; state: CallState }) {
  const { rows, tick } = useFollowUps({ ...host, session: host.live.session });
  const n = state.liveNotes.notes;
  if (!n && rows.length === 0 && modeHere(state) === 'off') return <Off live={host.live} state={state} />;
  const items = n?.decided ?? [];
  const decided = items.map((d): WsDecision => ({ id: decidedId(d), text: d.text, at: clockAt(state, d.evidence[0]?.said ?? 0) }));
  const { put, go } = host;
  return (
    <WsNotesPage summary={n?.summary ?? ''} decided={decided} followUps={rows.slice(0, FIRST_FOLLOW_UPS)} allFollowUps={rows.length} notice={heldBack(state, host.live)} onTick={tick}
      put={put ? { target: put.target, onPut: (id) => { const d = items.find((x) => decidedId(x) === id); if (d) put.decided(d.text); } } : undefined}
      onTime={(id) => go({ kind: 'live', page: 'transcript', line: items.find((x) => decidedId(x) === id)?.evidence[0]?.lineId })}
      onAll={() => go({ kind: 'live', page: 'follow-ups' })} />
  );
}

function FollowUpsPage({ host, state }: { host: LiveHost; state: CallState }) {
  const { rows } = useFollowUps({ ...host, session: host.live.session });
  if (rows.length === 0 && state.liveNotes.suggestions.length === 0 && modeHere(state) === 'off') return <Off live={host.live} state={state} />;
  return <CallFollowUps key={state.capture.room?.id ?? 'main'} session={host.live.session} host={host} notice={heldBack(state, host.live)} />;
}

function TranscriptPage({ host, state, line }: { host: LiveHost; state: CallState; line: string | undefined }) {
  const { live, put } = host;
  const [query, setQuery] = useState('');
  const speaking = useLive(live.speaking);
  /* A time opens the transcript at that moment: it comes into view and glows, and then the page is just the transcript again. */
  const [flash, setFlash] = useState(line);
  useEffect(() => {
    setFlash(line);
    if (!line) return;
    document.querySelector(`[data-line="${CSS.escape(line)}"]`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(undefined), FLASH_MS);
    return () => clearTimeout(t);
  }, [line]);
  const words = query.trim().toLowerCase();
  const lines = useMemo(() => state.transcript.filter((l) => !words || l.text.toLowerCase().includes(words) || (l.speaker?.name.toLowerCase().includes(words) ?? false)).map((l): WsSaid => {
    const { person, name } = speakerOf(l);
    return { id: l.id, person, name: firstName(name), at: lineClock(state, l.at), text: l.text, flash: l.id === flash };
  }), [state, words, flash]);
  if (state.transcript.length === 0 && modeHere(state) === 'off') return <Off live={live} state={state} />;
  const talking = notesOnHere(state) && speaking && !words ? { person: speaking, name: firstName(speaking.name) } : null;
  return (
    <WsTranscript query={query} onQuery={setQuery} lines={lines} now={talking} notice={heldBack(state, host.live)}
      put={put ? { target: put.target, onPut: (id) => { const l = state.transcript.find((x) => x.id === id); if (l) put.line(l); } } : undefined} />
  );
}

/**
 * What scrolls under the head, one for each page, as they swap in place. The transcript stays with its newest line, as it does
 * in the side panel, unless a time opened it somewhere else or you've scrolled up to read.
 */
function Body({ host, state, page, line }: { host: LiveHost; state: CallState; page: LivePageId; line: string | undefined }) {
  const lines = state.transcript;
  const follow = useFollow(page === 'transcript' ? `${lines.length}:${lines.at(-1)?.id}` : '', false, page !== 'transcript' || line !== undefined);
  return (
    <WsScroll ref={follow.ref} onScroll={follow.onScroll}>
      {page === 'notes' ? <NotesPage host={host} state={state} />
        : page === 'follow-ups' ? <FollowUpsPage host={host} state={state} />
          : <TranscriptPage host={host} state={state} line={line} />}
    </WsScroll>
  );
}

/** A call's page, beside the list. */
function Page({ host, page, line }: { host: LiveHost; page: LivePageId; line: string | undefined }) {
  const { live, closed } = host;
  const state = useLive(live.session);
  const on = notesOnHere(state);
  /* Showing the notes is what keeps them being written, and the transcript comes with the call whether or not they are. */
  const watching = page !== 'transcript' && on && !closed;
  useEffect(() => (watching ? live.session.watchNotes() : undefined), [watching, live.session]);
  return (
    <WsDoc>
      <WsDocHead crumbs={[{ label: state.title, onClick: host.showCall }, { label: NAMES[page] }]} save={on ? 'live' : 'quiet'} onToggleList={host.toggleList} />
      <WsFollowBar following={host.following?.quiet ? null : host.following} onStop={host.stopFollowing} />
      <Body key={page} host={host} state={state} page={page} line={line} />
    </WsDoc>
  );
}

export function LivePage({ page, line }: { page: LivePageId; line: string | undefined }) {
  const host = useLiveHost();
  return host ? <Page host={host} page={page} line={line} /> : null;
}
