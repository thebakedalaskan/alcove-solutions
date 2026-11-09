/*
 * Your side of the call, one view at a time (side.ts): Notes, with the notes as the call goes, the transcript and asking
 * about the call (CatchUp.tsx) as its tabs, and your own notes at the foot of the notes; Chat; and People. It slides in at
 * the right and the stage makes room (PanelHost.tsx); on a phone it's a sheet over the call. Notes, the transcript and
 * answers come from what was really said while notes were on; nothing here is invented. The notes are the call's shared
 * live notes, which come with the call (CallState.liveNotes), so ticking a follow-up is done for everyone there. Chat is
 * end-to-end encrypted in the browsers (CallSession.crypto); the server only relays it.
 */
import { clock, errorMessage, notesAreOn, type CallAsker, type CallState, type CatchUpItem, type CallSession, type Person, type Rung, type TranscriptMoment } from '@alcove/api';
import { Avatar, Button, CaptureSign, Dots, EmptyState, Faces, Icon, IconButton, Notice, Popover, Scope, Switch, Tabs, VolumeControl, WsPutArrow, cn, useToast, type IconName } from '@alcove/ui';
import type { StageTogether } from './Stage';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { rungWords } from '~/features/calls/ringing/RingWords';
import { lineClock } from '~/features/workspace/live/lines';
import type { LivePut } from '~/features/workspace/live/types';
import { captureHere } from '~/lib/capture';
import { useLive } from '~/lib/live';
import { callName, listNames, sameEmail } from '~/lib/people';
import { hm } from '~/lib/time';
import { notesBrowser, organizerName, roomScribe, type CaptureControls } from '../notes/Capture';
import { Moments, callTimes, type CallTimes } from '../notes/CatchUp';
import { CallLines } from '../notes/LiveLines';
import { CallFollowUps } from '../notes/FollowUps';
import type { NotesTab } from './side';
import type { VolumeActions } from '../media/volume';

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/** Someone shown in the panel: in the call (and how), or invited and not here. `volume`: how loud they are for you, null for yourself. */
export interface PanelPerson { id: string; person: Person; isMe: boolean; organizer: boolean; mic: boolean; hand: boolean; speaking: boolean; volume: number | null; detail: string; tags: string[] }

/**
 * The organizer's controls in People. Mute has no remote unmute; removing only disconnects; a locked call keeps everyone
 * new out; pointing off takes every pointer and mark off shared screens, for everyone.
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

/**
 * The head of your side: what it shows (and, for Notes, where it's kept), what's yours to press there, and × to put it away.
 */
export function SideHead({ title, sub, onClose, children }: { title: string; sub?: string | undefined; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="ic-side-head">
      <div className="ttl"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}</div>
      {children}
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

const NOTES_TABS: { value: NotesTab; label: string }[] = [{ value: 'notes', label: 'Notes' }, { value: 'transcript', label: 'Transcript' }, { value: 'ask', label: 'Ask' }];
/** The Notes view's tabs: the notes, the transcript and Ask, three views of what was said. */
export const NotesTabs = ({ tab, onTab }: { tab: NotesTab; onTab: (t: NotesTab) => void }) => (
  <Tabs className="ic-ntabs" label="Notes, the transcript or Ask" value={tab} onChange={onTab} options={NOTES_TABS} />
);

const Foot = ({ icon = 'sealed', children, end, wrap = false }: { icon?: 'sealed' | 'lock'; children: ReactNode; end?: ReactNode; wrap?: boolean }) => (
  <div className={cn('ic-nf', wrap && 'is-wrap')}><Icon name={icon} size={15} /><span className="lbl">{children}</span>{end && <span className="end">{end}</span>}</div>
);

/* ---------- notes ---------- */

function DecidedRows({ items, times, onSeek, put }: { items: CatchUpItem[]; times: CallTimes; onSeek: (e: TranscriptMoment) => void; put: LivePut | null | undefined }) {
  return (
    <>
      {items.map((it) => (
        <motion.div key={`${it.evidence[0]?.lineId ?? 'x'}-${it.text}`} className="ic-nr" layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
          <span className="mk"><Icon name="check" size={12} /></span>
          <div className="nr-text">{it.text}</div>
          {it.evidence.length ? <Moments evidence={it.evidence.slice(0, 1)} times={times} onOpen={onSeek} /> : <span />}
          {put && <WsPutArrow verb="Add to" target={put.target} onPut={() => put.decided(it.text)} />}
        </motion.div>
      ))}
    </>
  );
}


function Summary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => { const el = ref.current; if (el) setLong(el.scrollHeight > el.clientHeight + 2); }, [text]);
  return (
    <>
      <p ref={ref} className={cn('ic-sum', open && 'is-open')}>{text}</p>
      {(long || open) && <button type="button" className="ic-more-text" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show more'}</button>}
    </>
  );
}

