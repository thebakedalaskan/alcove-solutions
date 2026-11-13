/*
 * Your side of the call, one view at a time (side.ts): Notes, with its tabs (the notes as the call goes, the transcript, asking
 * about the call in CatchUp.tsx, and your own notes in Yours.tsx); Chat; and People. It slides in at
 * the right and the stage makes room (PanelHost.tsx); on a phone it's a sheet over the call. Notes, the transcript and
 * answers come from what was really said while notes were on; nothing here is invented. The notes are the call's shared
 * live notes, which come with the call (CallState.liveNotes), so ticking a follow-up is done for everyone there. Chat is
 * end-to-end encrypted in the browsers (CallSession.crypto); the server only relays it.
 */
import { clock, errorMessage, notesAreOn, type CallAsker, type CallState, type CallStatus, type CatchUpItem, type CallSession, type Person, type Rung, type TranscriptMoment } from '@alcove/api';
import { Avatar, Button, Dots, EmptyState, Faces, Icon, IconButton, Tabs, TimeChip, Unencrypted, WsPutArrow, cn, useToast, type IconName } from '@alcove/ui';
import type { StageTogether } from './Stage';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { rungWords } from '~/features/calls/ringing/RingWords';
import type { LineMarks } from '~/features/notes/lines';
import { lineClock } from '~/features/workspace/live/lines';
import type { LivePut } from '~/features/workspace/live/types';
import { captureHere } from '~/lib/capture';
import { useLive } from '~/lib/live';
import { callName, listNames, sameEmail } from '~/lib/people';
import { hm } from '~/lib/time';
import { capital } from '~/lib/words';
import { AskForNotes, askerOf, notesBrowser, organizerName, roomScribe, useNotNow, type CaptureControls } from '../notes/Capture';
import { callTimes, type CallTimes } from '../notes/CatchUp';
import { CallLines } from '../notes/LiveLines';
import { NotesFollowUps } from '../notes/FollowUps';
import { StopMarks, type StopMark } from '../notes/PlanStop';
import { useActionFocus, type ActionJump } from './actionFocus';
import type { NotesTab } from './side';
import { statusText } from './status';
import { TileMenu, type PersonMenu } from './TileMenu';

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/**
 * Someone in the call, as People shows them. `handId`: their raised hand's ID, or null. `volume`: how loud they are for you, null
 * for yourself. `status`: what they say they're up to, while it lasts. `menu`: what their ⋯ offers, as their tile's does (yours,
 * your status); writing to them privately is on their row itself.
 */
export interface PanelPerson {
  id: string; person: Person; isMe: boolean; organizer: boolean; mic: boolean; handId: string | null; speaking: boolean; volume: number | null; detail: string; tags: string[];
  status: CallStatus | null; menu: PersonMenu;
}

/**
 * Whoever hosts' controls. Mute has no remote unmute; removing only disconnects; a locked call keeps everyone new out; pointing
 * off takes every pointer and mark off shared screens, for everyone. Letting people in is in People; the rest is on each
 * person's ⋯ and in the call's settings.
 */
export interface HostControls {
  admit: (id: string) => Promise<void>;
  deny: (id: string) => Promise<void>;
  mute: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  locked: boolean;
  lock: (on: boolean) => Promise<void>;
  pointing: boolean;
  setPointing: (on: boolean) => Promise<void>;
}

/** The head of your side, but for Notes (NotesHead): what it shows, and × to put it away. */
export function SideHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="ic-side-head">
      <div className="ttl"><h2>{title}</h2></div>
      <IconButton icon="x" label={`Close ${title}`} onClick={onClose} />
    </div>
  );
}

