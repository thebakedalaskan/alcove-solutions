/*
 * The side panel: notes as the call goes, the transcript, asking about the call, chat and people,
 * one view at a time. It slides in beside the stage and the stage makes room. Notes, the transcript
 * and answers come from what was really said while notes were on; nothing here is invented. Chat is
 * end-to-end encrypted in the browsers (CallSession.crypto); the server only relays it.
 */
import { CALL_CHAT_MAX, clock, errorMessage, notesAreOn, type AnswerPart, type CallAsker, type CallChatMessage, type CallState, type CatchUp, type CatchUpItem, type Person } from '@alcove/api';
import { Avatar, Button, CaptureSign, Dots, EmptyState, Faces, Icon, IconButton, Notice, Popover, Scope, Switch, TimeChip, cn, useToast, type IconName } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gapLabel } from '~/lib/capture';
import { callName, listNames, sameEmail } from '~/lib/people';
import { hm } from '~/lib/time';
import { organizerBrowser, organizerName, type CaptureControls } from './Capture';
import { CallLines } from './LiveLines';
import type { LiveNotes } from './liveNotes';
import type { VolumeActions } from './volume';
import { VolumeControl } from './VolumeControl';

export type PanelView = 'notes' | 'transcript' | 'ask' | 'chat' | 'people' | 'rooms';
const TABS: { v: PanelView; label: string }[] = [
  { v: 'notes', label: 'Notes' }, { v: 'transcript', label: 'Transcript' }, { v: 'ask', label: 'Ask' }, { v: 'chat', label: 'Chat' }, { v: 'people', label: 'People' }
];
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/** A question or catch-up asked in the Ask view, and its answer once it's back. */
export type Asked =
  | { id: number; kind: 'question'; q: string; parts: AnswerPart[] | null; error: string | null }
  | { id: number; kind: 'catch-up'; c: CatchUp | null; error: string | null };

/** Someone shown in the panel: in the call (and how), or invited and not here. `volume`: how loud they are for you, null for yourself. */
export interface PanelPerson { id: string; person: Person; isMe: boolean; organizer: boolean; mic: boolean; hand: boolean; speaking: boolean; volume: number | null; detail: string; tags: string[] }

/** The organizer's controls in People. Mute has no remote unmute; removing only disconnects; a locked call keeps everyone new out. */
export interface HostControls {
  admit: (id: string) => Promise<void>;
  deny: (id: string) => Promise<void>;
  mute: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  locked: boolean;
  lock: (on: boolean) => Promise<void>;
}