/** What's said in a breakout room nobody's browser can hear, and one the organizer paused on its own. */
const ROOM_UNHEARD = 'Nobody’s browser in this room can transcribe it right now, so nothing new is transcribed.';
const ROOM_PAUSED = 'Notes are paused in this room. Nothing said here is transcribed until the organizer resumes.';

/**
 * Notes' ⋯, beside the sign it changes: the organizer's Pause, Resume and Turn off (or Turn on), or anyone else's Ask for notes.
 */
function NotesMenu({ state, controls }: { state: CallState; controls: CaptureControls }) {
  const c = state.capture;
  const on = notesAreOn(c.mode);
  const paused = c.mode === 'paused';
  const host = state.isOrganizer;
  const asking = !host && c.asked?.state === 'asking';
  const [menu, setMenu] = useState(false);
  const item = (icon: IconName, label: string, f: () => void) => (
    <button type="button" className="mi" onClick={() => { setMenu(false); f(); }}><Icon name={icon} size={16} /><span className="t">{label}</span></button>
  );
  return (
    <Popover open={menu} onOpenChange={setMenu} side="bottom" align="end" label="Notes options" className="ic-menu narrow"
      anchor={<button type="button" className="ac-icon-btn" aria-label="Notes options" title="Notes options"><Icon name="more" size={18} /></button>}>
      {host && on && item('pause', 'Pause notes', controls.pause)}
      {host && paused && item('play', 'Resume notes', controls.resume)}
      {host && (on || paused) && item('notesPen', 'Turn notes off', () => controls.notes(false))}
      {host && c.mode === 'off' && item('play', 'Turn notes on', () => controls.notes(true))}
      {!host && !on && (asking ? item('x', 'Take back your ask', () => controls.ask(false)) : item('hand', 'Ask for notes', () => controls.ask(true)))}
      {!host && <p className="hint">Only {organizerName(state)} can turn notes on, off or pause them. You can ask for them.</p>}
    </Popover>
  );
}

