/*
 * The side panels: notes as the call goes, the transcript, asking about the call (CatchUp.tsx), chat and
 * people, one tab at a time in each panel. A panel slides in and the stage makes room; any tab can be pulled out to
 * be a panel of its own, and panels sit wherever you put them (panels.ts, PanelHost.tsx). Notes, the transcript
 * and answers come from what was really said while notes were on; nothing here is invented. The notes are the
 * call's shared live notes, which come with the call (CallState.liveNotes), so ticking a follow-up is done for everyone
 * there. Chat is end-to-end encrypted in the browsers (CallSession.crypto); the server only relays it.
 */
import { CALL_CHAT_MAX, clock, errorMessage, notesAreOn, type CallAsker, type CallChatMessage, type CallPanelTab, type CallPanelView, type CallState, type CatchUpItem, type LiveFollowUp, type Person, type Rung, type TranscriptMoment } from '@alcove/api';
import { Avatar, Button, CaptureSign, Check, Dots, EmptyState, Faces, Icon, IconButton, Notice, Popover, Scope, Switch, cn, useToast, type IconName } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { rungWords } from '~/features/calls/RingWords';
import { captureHere } from '~/lib/capture';
import { callName, listNames, sameEmail } from '~/lib/people';
import { hm } from '~/lib/time';
import { notesBrowser, organizerName, roomScribe, type CaptureControls } from './Capture';
import { Moments, callTimes, type CallTimes } from './CatchUp';
import { CallLines } from './LiveLines';
import { tabName, useDraft, type Draft } from './PanelHost';
import type { VolumeActions } from './volume';
import { VolumeControl } from './VolumeControl';

export type PanelView = CallPanelView;
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

export function SidePanel({ view, tabs, onView, onClose, children, roomsTitle }: {
  view: PanelView;
  /** The tabs in this panel: dragging one out makes it a panel of its own, and one on its own has its name instead. */
  tabs: CallPanelTab[];
  onView: (v: PanelView) => void; onClose: () => void; children: ReactNode; roomsTitle: string;
}) {
  const reduce = useReducedMotion();
  const [only] = tabs;
  const name = view === 'rooms' ? roomsTitle : tabName(only ?? 'notes');
  return (
    <>
      {view === 'rooms' || tabs.length < 2 ? (
        <div className="ic-side-head"><span className="ttl" data-tab={view === 'rooms' ? undefined : only}>{name}</span><IconButton icon="x" label={view === 'rooms' ? 'Close the panel' : `Close ${name}`} onClick={onClose} /></div>
      ) : (
        <div className="ic-side-head">
          <div className="ac-tabs" role="tablist" aria-label="Call panel">
            {tabs.map((t) => <button key={t} type="button" role="tab" className="ac-tab" aria-selected={view === t} data-tab={t} aria-keyshortcuts="Shift+Enter" title="Click to open, drag out to keep it open" onClick={() => onView(t)}>{tabName(t)}</button>)}
          </div>
          <IconButton icon="x" label={`Close ${tabName(view)}`} onClick={onClose} />
        </div>
      )}
      <div className="ic-views">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.section key={view} className="ic-view" initial={reduce ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : UI}>
            {children}
          </motion.section>
        </AnimatePresence>
      </div>
    </>
  );
}

const Foot = ({ icon = 'sealed', children, end, wrap = false }: { icon?: 'sealed' | 'lock'; children: ReactNode; end?: ReactNode; wrap?: boolean }) => (
  <div className={cn('ic-nf', wrap && 'is-wrap')}><Icon name={icon} size={15} /><span className="lbl">{children}</span>{end && <span className="end">{end}</span>}</div>
);

/* ---------- notes ---------- */

function DecidedRows({ items, times, onSeek }: { items: CatchUpItem[]; times: CallTimes; onSeek: (e: TranscriptMoment) => void }) {
  return (
    <>
      {items.map((it) => (
        <motion.div key={`${it.evidence[0]?.lineId ?? 'x'}-${it.text}`} className="ic-nr" layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
          <span className="mk"><Icon name="check" size={12} /></span>
          <div>{it.text}</div>
          {it.evidence.length ? <Moments evidence={it.evidence.slice(0, 1)} times={times} onOpen={onSeek} /> : <span />}
        </motion.div>
      ))}
    </>
  );
}