export function SidePanel({ view, onView, onClose, children, roomsTitle }: { view: PanelView; onView: (v: PanelView) => void; onClose: () => void; children: ReactNode; roomsTitle: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      {view === 'rooms' ? (
        <div className="ic-side-head"><span className="ttl">{roomsTitle}</span><IconButton icon="x" label="Close the panel" onClick={onClose} /></div>
      ) : (
        <div className="ic-side-head">
          <div className="ac-tabs" role="tablist" aria-label="Call panel">
            {TABS.map((t) => <button key={t.v} type="button" role="tab" className="ac-tab" aria-selected={view === t.v} onClick={() => onView(t.v)}>{t.label}</button>)}
          </div>
          <IconButton icon="x" label="Close the panel" onClick={onClose} />
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

function NoteRows({ items, kind, onSeek }: { items: CatchUpItem[]; kind: 'decided' | 'next'; onSeek: (at: number) => void }) {
  return (
    <>
      {items.map((it) => (
        <motion.div key={`${it.at ?? 'x'}-${it.text}`} className="ic-nr" layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
          {kind === 'next' && it.owner ? <span className="mk av"><Avatar person={{ name: it.owner }} size={18} /></span> : <span className="mk"><Icon name="check" size={12} /></span>}
          <div>
            {it.text}
            {kind === 'next' && (it.owner || it.due) && (
              <div className="meta">{it.owner}{it.due && <span className="nr-due"><Icon name="cal" size={11} />{it.due}</span>}</div>
            )}
          </div>
          {it.at !== undefined ? <TimeChip seconds={it.at} onSeek={onSeek} /> : <span />}
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

export function NotesView({ state, live, getting, problems, controls, onSeek, onTranscript }: {
  state: CallState; live: LiveNotes;
  /** Who gets the notes, as far as you can tell: everyone invited, for the organizer. */
  getting: Person[];
  problems: string[];
  /** Notes on and off, pause and resume (the organizer's), or asking for notes (anyone else's). */
  controls: CaptureControls;
  onSeek: (at: number) => void; onTranscript: () => void;
}) {
  const c = state.capture;
  const on = notesAreOn(c.mode);
  const paused = c.mode === 'paused';
  const host = state.isOrganizer;
  const asking = !host && c.asked?.state === 'asking';
  const organizer = organizerName(state);
  const [menu, setMenu] = useState(false);
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
        <CaptureSign mode={c.mode} requested={!on && c.requests.length > 0} />
        <span className="m">{c.mode === 'unavailable' ? 'Nothing is being captured' : on ? 'Written as people talk' : paused ? 'Nothing is written down' : state.notes.everOn ? 'What was written is kept' : 'Nothing is being written down'}</span>
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
        {c.mode === 'unavailable' && n && (
          <div className="ic-problems is-top"><Notice tone="caution" icon="alert">{c.away
            ? `${organizerBrowser(state)} isn’t in the call right now, so nothing new is captured until it’s back.`
            : `${organizerBrowser(state)} can’t record or listen right now, so nothing new is captured.${host ? ' Everyone can see that.' : ''}`}</Notice></div>
        )}
        {paused && n && (
          <div className="ic-problems is-top"><Notice icon="pause">Paused{c.recording.since ? ` at ${hm(c.recording.since)}` : ''}. Nothing is recorded, transcribed or sent to the AI until {host ? 'you resume' : `${organizer} resumes`}.</Notice></div>
        )}
        {paused && !n ? (
          <EmptyState title="Notes are paused" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" icon="play" onClick={controls.resume}>Resume notes</Button> : ask}>
            {host ? 'Nothing is recorded, transcribed or sent to the AI until you resume.' : asking ? `You asked ${organizer} to resume them.` : `Nothing is recorded, transcribed or sent to the AI until ${organizer} resumes.`}
          </EmptyState>
        ) : c.mode === 'off' && !n ? (
          <EmptyState title="Notes are off" className="ic-empty"
            action={host ? <Button variant="primary" size="sm" onClick={() => controls.notes(true)}>Turn notes on</Button> : ask}>
            {host ? 'Nothing from this call is being written down. Notes pick up from the moment you turn them on.' : asking ? `You asked ${organizer} for notes.` : `Only ${organizer} can turn them on. You can ask them to.`}
          </EmptyState>
        ) : c.mode === 'unavailable' && !n ? (
          <EmptyState title="Nothing is being captured" className="ic-empty">
            {c.away ? `${organizerBrowser(state)} isn’t in the call right now. Notes pick up as soon as it’s back.`
              : `${organizerBrowser(state)} can’t record or listen right now.${host ? ' Everyone can see that.' : ''} Notes pick up as soon as it can.`}
          </EmptyState>
        ) : !n ? (
          <EmptyState title={live.writing ? 'Writing the first notes' : 'Listening'} className="ic-empty">
            {state.transcript.length ? 'Decisions, follow-ups and a summary appear here in a moment.' : 'Decisions, follow-ups and a summary appear here as people talk.'}
          </EmptyState>
        ) : (
          <div className="ic-nb">
            <div><div className="ic-sh"><span className="ac-eyebrow">Decided</span><span className="n">{n.decided.length}</span></div>
              {n.decided.length ? <NoteRows items={n.decided} kind="decided" onSeek={onSeek} /> : <p className="ic-quiet">Nothing decided yet.</p>}</div>
            <div><div className="ic-sh"><span className="ac-eyebrow">Follow-ups</span><span className="n">{n.next.length}</span></div>
              {n.next.length ? <NoteRows items={n.next} kind="next" onSeek={onSeek} /> : <p className="ic-quiet">No follow-ups yet.</p>}</div>
            {held.length > 0 && (
              <div><div className="ic-sh"><span className="ac-eyebrow">From the rooms</span><span className="n">{held.reduce((k, h) => k + h.rooms.length, 0)}</span></div>
                {held.map((h) => (
                  <div key={h.from} className="ic-rgrp">
                    {h.rooms.map((r) => <div key={r.id} className="rn">{r.name}<span>{r.people.length}</span><Faces people={r.people} size={16} /></div>)}
                    <p className="ic-quiet">{clock(h.from)} to {clock(h.to)}. The rooms go into the notes everyone gets.</p>
                  </div>
                ))}
              </div>
            )}
            <div><div className="ic-sh"><span className="ac-eyebrow">Summary</span></div>{n.summary ? <Summary text={n.summary} /> : <p className="ic-quiet">Nothing to sum up yet.</p>}</div>
            {on && <div className="ic-writing">{live.writing ? <><Dots />Writing as people talk</> : <><Icon name="clock" size={13} />Updated from {n.lines} {n.lines === 1 ? 'line' : 'lines'} of the transcript</>}</div>}
          </div>
        )}
        {(problems.length > 0 || live.error) && (
          <div className="ic-problems">{[...problems, ...(live.error ? [live.error] : [])].map((p) => <Notice key={p} tone="caution">{p}</Notice>)}</div>
        )}
      </div>
      <Foot end={getting.length ? <span title={`Notes go to ${listNames(getting)}`}><Faces people={getting} size={18} max={5} /></span> : undefined}>Confidential compute</Foot>
    </>
  );
}

/* ---------- transcript ---------- */

export function TranscriptView({ state, me, hit }: { state: CallState; me: string | undefined; hit: { at: number } | null }) {
  const mode = state.capture.mode;
  const on = notesAreOn(mode);
  return (
    <>
      <div className="ic-tr">
        {state.capture.transcript.mode === 'unavailable' && <Notice tone="caution" icon="alert">{organizerBrowser(state)} can’t listen right now, so nothing new is transcribed.</Notice>}
        {mode === 'paused' && <Notice icon="pause">Notes are paused. Nothing new is transcribed until they resume.</Notice>}
        {mode === 'off' && <Notice icon="notesPen">{state.notes.everOn ? 'Notes are off. Nothing new is written down until they’re back on.' : 'Notes are off, so nothing is being transcribed.'}</Notice>}
        {state.transcript.length ? <CallLines lines={state.transcript} gaps={state.capture.gaps} me={me} hit={hit} /> : on && (
          <EmptyState title="Nothing said yet" className="ic-empty">What’s said appears here a few seconds later.</EmptyState>
        )}
      </div>
      <Foot>Confidential compute · everyone invited gets it</Foot>
    </>
  );
}

/* ---------- ask ---------- */

const SUGGESTED = ['Catch me up', 'What did we decide?', 'Who’s doing what?'];

function CatchCard({ c, onSeek }: { c: CatchUp; onSeek: (at: number) => void }) {
  const list = (title: string, xs: CatchUpItem[]) => xs.length > 0 && (
    <div className="cu-grp"><b>{title}</b><ul>{xs.map((x) => <li key={`${x.at ?? 'x'}-${x.text}`}>{x.text}{x.at !== undefined && <> <TimeChip seconds={x.at} onSeek={onSeek} /></>}</li>)}</ul></div>
  );
  if (!c.lines) return <div className="txt">Nothing was said in the last few minutes.</div>;
  return (
    <>
      {c.summary && <div className="txt">{c.summary}</div>}
      {list('Decided', c.decided)}{list('Suggested, not agreed', c.proposed)}{list('Still open', c.open)}{list('Next', c.next)}
      {c.gaps.length > 0 && <p className="cu-note"><Icon name="pause" size={13} />{c.gaps.slice(0, 3).map(gapLabel).join(' · ')}. Nothing said then is in this.</p>}
    </>
  );
}

export function AskView({ asks, ready, paused, onAsk, onCatchUp, onSeek }: {
  asks: Asked[]; ready: boolean;
  /** Notes are paused: nothing goes to the AI, questions included. */
  paused: boolean;
  onAsk: (q: string) => void; onCatchUp: () => void; onSeek: (at: number) => void;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const busy = asks.some((a) => (a.kind === 'question' ? a.parts === null && !a.error : a.c === null && !a.error));
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [asks]);
  const ask = (q: string) => { if (q === 'Catch me up') onCatchUp(); else onAsk(q); };
  return (
    <>
      <div className="ic-scroll ic-pad">
        <Notice icon="lock"><b>Only you see this.</b> Answers come from what’s been said in this call, nothing else.</Notice>
        <div className="ic-qa">
          {!asks.length && paused && <EmptyState title="Notes are paused" className="ic-empty">Nothing goes to the AI, questions included, until they resume.</EmptyState>}
          {!asks.length && !ready && !paused && <EmptyState title="Nothing to ask about yet" className="ic-empty">Turn notes on and talk for a bit. Answers come from what’s been transcribed.</EmptyState>}
          {asks.map((a) => (
            <div key={a.id} className="ic-qa-item">
              {a.kind === 'question' && <div className="q">{a.q}</div>}
              <motion.div className={cn('a', a.kind === 'catch-up' && 'is-catch')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
                <div className="by"><Icon name={a.kind === 'catch-up' ? 'history' : 'sealed'} size={14} />{a.kind === 'catch-up' ? 'Catch up · only you can see this' : 'From this call · only you'}</div>
                {a.error ? <div className="txt bad">{a.error}</div>
                  : a.kind === 'question' ? (a.parts === null ? <div className="txt ic-writing"><Dots />Reading the call</div> : (
                    <>
                      <div className="txt">{a.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ')}</div>
                      {a.parts.some((p) => p.type === 'cite') && <div className="cites">{a.parts.flatMap((p) => (p.type === 'cite' ? [<TimeChip key={p.at} seconds={p.at} onSeek={onSeek} />] : []))}</div>}
                    </>
                  )) : a.c === null ? <div className="txt ic-writing"><Dots />Reading the last few minutes</div> : <CatchCard c={a.c} onSeek={onSeek} />}
              </motion.div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>
      <form className="ic-foot" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (q && !busy) { ask(q); setText(''); } }}>
        <div className="chips">{SUGGESTED.map((s) => <button key={s} type="button" className="ac-chip" disabled={busy || !ready} onClick={() => ask(s)}>{s}</button>)}</div>
        <div className="inrow">
          <input className="ac-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this call" aria-label="Ask about this call" />
          <button type="submit" className="ac-btn is-primary" aria-label="Ask" disabled={!text.trim() || busy || !ready}><Icon name="sendLine" size={18} /></button>
        </div>
      </form>
    </>
  );
}

/* ---------- chat ---------- */

/**
 * Chat, decrypted in this browser. Who sent each message comes from the call's encryption; their name, from
 * the people here. Chat from before you were let in can't be read here, and the view says so.
 */
export function ChatView({ chat, missed, ready, who, onSend }: {
  chat: CallChatMessage[];
  /** There was chat before you were let in. */
  missed: boolean;
  /** This browser holds the call's keys, so it can send. */
  ready: boolean;
  who: (id: string) => Person;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  /* A message that isn't sent is taken back: say so, and give the text back. */
  const send = (t: string) => {
    setText('');
    void onSend(t).catch((e: unknown) => { toast(errorMessage(e), { icon: 'x' }); setText((now) => now || t); });
  };
  return (
    <>
      <div className="ic-scroll ic-pad">
        {missed && <Notice icon="lock" className="ic-missed">Messages sent before you joined aren’t shown. Only people who were here then can read them.</Notice>}
        {chat.length ? (
          <div className="ic-chat">
            {chat.map((c) => {
              const from = who(c.from);
              return (
                <motion.div key={c.id} className="ic-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
                  <Avatar person={from} size={28} />
                  <div><div className="meta"><b>{c.isMe ? `${callName(from)} (you)` : callName(from)}</b><span className="ac-time">{clock(c.at)}</span></div><p>{c.text}</p></div>
                </motion.div>
              );
            })}
          </div>
        ) : !missed && <EmptyState title="No messages yet" className="ic-empty">Messages are encrypted end to end. Only people in the call can read them.</EmptyState>}
        <div ref={end} />
      </div>
      <form className="ic-foot" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && ready) send(t); }}>
        <div className="inrow">
          <input className="ac-input" value={text} maxLength={CALL_CHAT_MAX} disabled={!ready} onChange={(e) => setText(e.target.value)}
            placeholder={ready ? 'Message everyone' : 'Getting the call’s keys…'} aria-label="Message everyone" />
          <button type="submit" className="ac-btn is-primary" aria-label="Send to everyone" disabled={!ready || !text.trim()}><Icon name="sendLine" size={18} /></button>
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

export function PeopleView({ here, invited, asking, notesAsks, host, foot, volumes }: {
  here: PanelPerson[]; invited: Person[];
  /** People asking to join: only the organizer sees them. */
  asking: CallAsker[];
  /** People asking for notes, for the organizer to answer; shown under those asking to join. */
  notesAsks?: ReactNode;
  /** The organizer's controls; absent for everyone else. */
  host?: HostControls | undefined;
  /** What the footer says: how the call is kept private. */
  foot: ReactNode;
  /** How loud someone is for you: your own playback only. */
  volumes?: VolumeActions | undefined;
}) {
  const away = invited.filter((g) => !here.some((p) => sameEmail(p.person, g)));
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
                <div className="min-w-0"><b>{w.person.name}</b><small>Not invited · joined with the link</small></div>
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
        {away.length > 0 && (
          <>
            <div className="ac-eyebrow ic-cap-h mt">Invited, not here · {away.length}</div>
            {away.map((g) => (
              <div key={g.email} className="ic-prow is-away">
                <Avatar person={g} size={36} />
                <div className="min-w-0"><b>{g.name}</b><small>Gets the notes</small></div>
                <div className="st" />
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
      </div>
      <Foot icon="lock" wrap>{foot}</Foot>
    </>
  );
}