/** What the side shows under its head: a change of view, or of tab, comes in as the last one goes. */
export function SideBody({ view, children }: { view: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="ic-views">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.section key={view} className="ic-view" initial={reduce ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : UI}>
          {children}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}

const NOTES_TABS: { value: NotesTab; label: string }[] = [{ value: 'notes', label: 'Notes' }, { value: 'transcript', label: 'Transcript' }, { value: 'ask', label: 'Ask' }, { value: 'yours', label: 'Yours' }];
/** Notes' tabs: the notes, the transcript, Ask, and your own notes for someone with an account to keep them under (`yours`). */
export const NotesTabs = ({ tab, yours, onTab }: { tab: NotesTab; yours: boolean; onTab: (t: NotesTab) => void }) => (
  <Tabs className="nn-tabs" label="Notes, the transcript, Ask or yours" value={tab} onChange={onTab} options={yours ? NOTES_TABS : NOTES_TABS.filter((t) => t.value !== 'yours')} />
);

/**
 * The head of Notes: what it is, its state in a word (`pill`, which opens what's captured), Unencrypted beside it while the
 * call's model isn't in a secure enclave (so it's said on every tab, in every state), Open and ×.
 */
export function NotesHead({ pill, modelPrivate, onOpen, onClose }: { pill: ReactNode; modelPrivate: boolean; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="ic-side-head nn-head">
      <h2>Notes</h2>
      {pill}
      {!modelPrivate && <Unencrypted compact />}
      <span className="sp" />
      <IconButton icon="external" label="Open in the workspace, on your screen" onClick={onOpen} />
      <IconButton icon="x" label="Close Notes" onClick={onClose} />
    </div>
  );
}

/* ---------- notes ---------- */

/** What's said in a breakout room nobody's browser can hear, and one the organizer paused on its own. */
const ROOM_UNHEARD = 'Nobody’s browser in this room can transcribe it right now, so nothing new is transcribed.';
const ROOM_PAUSED = 'Notes are paused in this room. Nothing said here is transcribed until the organizer resumes.';

/** One bar under the tabs: what capture means now, said once, and the one thing to do about it. */
interface Bar { key: string; tone?: 'ask' | 'caution' | undefined; icon?: IconName | undefined; faces?: Person[] | undefined; text: string; acts?: ReactNode }

/**
 * The bars under Notes' tabs, on the notes and the transcript: this browser's own problems, then what capture means where
 * you are, only when it isn't simply live, with the one thing to do about it. `capture`: say capture's state too. The notes
 * say it in their empty state instead while there's nothing in them. While the organizer's plan has stopped notes, the bar
 * over the tabs says that, with what to do (PlanStop.tsx), so nothing here says it again.
 */
export function NotesBars({ state, controls, problems, capture }: { state: CallState; controls: CaptureControls; problems: string[]; capture: boolean }) {
  const { notNow, busy } = useNotNow(state, controls);
  const c = state.capture;
  const here = captureHere(c);
  const host = state.isOrganizer;
  const organizer = capital(organizerName(state));
  const askers = c.requests.map((r) => askerOf(state, r));
  const bars: Bar[] = problems.map((p) => ({ key: p, tone: 'caution', icon: 'alert', text: p }));
  if (notesAreOn(c.mode) && state.isHost && !host && c.room) {
    bars.push({ key: 'hosting', tone: 'caution', icon: 'alert', text: 'You’re hosting from a breakout room, so nobody’s browser hears the main room for the notes until everyone is back.' });
  }
  // Recorded but not heard: notes stay as they are, whatever the tab, unless this browser's own problem already says why.
  if (here.mode === 'on' && here.transcript.mode === 'unavailable' && !(state.isHost && problems.length > 0)) {
    bars.push({ key: 'unheard', tone: 'caution', icon: 'alert', text: `${notesBrowser(state)} can’t listen right now, so nothing new is transcribed. Notes pick up as soon as it can.` });
  }
  const planStopped = c.stopped !== null && !notesAreOn(c.mode);
  if (capture && !planStopped) {
    const since = c.recording.since ? ` at ${hm(c.recording.since)}` : '';
    if (here.mode === 'unavailable') {
      bars.push({ key: 'unavailable', tone: 'caution', icon: 'alert', text: c.room ? ROOM_UNHEARD : c.away
        ? `${notesBrowser(state)} isn’t in the call right now, so nothing new is captured until it’s back.`
        : `${notesBrowser(state)} can’t record or listen right now, so nothing new is captured. Notes pick up as soon as it can.` });
    } else if (here.mode === 'paused' && c.mode !== 'paused') {
      bars.push({ key: 'room', icon: 'pause', text: ROOM_PAUSED, acts: host ? <Button size="sm" variant="primary" icon="play" onClick={() => controls.room(false)}>Resume notes here</Button> : undefined });
    } else if (c.mode === 'paused') {
      bars.push({ key: 'paused', icon: 'pause', text: host ? `Paused${since}. Nothing new is written until you resume.` : `${organizer} paused notes${since}. Nothing new is written until they resume.`,
        acts: host ? <Button size="sm" variant="primary" icon="play" onClick={controls.resume}>Resume</Button> : <AskForNotes state={state} controls={controls} label="Ask to resume" /> });
    } else if (c.mode === 'off' && host && askers.length > 0) {
      bars.push({ key: 'asked', tone: 'ask', faces: askers, text: `${listNames(askers)} asked for notes.`,
        acts: <><Button size="sm" variant="quiet" disabled={busy} onClick={notNow}>Not now</Button><Button size="sm" variant="primary" onClick={() => controls.notes(true)}>Turn on</Button></> });
    } else if (c.mode === 'off') {
      const ever = state.notes.everOn;
      bars.push({ key: 'off', icon: 'notesPen',
        text: !ever ? 'Notes are off, so nothing is being transcribed.' : host ? 'Notes are off. What was written is kept.' : `${organizer} turned notes off. What was written is kept.`,
        acts: host ? <Button size="sm" variant="primary" onClick={() => controls.notes(true)}>Turn on</Button> : <AskForNotes state={state} controls={controls} label="Ask for notes" /> });
    }
  }
  return (
    <>
      {bars.map((b) => (
        <div key={b.key} className={cn('nn-bar', b.tone && `is-${b.tone}`)} role="status">
          {b.faces ? <Faces people={b.faces} size={20} max={3} /> : <Icon name={b.icon ?? 'info'} size={16} />}
          <p className="nn-tx">{b.text}</p>
          {b.acts && <div className="nn-acts">{b.acts}</div>}
        </div>
      ))}
    </>
  );
}

/** A decision, as the notes have it: a rose diamond, its words, when it was said (which opens the transcript there) and the arrow into a document. */
function DecidedRows({ items, times, onSeek, put }: { items: CatchUpItem[]; times: CallTimes; onSeek: (e: TranscriptMoment) => void; put: LivePut | null | undefined }) {
  return (
    <>
      {items.map((it) => {
        const e = it.evidence[0];
        return (
          <motion.div key={`${e?.lineId ?? 'x'}-${it.text}`} className="nn-row" layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
            <span className="nn-dia" aria-hidden="true" />
            <p className="nn-tx">{it.text}</p>
            <span className="end">
              {e && <TimeChip seconds={e.said} label={times.minute(e.said)} title={`Open the transcript at ${times.second(e.said)}`} onSeek={() => onSeek(e)} />}
              {put && <WsPutArrow verb="Add to" target={put.target} onPut={() => put.decided(it.text)} />}
            </span>
          </motion.div>
        );
      })}
    </>
  );
}

/** The summary first, a few lines of it, with how fresh it is at the right of its heading. */
function Summary({ text, fresh }: { text: string; fresh: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => { const el = ref.current; if (el) setLong(el.scrollHeight > el.clientHeight + 2); }, [text]);
  return (
    <section className="nn-sec is-sum" aria-label="Summary">
      <div className="nn-sh"><h3>Summary</h3>{fresh}</div>
      {text ? (
        <>
          <p ref={ref} className={cn('nn-sum', open && 'is-open')}>{text}</p>
          {(long || open) && <button type="button" className="nn-more" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show all'}</button>}
        </>
      ) : <p className="nn-quiet">Nothing to sum up yet.</p>}
    </section>
  );
}

export function NotesView({ session, state, getting, problems, controls, carried, put, stops, onSeek }: {
  session: CallSession;
  state: CallState;
  /** Where the organizer's plan stopped notes in this call, and where they came on again (PlanStop.tsx): marked after the notes. */
  stops: readonly StopMark[];
  /** Who gets the notes, as far as you can tell: everyone invited, for the organizer. */
  getting: Person[];
  /** This browser's own problems with capture: each is a bar. */
  problems: string[];
  /** Notes on and off, pause and resume and not now (the organizer's), or asking for notes (anyone else's). */
  controls: CaptureControls;
  /** What carries over from earlier calls, for you alone, when there's anything of yours. */
  carried?: ReactNode;
  /** Sends a line into the document you were last in, while the workspace has one you can edit. */
  put?: LivePut | null | undefined;
  onSeek: (e: TranscriptMoment) => void;
}) {
  // What the organizer's controls change is the call's. What's said about capture is where you are, as the top bar's
  // sign says: in a breakout room, the room can be heard while the main room can't, and the other way round.
  const c = state.capture;
  const here = captureHere(c);
  const on = notesAreOn(c.mode);
  const paused = c.mode === 'paused';
  const unavailable = here.mode === 'unavailable';
  const pausedHere = here.mode === 'paused';
  const roomHeld = pausedHere && !paused;
  const host = state.isOrganizer;
  const asked = !host ? c.asked : null;
  const organizer = capital(organizerName(state));
  const askers = c.requests.map((r) => askerOf(state, r));
  const live = state.liveNotes;
  const n = live.notes;
  const written = useLive(session.followUps);
  useEffect(() => session.watchFollowUps(), [session]);
  /* What people added comes first in nothing: it's listed among what was said, and there may be no notes for it to go with yet. */
  const any = n !== null || live.added.length > 0 || live.suggestions.length > 0 || (written?.items.length ?? 0) > 0;
  const held = state.breakouts.held;
  const times = callTimes(state.startedAt);
  const { notNow, busy } = useNotNow(state, controls);
  const asOf = n ? times.minute(n.read.asOf) : null;
  /* Anyone else's way to ask, and to take it back: what this view is for while notes are off. */
  const askFor = <AskForNotes state={state} controls={controls} label={asked?.state === 'declined' ? 'Ask again' : 'Ask for notes'} primary />;
  const fresh = (
    <span className={cn('nn-fresh', live.error && 'is-stale')} title={live.error ? 'Alcove tries again on its own' : undefined}>
      {live.error ? <><Icon name="retry" size={13} />{asOf ? `Not updated since ${asOf}` : 'Not updated just now'}</>
        : on && live.writing ? <><Dots />Writing</>
          : asOf && `As of ${asOf}`}
    </span>
  );
  let empty: ReactNode = null;
  if (roomHeld && !any) {
    empty = (
      <EmptyState title="Notes are paused in this room" action={host ? <Button variant="primary" size="sm" icon="play" onClick={() => controls.room(false)}>Resume notes here</Button> : undefined}>
        Nothing said here is transcribed until the organizer resumes.
      </EmptyState>
    );
  } else if (paused && !any) {
    empty = (
      <EmptyState title="Notes are paused" action={host ? <Button variant="primary" size="sm" icon="play" onClick={controls.resume}>Resume</Button> : askFor}>
        {host ? 'Nothing is recorded, transcribed or sent to the AI until you resume.' : asked?.state === 'asking' ? `You asked ${organizer} to resume them.` : `Nothing is recorded, transcribed or sent to the AI until ${organizer} resumes.`}
      </EmptyState>
    );
  } else if (c.mode === 'off' && !any) {
    // The organizer's plan stopped them: the bar over the tabs says why, and what to do; here, only that nothing's written yet.
    empty = c.stopped ? (
      <EmptyState title="Nothing written yet">Notes start here the moment they’re on again.</EmptyState>
    ) : host && askers.length > 0 ? (
      <EmptyState art={<Faces people={askers} size={40} max={3} />} title={`${listNames(askers)} asked for notes`}
        action={<><Button variant="quiet" size="sm" disabled={busy} onClick={notNow}>Not now</Button><Button variant="primary" size="sm" onClick={() => controls.notes(true)}>Turn on notes</Button></>}>
        Nothing from this call is written down yet. Notes start from the moment you turn them on.
      </EmptyState>
    ) : host ? (
      <EmptyState title="Notes are off" action={<Button variant="primary" size="sm" onClick={() => controls.notes(true)}>Turn on notes</Button>}>
        Nothing from this call is written down. Notes start from the moment you turn them on.
      </EmptyState>
    ) : asked?.state === 'asking' ? (
      <EmptyState title={`You asked ${organizer} for notes`} action={askFor}>{organizer} sees your ask, and so does everyone here. You’ll hear when they answer.</EmptyState>
    ) : asked?.state === 'declined' ? (
      <EmptyState title={`${organizer} said not now`} action={askFor}>At {hm(asked.at)}. You can ask again.</EmptyState>
    ) : (
      <EmptyState title="Notes are off" action={askFor}>Only {organizer} can turn them on. You can ask them to.</EmptyState>
    );
  } else if (unavailable && !any) {
    empty = (
      <EmptyState title="Nothing is being captured">
        {c.room ? 'Nobody’s browser in this room can transcribe it right now. Notes pick up as soon as one can.' : c.away ? `${notesBrowser(state)} isn’t in the call right now. Notes pick up as soon as it’s back.`
          : `${notesBrowser(state)} can’t record or listen right now.${state.isHost ? ' Everyone can see that.' : ''} Notes pick up as soon as it can.`}
      </EmptyState>
    );
  } else if (!any && live.error) {
    empty = <EmptyState title="The first notes couldn’t be written yet">Alcove tries again on its own. What’s said is still transcribed meanwhile.</EmptyState>;
  } else if (!any) {
    empty = (
      <EmptyState title={live.writing ? 'Writing the first notes' : 'Listening'} className="is-listening">
        {state.transcript.length ? 'Decisions, follow-ups and a summary come in here in a moment.' : 'Decisions, follow-ups and a summary come in here as people talk.'}
      </EmptyState>
    );
  }
  return (
    <>
      <NotesBars state={state} controls={controls} problems={problems} capture={any} />
      <div className="nn-body">
        {carried}
        {empty ?? (
          <>
            {n?.read.whileHere && <p className="nn-guest"><Icon name="lock" size={13} />Written from what was said while you were here.</p>}
            <Summary text={n?.summary ?? ''} fresh={fresh} />
            <section className="nn-sec is-dec" aria-label="Decided">
              <div className="nn-sh"><h3>Decided</h3>{(n?.decided.length ?? 0) > 0 && <span className="n">{n?.decided.length}</span>}</div>
              {n?.decided.length ? <DecidedRows items={n.decided} times={times} onSeek={onSeek} put={put} /> : <p className="nn-quiet">Nothing decided yet.</p>}
            </section>
            <NotesFollowUps key={state.capture.room?.id ?? 'main'} session={session} put={put} onSeek={onSeek} people={getting} />
            <StopMarks marks={stops} />
            {held.length > 0 && (
              <section className="nn-sec nn-rooms" aria-label="From the rooms">
                <div className="nn-sh"><h3>From the rooms</h3><span className="n">{held.reduce((k, h) => k + h.rooms.length, 0)}</span></div>
                {held.map((h) => (
                  <div key={h.from}>
                    {h.rooms.map((r) => {
                      const sent = [...r.people, ...r.guests.map((g) => g.person)];
                      return <div key={r.id} className="rn">{r.name}<span>{sent.length}</span><Faces people={sent} size={16} /></div>;
                    })}
                    <p className="nn-quiet">{clock(h.from)} to {clock(h.to)}. Each room’s talk goes into the call’s notes as its own section.</p>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- transcript ---------- */

export function TranscriptView({ state, me, marks, put, controls, problems }: {
  state: CallState; me: string | undefined; marks?: LineMarks | undefined; put?: LivePut | null | undefined;
  controls: CaptureControls; problems: string[];
}) {
  // What's said where you are: in a breakout room, the room's lines, under the room's capture.
  const c = captureHere(state.capture);
  const on = notesAreOn(c.mode);
  return (
    <>
      <NotesBars state={state} controls={controls} problems={problems} capture />
      <div className="ic-tr">
        {state.transcript.length ? <CallLines lines={state.transcript} gaps={c.gaps} me={me} marks={marks} quote={put ? { target: put.target, onQuote: put.line } : null} when={(at) => lineClock(state, at)} /> : on && (
          <EmptyState title="Nothing said yet">
            {!state.capture.room ? 'What’s said appears here a few seconds later.'
              : state.capture.room.scribe ? `What’s said here appears a few seconds later, transcribed by ${roomScribe(state)} for this room’s section of the notes.`
                : 'What’s said here appears once a browser in this room can transcribe it.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

/** The foot of People: how the call is kept private. */
const Foot = ({ icon = 'sealed', children, wrap = false }: { icon?: 'sealed' | 'lock'; children: ReactNode; wrap?: boolean }) => (
  <div className={cn('ic-nf', wrap && 'is-wrap')}><Icon name={icon} size={15} /><span className="lbl">{children}</span></div>
);

/* ---------- people ---------- */

/** Whether someone's name has what's typed in Find someone in it. */
const named = (person: Person, find: string) => !find || person.name.toLowerCase().includes(find);

/** A row's ⋯: what its menu offers, opened from the row, but for writing privately, which the row has a button for. */
function RowMenu({ p, menu }: { p: PanelPerson; menu: PersonMenu }) {
  const [open, setOpen] = useState(false);
  return <TileMenu row who={p.person} me={p.isMe} open={open} onOpenChange={setOpen} menu={menu} />;
}

/** Whether a person's menu has anything in it. */
const offers = (m: PersonMenu) => Object.values(m).some((v) => v !== undefined);

export function PeopleView({ here, invited, asking, invites = false, ringing, canRing, onRing, onStopRing, notesAsks, rooms, host, foot, link, together, jump }: {
  jump?: ActionJump | undefined;
  /** Everyone in the call, hands raised first, in the order they went up. */
  here: PanelPerson[]; invited: Person[];
  /** With the workspace open: where each is, and following them. */
  together?: StageTogether | undefined;
  /** People asking to join: only whoever hosts sees them. */
  asking: CallAsker[];
  /** Letting someone signed in in adds them to the invite: only when the organizer does it. */
  invites?: boolean;
  /** People the organizer rang who aren't here, and how each answered: only the organizer sees them. */
  ringing: Rung[];
  /** Whether someone invited can be rung, and ringing them: the organizer's, while the call is on. */
  canRing?: ((p: Person) => boolean) | undefined;
  onRing?: ((p: Person) => void) | undefined;
  /** The organizer stops ringing someone, here or when a ring comes due later. */
  onStopRing?: ((id: string) => void) | undefined;
  /** People asking for notes, for the organizer to answer; shown under those asking to join. */
  notesAsks?: ReactNode;
  /** Breakout rooms, for the organizer once there's someone to send: they open in your side, in place of People. */
  rooms?: { open: boolean; onOpen: () => void } | undefined;
  /** Letting people in and turning them away: whoever hosts'; absent for everyone else. */
  host?: Pick<HostControls, 'admit' | 'deny'> | undefined;
  /** What the footer says: how the call is kept private. */
  foot: ReactNode;
  /** The call's link, to copy: anyone with it can ask to join, unless the call is locked. */
  link: { copy: () => void; locked: boolean };
}) {
  const [find, setFind] = useState('');
  const look = find.trim().toLowerCase();
  const away = invited.filter((g) => !here.some((p) => sameEmail(p.person, g)) && !ringing.some((r) => sameEmail(r.person, g)) && named(g, look));
  const now = Date.now();
  const actionFocus = useActionFocus(jump);
  const roomsSaid = useId();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = (id: string, f: (id: string) => Promise<void>) => {
    setBusy(id);
    f(id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setBusy(null));
  };
  const askers = host ? asking.filter((w) => named(w.person, look)) : [];
  const inCall = here.filter((p) => named(p.person, look));
  const rung = ringing.filter((r) => named(r.person, look));
  const found = askers.length + inCall.length + rung.length + away.length;
  return (
    <>
      <label className="ic-find">
        <Icon name="search" size={16} />
        <input type="search" value={find} placeholder="Find someone" aria-label="Find someone in this call" autoComplete="off" spellCheck={false}
          onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && find) { e.preventDefault(); e.stopPropagation(); setFind(''); } }} />
      </label>
      <div ref={actionFocus} className="ic-scroll ic-pad">
        {look && !found && <EmptyState art={null} title="Nobody by that name" className="ic-empty">Try another name, or part of one.</EmptyState>}
        {host && askers.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h">Asking to join · {askers.length}</div>
            {askers.map((w) => (
              <div key={w.id} data-call-action={w.id} tabIndex={-1} className="ic-prow is-asking">
                <Avatar person={w.person} size={36} />
                {/* Signed in: who it is, and whether letting them in adds them to the invite. A guest is only a typed name. */}
                <div className="min-w-0"><b>{w.person.name}</b><small>{w.person.email || 'Guest, by name only'}</small><small>{w.person.email && invites ? 'Gets the notes once let in' : 'Doesn’t get the notes'}</small></div>
                <div className="st">
                  <IconButton icon="x" label={`Turn ${callName(w.person)} away`} disabled={busy === w.id} onClick={() => decide(w.id, host.deny)} />
                  <Button size="sm" variant="secondary" loading={busy === w.id} onClick={() => decide(w.id, host.admit)}>Let in</Button>
                </div>
              </div>
            ))}
          </>
        )}
        {!look && notesAsks}
        {!look && rooms && (
          <button type="button" className="ic-roomsrow" aria-label="Breakout rooms" aria-describedby={roomsSaid} onClick={rooms.onOpen}>
            <Icon name="door" size={20} />
            <span className="min-w-0"><b>Breakout rooms</b><small id={roomsSaid}>{rooms.open ? 'Rooms are open' : 'Split the call into rooms for a while'}</small></span>
            <Icon name="chevron" size={16} />
          </button>
        )}
        {inCall.length > 0 && (
          <div className={cn('ac-eyebrow ic-cap-h', (askers.length > 0 || (!look && (Boolean(notesAsks) || Boolean(rooms)))) && 'mt')}>In this call · {inCall.length}</div>
        )}
        {inCall.map((p) => {
          const line = [p.status ? statusText(p.status) : '', (!p.isMe && together?.where[p.id]) || (p.tags.length ? p.tags.join(' · ') : p.detail)].filter(Boolean).join(' · ');
          const { privateMessage: message, ...menu } = p.menu;
          return (
            <div key={p.id} className={cn('ic-prow', p.handId && 'has-hand')} data-call-action={p.handId ?? undefined} tabIndex={p.handId ? -1 : undefined}>
              <Avatar person={p.person} size={36} />
              <div className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{p.handId && <Icon name="hand" size={12} className="hd" />}{line}</small></div>
              <div className="st">
                {together?.following === p.id
                  ? <Button size="xs" variant="quiet" onClick={together.onStop}>Following</Button>
                  : together?.followable.includes(p.id) && <Button size="xs" onClick={() => together.onFollow(p.id)}>Follow</Button>}
                {p.speaking && p.mic && <span className="ac-level" aria-label="Speaking"><i /><i /><i /></span>}
                {!p.mic && <Icon name="micOff" size={16} aria-label="Microphone off" />}
                {p.volume === 0 && <Icon name="speakerOff" size={16} aria-label="Muted for you" />}
                {message
                  ? <IconButton icon="lock" size={16} label={`Message ${callName(p.person)} privately`} className="ic-pmore" onClick={message} />
                  : <span className="ic-pgap" aria-hidden="true" />}
                {offers(menu) ? <RowMenu p={p} menu={menu} /> : <span className="ic-pgap" aria-hidden="true" />}
              </div>
            </div>
          );
        })}
        {rung.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h mt">Ringing · {rung.length}</div>
            {rung.map((r) => {
              const said = rungWords(r, now);
              return (
                <div key={r.id} className="ic-prow">
                  <Avatar person={r.person} size={36} />
                  <div className="min-w-0"><b>{r.person.name}</b><small>{said.line}</small></div>
                  <div className="st">
                    {said.again && onRing && <IconButton icon="phoneCall" size={16} label={`Ring ${callName(r.person)} again`} className="ic-pmore" onClick={() => onRing(r.person)} />}
                    {(r.state === 'ringing' || r.state === 'later') && onStopRing && <IconButton icon="x" size={16} label={`Stop ringing ${callName(r.person)}`} className="ic-pmore" onClick={() => onStopRing(r.id)} />}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {away.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h mt">Invited, not here · {away.length}</div>
            {away.map((g) => (
              <div key={g.email} className="ic-prow is-away">
                <Avatar person={g} size={36} />
                <div className="min-w-0"><b>{g.name}</b><small>Gets the notes</small></div>
                <div className="st">{onRing && canRing?.(g) && <IconButton icon="phoneCall" size={16} label={`Ring ${callName(g)}`} className="ic-pmore" onClick={() => onRing(g)} />}</div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="ic-plink">
        <span>{link.locked ? 'The call is locked. Nobody new can join.' : 'Anyone with the link can ask to join'}</span>
        <Button size="xs" variant="secondary" icon="link" onClick={link.copy}>Copy link</Button>
      </div>
      <Foot icon="lock" wrap>{foot}</Foot>
    </>
  );
}