export function NotesView({ session, state, getting, problems, controls, carried, yours, put, onSeek }: {
  session: CallSession;
  state: CallState;
  /** Who gets the notes, as far as you can tell: everyone invited, for the organizer. */
  getting: Person[];
  problems: string[];
  /** Notes on and off, pause and resume (the organizer's), or asking for notes (anyone else's). */
  controls: CaptureControls;
  /** What carries over from earlier calls, for you alone, when there's anything of yours. */
  carried?: ReactNode;
  /** Your own notes, at the foot: only for someone with an account in the call. */
  yours?: ReactNode;
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
  const asking = !host && c.asked?.state === 'asking';
  const organizer = organizerName(state);
  const live = state.liveNotes;
  const n = live.notes;
  const written = useLive(session.followUps);
  useEffect(() => session.watchFollowUps(), [session]);
  /* What people added comes first in nothing: it's listed among what was said, and there may be no notes for it to go with yet. */
  const any = n !== null || live.added.length > 0 || live.suggestions.length > 0 || (written?.items.length ?? 0) > 0;
  const held = state.breakouts.held;
  const ask = asking
    ? <Button size="sm" variant="quiet" onClick={() => controls.ask(false)}>Take it back</Button>
    : <Button variant="primary" size="sm" icon="hand" onClick={() => controls.ask(true)}>Ask for notes</Button>;
  return (
    <>
      <div className="ic-scroll">
        <div className="ic-nh">
          <CaptureSign mode={here.mode} requested={!on && c.requests.length > 0} />
          <span className="m">{unavailable ? 'Nothing is being captured' : notesAreOn(here.mode) ? 'Written as people talk' : pausedHere ? 'Nothing is written down' : state.notes.everOn ? 'What was written is kept' : 'Nothing is being written down'}</span>
          <NotesMenu state={state} controls={controls} />
        </div>
        {carried}
        {on && state.isHost && !host && c.room && (
          <div className="ic-problems is-top"><Notice tone="caution" icon="alert">You’re hosting from a breakout room, so nobody’s browser hears the main room for the notes until everyone is back.</Notice></div>
        )}
        {unavailable && any && (
          <div className="ic-problems is-top"><Notice tone="caution" icon="alert">{c.room ? ROOM_UNHEARD : c.away
            ? `${notesBrowser(state)} isn’t in the call right now, so nothing new is captured until it’s back.`
            : `${notesBrowser(state)} can’t record or listen right now, so nothing new is captured.${state.isHost ? ' Everyone can see that.' : ''}`}</Notice></div>
        )}
        {pausedHere && any && (
          <div className="ic-problems is-top"><Notice icon="pause">{roomHeld ? ROOM_PAUSED : <>Paused{c.recording.since ? ` at ${hm(c.recording.since)}` : ''}. Nothing is recorded, transcribed or sent to the AI until {host ? 'you resume' : `${organizer} resumes`}.</>}</Notice></div>
        )}
        {(problems.length > 0 || live.error) && (
          <div className="ic-problems is-top">{[...problems, ...(live.error ? [live.error] : [])].map((p) => <Notice key={p} tone="caution">{p}</Notice>)}</div>
        )}
        {roomHeld && !any ? (
          <EmptyState title="Notes are paused in this room" className="ic-empty">Nothing said here is transcribed until the organizer resumes.</EmptyState>
        ) : paused && !any ? (
          <EmptyState title="Notes are paused" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" icon="play" onClick={controls.resume}>Resume notes</Button> : ask}>
            {host ? 'Nothing is recorded, transcribed or sent to the AI until you resume.' : asking ? `You asked ${organizer} to resume them.` : `Nothing is recorded, transcribed or sent to the AI until ${organizer} resumes.`}
          </EmptyState>
        ) : c.mode === 'off' && !any ? (
          <EmptyState title="Notes are off" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" onClick={() => controls.notes(true)}>Turn notes on</Button> : ask}>
            {host ? 'Nothing from this call is being written down. Notes pick up from the moment you turn them on.' : asking ? `You asked ${organizer} for notes.` : `Only ${organizer} can turn them on. You can ask them to.`}
          </EmptyState>
        ) : unavailable && !any ? (
          <EmptyState title="Nothing is being captured" className="ic-empty">
            {c.room ? 'Nobody’s browser in this room can transcribe it right now. Notes pick up as soon as one can.' : c.away ? `${notesBrowser(state)} isn’t in the call right now. Notes pick up as soon as it’s back.`
              : `${notesBrowser(state)} can’t record or listen right now.${state.isHost ? ' Everyone can see that.' : ''} Notes pick up as soon as it can.`}
          </EmptyState>
        ) : !any ? (
          <EmptyState title={live.writing ? 'Writing the first notes' : 'Listening'} className="ic-empty">
            {state.transcript.length ? 'Decisions, follow-ups and a summary appear here in a moment.' : 'Decisions, follow-ups and a summary appear here as people talk.'}
          </EmptyState>
        ) : (
          <div className="ic-nb">
            <div><div className="ic-sh"><span className="ac-eyebrow">Decided</span><span className="n">{n?.decided.length ?? 0}</span></div>
              {n?.decided.length ? <DecidedRows items={n.decided} times={callTimes(state.startedAt)} onSeek={onSeek} put={put} /> : <p className="ic-quiet">Nothing decided yet.</p>}</div>
            <div><div className="ic-sh"><span className="ac-eyebrow">Follow-ups</span></div>
              <CallFollowUps key={state.capture.room?.id ?? 'main'} session={session} compact put={put} onSeek={onSeek} people={getting} /></div>
            {held.length > 0 && (
              <div><div className="ic-sh"><span className="ac-eyebrow">From the rooms</span><span className="n">{held.reduce((k, h) => k + h.rooms.length, 0)}</span></div>
                {held.map((h) => (
                  <div key={h.from} className="ic-rgrp">
                    {h.rooms.map((r) => <div key={r.id} className="rn">{r.name}<span>{r.people.length}</span><Faces people={r.people} size={16} /></div>)}
                    <p className="ic-quiet">{clock(h.from)} to {clock(h.to)}. Each room’s talk goes into the call’s notes as its own section.</p>
                  </div>
                ))}
              </div>
            )}
            <div><div className="ic-sh"><span className="ac-eyebrow">Summary</span></div>{n?.summary ? <Summary text={n.summary} /> : <p className="ic-quiet">Nothing to sum up yet.</p>}</div>
            {(n?.read.whileHere || (on && (n || live.writing))) && (
              <div className="ic-about">
                {n?.read.whileHere && <div className="ic-writing"><Icon name="lock" size={13} />Only what was said while you were here.</div>}
                {on && <div className="ic-writing">{live.writing ? <><Dots />Writing as people talk</> : n && <><Icon name="clock" size={13} />Updated from {n.read.lines} {n.read.lines === 1 ? 'line' : 'lines'} of the transcript</>}</div>}
              </div>
            )}
          </div>
        )}
        {yours}
      </div>
      <Foot wrap end={getting.length ? <span title={`Notes go to ${listNames(getting)}`}><Faces people={getting} size={18} max={3} /></span> : undefined}>Confidential compute · everyone invited gets the notes</Foot>
    </>
  );
}

/* ---------- transcript ---------- */

export function TranscriptView({ state, me, onMark, put }: { state: CallState; me: string | undefined; onMark?: ((lineId: string) => void) | undefined; put?: LivePut | null | undefined }) {
  // What's said where you are: in a breakout room, the room's lines, under the room's capture.
  const c = captureHere(state.capture);
  const mode = c.mode;
  const on = notesAreOn(mode);
  const roomHeld = state.capture.room !== null && mode === 'paused' && state.capture.mode !== 'paused';
  return (
    <>
      <div className="ic-tr">
        {c.transcript.mode === 'unavailable' && (
          <Notice tone="caution" icon="alert">
            {state.capture.room ? ROOM_UNHEARD : `${notesBrowser(state)} can’t listen right now, so nothing new is transcribed.`}
          </Notice>
        )}
        {mode === 'paused' && <Notice icon="pause">{roomHeld ? ROOM_PAUSED : 'Notes are paused. Nothing new is transcribed until they resume.'}</Notice>}
        {mode === 'off' && <Notice icon="notesPen">{state.notes.everOn ? 'Notes are off. Nothing new is written down until they’re back on.' : 'Notes are off, so nothing is being transcribed.'}</Notice>}
        {state.transcript.length ? <CallLines lines={state.transcript} gaps={c.gaps} me={me} onMark={onMark} quote={put ? { target: put.target, onQuote: put.line } : null} when={(at) => lineClock(state, at)} /> : on && (
          <EmptyState title="Nothing said yet" className="ic-empty">
            {!state.capture.room ? 'What’s said appears here a few seconds later.'
              : state.capture.room.scribe ? `What’s said here appears a few seconds later, transcribed by ${roomScribe(state)} for this room’s section of the notes.`
                : 'What’s said here appears once a browser in this room can transcribe it.'}
          </EmptyState>
        )}
      </div>
      <Foot wrap>{state.capture.room ? 'Confidential compute · this room’s section of the notes' : 'Confidential compute · everyone invited gets the notes'}</Foot>
    </>
  );
}

/* ---------- chat ---------- */

/**
 * Chat, decrypted in this browser. Who sent each message comes from the call's encryption; their name, from
 * the people here. Each part of the call (the main room, each breakout room) has its own chat, readable only by
 * the people in it: the view marks where the conversation moved, and chat sent somewhere before you got there
 * can't be read here, which the view says. Hovering a message (or reaching it with the keyboard) offers a reaction;
 * pressing one under it adds yours, or takes it back.
 */
/* ---------- people ---------- */

/**
 * One person's menu: how loud they are for you (your playback only), and the organizer's controls: mute (they
 * unmute themselves) and remove (they can come back unless the call is locked).
 */
function PersonMenu({ p, host, volumes }: { p: PanelPerson; host: HostControls | undefined; volumes: VolumeActions | undefined }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const name = callName(p.person);
  const run = (f: () => Promise<void>, done: string) => () => {
    setOpen(false);
    f().then(() => toast(done, { icon: 'check' }), (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const volume = p.volume !== null && volumes ? <VolumeControl name={name} level={p.volume} onChange={(v) => volumes.set(p.id, v)} onToggle={() => volumes.toggle(p.id)} /> : null;
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" label={`Options for ${name}`} className="ic-menu"
      anchor={<button type="button" className="ac-icon-btn ic-pmore" aria-label={`Options for ${name}`} title={`Options for ${name}`}><Icon name="more" size={18} /></button>}>
      <div className="mh"><Avatar person={p.person} size={22} /><b>{p.person.name}</b></div>
      {volume}
      {host && (
        <>
          {volume && <div className="ic-msep" />}
          {p.mic && <button type="button" className="mi" onClick={run(() => host.mute(p.id), `${name} is muted. Only they can unmute.`)}><Icon name="micOff" size={17} /><span className="t">Mute their microphone</span><Scope everyone>Everyone</Scope></button>}
          <button type="button" className="mi" onClick={run(() => host.remove(p.id), host.locked ? `${name} is out of the call.` : `${name} is out of the call. They can join again with the link unless you lock it.`)}><Icon name="leave" size={17} /><span className="t">Remove from the call</span></button>
          <p className="hint">{p.mic ? 'Only they can unmute themselves.' : 'Their microphone is off.'}</p>
        </>
      )}
    </Popover>
  );
}

export function PeopleView({ here, invited, asking, invites = false, ringing, canRing, onRing, onStopRing, notesAsks, rooms, host, foot, volumes, together }: {
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
  /** The organizer's controls; absent for everyone else. */
  host?: HostControls | undefined;
  /** What the footer says: how the call is kept private. */
  foot: ReactNode;
  /** How loud someone is for you: your own playback only. */
  volumes?: VolumeActions | undefined;
}) {
  const away = invited.filter((g) => !here.some((p) => sameEmail(p.person, g)) && !ringing.some((r) => sameEmail(r.person, g)));
  const now = Date.now();
  const roomsSaid = useId();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = (id: string, f: (id: string) => Promise<void>) => {
    setBusy(id);
    f(id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setBusy(null));
  };
  return (
    <>
      <div className="ic-scroll ic-pad">
        {host && asking.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h">Asking to join · {asking.length}</div>
            {asking.map((w) => (
              <div key={w.id} className="ic-prow is-asking">
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
        {notesAsks}
        {rooms && (
          <button type="button" className="ic-roomsrow" aria-label="Breakout rooms" aria-describedby={roomsSaid} onClick={rooms.onOpen}>
            <Icon name="door" size={20} />
            <span className="min-w-0"><b>Breakout rooms</b><small id={roomsSaid}>{rooms.open ? 'Rooms are open' : 'Split the call into rooms for a while'}</small></span>
            <Icon name="chevron" size={16} />
          </button>
        )}
        <div className={cn('ac-eyebrow ic-cap-h', ((host && asking.length > 0) || Boolean(notesAsks) || Boolean(rooms)) && 'mt')}>In this call · {here.length}</div>
        {here.map((p) => (
          <div key={p.id} className="ic-prow">
            <Avatar person={p.person} size={36} />
            <div className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{(!p.isMe && together?.where[p.id]) || (p.tags.length ? p.tags.join(' · ') : p.detail)}</small></div>
            <div className="st">
              {together?.following === p.id
                ? <Button size="xs" variant="quiet" onClick={together.onStop}>Following</Button>
                : together?.followable.includes(p.id) && <Button size="xs" onClick={() => together.onFollow(p.id)}>Follow</Button>}
              {p.hand && <Icon name="hand" size={16} />}
              {p.speaking && p.mic && <span className="ac-level" aria-label="Speaking"><i /><i /><i /></span>}
              {!p.mic && <Icon name="micOff" size={16} aria-label="Microphone off" />}
              {p.volume === 0 && <Icon name="speakerOff" size={16} aria-label="Muted for you" />}
              {!p.isMe && (host || (p.volume !== null && volumes)) && <PersonMenu p={p} host={host} volumes={volumes} />}
            </div>
          </div>
        ))}
        {ringing.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h mt">Ringing · {ringing.length}</div>
            {ringing.map((r) => {
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
        {host && (
          <div className="ic-lock">
            <Icon name="lock" size={17} />
            <div className="min-w-0"><b>Lock the call</b><small>{host.locked ? 'Nobody new can join. People who leave can’t come back.' : 'Nobody new can join while it’s locked.'}</small></div>
            <Switch checked={host.locked} label="Lock the call" onChange={(on) => { host.lock(on).then(() => toast(on ? 'The call is locked. Nobody new can join.' : 'The call is unlocked', { icon: 'lock' }), (e: unknown) => toast(errorMessage(e), { icon: 'x' })); }} />
          </div>
        )}
        {host && (
          <div className="ic-lock">
            <Icon name={host.pointing ? 'pointer' : 'pointerOff'} size={17} />
            <div className="min-w-0"><b>Pointing at shared screens</b><small>{host.pointing ? 'Anyone here can point and mark, unless whoever shares says only they can.' : 'Nobody can point at or mark what’s shared.'}</small></div>
            <Switch checked={host.pointing} label="Pointing at shared screens" onChange={(on) => { host.setPointing(on).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); }} />
          </div>
        )}
      </div>
      <Foot icon="lock" wrap>{foot}</Foot>
    </>
  );
}