/** What people said they'd do. `onTick`: done for everyone in this part of the call; absent for a guest, who doesn't get the notes. */
function FollowUpRows({ items, times, onSeek, onTick }: { items: LiveFollowUp[]; times: CallTimes; onSeek: (e: TranscriptMoment) => void; onTick: ((id: string, done: boolean) => void) | undefined }) {
  return (
    <>
      {items.map((it) => (
        <motion.div key={it.id} className={cn('ic-nr', it.done && 'is-done')} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
          {onTick ? <Check checked={it.done} onChange={(on) => onTick(it.id, on)} label={`Mark done: ${it.text}`} />
            : it.done ? <span className="mk"><Icon name="check" size={12} /></span>
              : it.owner ? <span className="mk av"><Avatar person={{ name: it.owner }} size={18} /></span> : <span className="mk" />}
          <div>
            <span className="tx">{it.text}</span>
            {(it.owner || it.due) && (
              <div className="meta">{it.owner}{it.due && <span className="nr-due"><Icon name="cal" size={11} />{it.due}</span>}</div>
            )}
          </div>
          {it.evidence.length ? <Moments evidence={it.evidence.slice(0, 1)} times={times} onOpen={onSeek} /> : <span />}
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

export function NotesView({ state, getting, problems, controls, carried, onSeek, onTick, onTranscript }: {
  state: CallState;
  /** Who gets the notes, as far as you can tell: everyone invited, for the organizer. */
  getting: Person[];
  problems: string[];
  /** Notes on and off, pause and resume (the organizer's), or asking for notes (anyone else's). */
  controls: CaptureControls;
  /** What carries over from earlier calls, for you alone, when there's anything of yours. */
  carried?: ReactNode;
  onSeek: (e: TranscriptMoment) => void; onTick: (id: string, done: boolean) => void; onTranscript: () => void;
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
  const [menu, setMenu] = useState(false);
  const live = state.liveNotes;
  const n = live.notes;
  const held = state.breakouts.held;
  const item = (icon: IconName, label: string, f: () => void) => (
    <button type="button" className="mi" onClick={() => { setMenu(false); f(); }}><Icon name={icon} size={16} /><span className="t">{label}</span></button>
  );
  const ask = asking
    ? <Button size="sm" variant="quiet" onClick={() => controls.ask(false)}>Take it back</Button>
    : <Button variant="primary" size="sm" icon="hand" onClick={() => controls.ask(true)}>Ask for notes</Button>;
  return (
    <>
      <div className="ic-nh">
        <CaptureSign mode={here.mode} requested={!on && c.requests.length > 0} />
        <span className="m">{unavailable ? 'Nothing is being captured' : notesAreOn(here.mode) ? 'Written as people talk' : pausedHere ? 'Nothing is written down' : state.notes.everOn ? 'What was written is kept' : 'Nothing is being written down'}</span>
        <Popover open={menu} onOpenChange={setMenu} side="bottom" align="end" label="Notes options" className="ic-menu narrow"
          anchor={<button type="button" className="ac-icon-btn" aria-label="Notes options"><Icon name="more" size={18} /></button>}>
          {host && on && item('pause', 'Pause notes', controls.pause)}
          {host && paused && item('play', 'Resume notes', controls.resume)}
          {host && (on || paused) && item('notesPen', 'Turn notes off', () => controls.notes(false))}
          {host && c.mode === 'off' && item('play', 'Turn notes on', () => controls.notes(true))}
          {!host && !on && (asking ? item('x', 'Take back your ask', () => controls.ask(false)) : item('hand', 'Ask for notes', () => controls.ask(true)))}
          {item('transcript', 'Open the transcript', onTranscript)}
          {!host && <p className="hint">Only {organizer} can turn notes on, off or pause them. You can ask for them.</p>}
        </Popover>
      </div>
      <div className="ic-scroll">
        {carried}
        {on && state.isHost && !host && c.room && (
          <div className="ic-problems is-top"><Notice tone="caution" icon="alert">You’re hosting from a breakout room, so nobody’s browser hears the main room for the notes until everyone is back.</Notice></div>
        )}
        {unavailable && n && (
          <div className="ic-problems is-top"><Notice tone="caution" icon="alert">{c.room ? ROOM_UNHEARD : c.away
            ? `${notesBrowser(state)} isn’t in the call right now, so nothing new is captured until it’s back.`
            : `${notesBrowser(state)} can’t record or listen right now, so nothing new is captured.${state.isHost ? ' Everyone can see that.' : ''}`}</Notice></div>
        )}
        {pausedHere && n && (
          <div className="ic-problems is-top"><Notice icon="pause">{roomHeld ? ROOM_PAUSED : <>Paused{c.recording.since ? ` at ${hm(c.recording.since)}` : ''}. Nothing is recorded, transcribed or sent to the AI until {host ? 'you resume' : `${organizer} resumes`}.</>}</Notice></div>
        )}
        {roomHeld && !n ? (
          <EmptyState title="Notes are paused in this room" className="ic-empty">Nothing said here is transcribed until the organizer resumes.</EmptyState>
        ) : paused && !n ? (
          <EmptyState title="Notes are paused" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" icon="play" onClick={controls.resume}>Resume notes</Button> : ask}>
            {host ? 'Nothing is recorded, transcribed or sent to the AI until you resume.' : asking ? `You asked ${organizer} to resume them.` : `Nothing is recorded, transcribed or sent to the AI until ${organizer} resumes.`}
          </EmptyState>
        ) : c.mode === 'off' && !n ? (
          <EmptyState title="Notes are off" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" onClick={() => controls.notes(true)}>Turn notes on</Button> : ask}>
            {host ? 'Nothing from this call is being written down. Notes pick up from the moment you turn them on.' : asking ? `You asked ${organizer} for notes.` : `Only ${organizer} can turn them on. You can ask them to.`}
          </EmptyState>
        ) : unavailable && !n ? (
          <EmptyState title="Nothing is being captured" className="ic-empty">
            {c.room ? 'Nobody’s browser in this room can transcribe it right now. Notes pick up as soon as one can.' : c.away ? `${notesBrowser(state)} isn’t in the call right now. Notes pick up as soon as it’s back.`
              : `${notesBrowser(state)} can’t record or listen right now.${state.isHost ? ' Everyone can see that.' : ''} Notes pick up as soon as it can.`}
          </EmptyState>
        ) : !n ? (
          <EmptyState title={live.writing ? 'Writing the first notes' : 'Listening'} className="ic-empty">
            {state.transcript.length ? 'Decisions, follow-ups and a summary appear here in a moment.' : 'Decisions, follow-ups and a summary appear here as people talk.'}
          </EmptyState>
        ) : (
          <div className="ic-nb">
            <div><div className="ic-sh"><span className="ac-eyebrow">Decided</span><span className="n">{n.decided.length}</span></div>
              {n.decided.length ? <DecidedRows items={n.decided} times={callTimes(state.startedAt)} onSeek={onSeek} /> : <p className="ic-quiet">Nothing decided yet.</p>}</div>
            <div><div className="ic-sh"><span className="ac-eyebrow">Follow-ups</span><span className="n">{n.next.length}</span></div>
              {n.next.length ? <FollowUpRows items={n.next} times={callTimes(state.startedAt)} onSeek={onSeek} onTick={state.role === 'guest' ? undefined : onTick} /> : <p className="ic-quiet">No follow-ups yet.</p>}</div>
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
            <div><div className="ic-sh"><span className="ac-eyebrow">Summary</span></div>{n.summary ? <Summary text={n.summary} /> : <p className="ic-quiet">{n.read.whileHere ? 'It covers more than you were here for, so it isn’t shown.' : 'Nothing to sum up yet.'}</p>}</div>
            {n.read.whileHere && <div className="ic-writing"><Icon name="lock" size={13} />Only what was said while you were here.</div>}
            {on && <div className="ic-writing">{live.writing ? <><Dots />Writing as people talk</> : <><Icon name="clock" size={13} />Updated from {n.read.lines} {n.read.lines === 1 ? 'line' : 'lines'} of the transcript</>}</div>}
          </div>
        )}
        {(problems.length > 0 || live.error) && (
          <div className="ic-problems">{[...problems, ...(live.error ? [live.error] : [])].map((p) => <Notice key={p} tone="caution">{p}</Notice>)}</div>
        )}
      </div>
      <Foot end={getting.length ? <span title={`Notes go to ${listNames(getting)}`}><Faces people={getting} size={18} max={3} /></span> : undefined}>Confidential compute · everyone with the notes</Foot>
    </>
  );
}

/* ---------- transcript ---------- */

export function TranscriptView({ state, me, onMark }: { state: CallState; me: string | undefined; onMark?: ((lineId: string) => void) | undefined }) {
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
        {state.transcript.length ? <CallLines lines={state.transcript} gaps={c.gaps} me={me} onMark={onMark} /> : on && (
          <EmptyState title="Nothing said yet" className="ic-empty">
            {!state.capture.room ? 'What’s said appears here a few seconds later.'
              : state.capture.room.scribe ? `What’s said here appears a few seconds later, transcribed by ${roomScribe(state)} for this room’s section of the notes.`
                : 'What’s said here appears once a browser in this room can transcribe it.'}
          </EmptyState>
        )}
      </div>
      <Foot>{state.capture.room ? 'Confidential compute · this room’s section of the notes' : 'Confidential compute · everyone invited gets it'}</Foot>
    </>
  );
}

/* ---------- chat ---------- */

/**
 * Chat, decrypted in this browser. Who sent each message comes from the call's encryption; their name, from
 * the people here. Each part of the call (the main room, each breakout room) has its own chat, readable only by
 * the people in it: the view marks where the conversation moved, and chat sent somewhere before you got there
 * can't be read here, which the view says.
 */
export function ChatView({ chat, missed, ready, moving, here, placeName, who, draft, onSend }: {
  chat: CallChatMessage[];
  /** There was chat in this part of the call while you weren't in it. */
  missed: boolean;
  /** This browser holds the keys of the part of the call it's in, so it can send. */
  ready: boolean;
  /** On the way to another part of the call: chat is off until it's there. */
  moving: boolean;
  /** Where a message goes, while breakout rooms are open: the room's name, or "the main room". Null when rooms aren't open. */
  here: string | null;
  /** A part of the call's name, for marking where the conversation moved: "Design", "the main room". */
  placeName: (place: string) => string;
  who: (id: string) => Person;
  draft: Draft;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useDraft(draft);
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  /* A message that isn't sent is taken back: say so, and give the text back. */
  const send = (t: string) => {
    setText('');
    void onSend(t).catch((e: unknown) => { toast(errorMessage(e), { icon: 'x' }); draft.text ||= t; setText((now) => now || t); });
  };
  // Marks only matter once the conversation has been in more than one part of the call.
  const marked = new Set(chat.map((c) => c.place)).size > 1;
  const to = here ?? 'everyone';
  return (
    <>
      <div className="ic-scroll ic-pad">
        {missed && <Notice icon="lock" className="ic-missed">Messages sent here before you came aren’t shown. Only people who were here then can read them.</Notice>}
        {chat.length ? (
          <div className="ic-chat">
            {chat.map((c, i) => {
              const from = who(c.from);
              const moved = marked && chat[i - 1]?.place !== c.place;
              return (
                <Fragment key={c.id}>
                  {moved && <div className="ic-chatplace"><span className="ac-eyebrow">In {placeName(c.place)}</span></div>}
                  <motion.div className="ic-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
                    <Avatar person={from} size={28} />
                    <div><div className="meta"><b>{c.isMe ? `${callName(from)} (you)` : callName(from)}</b><span className="ac-time">{clock(c.at)}</span></div><p>{c.text}</p></div>
                  </motion.div>
                </Fragment>
              );
            })}
          </div>
        ) : !missed && (
          <EmptyState title="No messages yet" className="ic-empty">
            {here ? `Messages are encrypted end to end. Only people in ${here} can read them.` : 'Messages are encrypted end to end. Only people in the call can read them.'}
          </EmptyState>
        )}
        <div ref={end} />
      </div>
      <form className="ic-foot" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && ready) send(t); }}>
        <div className="inrow">
          <input className="ac-input" value={text} maxLength={CALL_CHAT_MAX} disabled={!ready} onChange={(e) => setText(e.target.value)}
            placeholder={ready ? `Message ${to}` : moving ? 'Moving to another room…' : 'Getting the call’s keys…'} aria-label={`Message ${to}`} />
          <button type="submit" className="ac-btn is-primary" aria-label={`Send to ${to}`} disabled={!ready || !text.trim()}><Icon name="sendLine" size={18} /></button>
        </div>
      </form>
    </>
  );
}

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

export function PeopleView({ here, invited, asking, invites = false, ringing, canRing, onRing, onStopRing, notesAsks, host, foot, volumes }: {
  here: PanelPerson[]; invited: Person[];
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
  /** The organizer's controls; absent for everyone else. */
  host?: HostControls | undefined;
  /** What the footer says: how the call is kept private. */
  foot: ReactNode;
  /** How loud someone is for you: your own playback only. */
  volumes?: VolumeActions | undefined;
}) {
  const away = invited.filter((g) => !here.some((p) => sameEmail(p.person, g)) && !ringing.some((r) => sameEmail(r.person, g)));
  const now = Date.now();
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
        <div className={cn('ac-eyebrow ic-cap-h', ((host && asking.length > 0) || Boolean(notesAsks)) && 'mt')}>In this call · {here.length}</div>
        {here.map((p) => (
          <div key={p.id} className="ic-prow">
            <Avatar person={p.person} size={36} />
            <div className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{p.tags.length ? p.tags.join(' · ') : p.detail}</small></div>
            <div className="st">
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
