/*
 * The side panel: notes as the call goes, the transcript, asking about the call, chat and people,
 * one view at a time. It slides in beside the stage and the stage makes room. Notes, the transcript
 * and answers come from what was really said while notes were on; nothing here is invented.
 */
import { clock, type AnswerPart, type CallState, type CatchUp, type CatchUpItem, type Person } from '@alcove/api';
import { Avatar, Button, Dots, EmptyState, Faces, Icon, IconButton, NotesSign, Notice, Popover, TimeChip, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { callName, listNames, sameEmail } from '~/lib/people';
import { CallLines } from './LiveLines';
import type { LiveNotes } from './liveNotes';

export type PanelView = 'notes' | 'transcript' | 'ask' | 'chat' | 'people' | 'rooms';
const TABS: { v: PanelView; label: string }[] = [
  { v: 'notes', label: 'Notes' }, { v: 'transcript', label: 'Transcript' }, { v: 'ask', label: 'Ask' }, { v: 'chat', label: 'Chat' }, { v: 'people', label: 'People' }
];
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/** A question or catch-up asked in the Ask view, and its answer once it's back. */
export type Asked =
  | { id: number; kind: 'question'; q: string; parts: AnswerPart[] | null; error: string | null }
  | { id: number; kind: 'catch-up'; c: CatchUp | null; error: string | null };

/** Someone shown in the panel: in the call (and how), or invited and not here. */
export interface PanelPerson { id: string; person: Person; isMe: boolean; organizer: boolean; mic: boolean; hand: boolean; speaking: boolean; detail: string; tags: string[] }

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

const Foot = ({ icon = 'sealed', children, end }: { icon?: 'sealed' | 'lock'; children: ReactNode; end?: ReactNode }) => (
  <div className="ic-nf"><Icon name={icon} size={15} /><span className="lbl">{children}</span>{end && <span className="end">{end}</span>}</div>
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

export function NotesView({ state, live, getting, roomPeople, problems, onNotes, onSeek, onTranscript }: {
  state: CallState; live: LiveNotes; getting: Person[];
  /** Who was in a room the call held (by when it opened, and which room), given the invited people the server sent there. */
  roomPeople: (from: number, room: number, invited: Person[]) => Person[];
  problems: string[]; onNotes: (on: boolean) => void; onSeek: (at: number) => void; onTranscript: () => void;
}) {
  const on = state.notes.status === 'on';
  const [menu, setMenu] = useState(false);
  const n = live.notes;
  const held = state.breakouts.held;
  return (
    <>
      <div className="ic-nh">
        {on ? <NotesSign>Notes on</NotesSign> : <span className="ic-off-sign"><Icon name="notesPen" size={13} />Notes off</span>}
        <span className="m">{on ? 'Written as people talk' : state.notes.everOn ? 'What was written is kept' : 'Nothing is being written down'}</span>
        <Popover open={menu} onOpenChange={setMenu} side="bottom" align="end" label="Notes options" className="ic-menu narrow"
          anchor={<button type="button" className="ac-icon-btn" aria-label="Notes options"><Icon name="more" size={18} /></button>}>
          {state.isOrganizer && (
            <button type="button" className="mi" onClick={() => { setMenu(false); onNotes(!on); }}><Icon name={on ? 'pause' : 'play'} size={16} /><span className="t">{on ? 'Turn notes off' : 'Turn notes on'}</span></button>
          )}
          <button type="button" className="mi" onClick={() => { setMenu(false); onTranscript(); }}><Icon name="transcript" size={16} /><span className="t">Open the transcript</span></button>
          {!state.isOrganizer && <p className="hint">Only the organizer can turn notes on or off.</p>}
        </Popover>
      </div>
      <div className="ic-scroll">
        {!on && !n ? (
          <EmptyState title="Notes are off" className="ic-empty"
            action={state.isOrganizer ? <Button variant="primary" size="sm" onClick={() => onNotes(true)}>Turn notes on</Button> : undefined}>
            {state.isOrganizer ? 'Nothing from this call is being written down. Notes pick up from the moment you turn them on.' : 'Only the organizer can turn them on.'}
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
                    {h.rooms.map((r, k) => {
                      const people = roomPeople(h.from, k, r.people);
                      return <div key={r.id} className="rn">{r.name}<span>{people.length}</span><Faces people={people} size={16} /></div>;
                    })}
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
  const on = state.notes.status === 'on';
  return (
    <>
      <div className="ic-tr">
        {!on && <Notice icon="notesPen">{state.notes.everOn ? 'Notes are off. Nothing new is written down until they’re back on.' : 'Notes are off, so nothing is being transcribed.'}</Notice>}
        {state.transcript.length ? <CallLines lines={state.transcript} me={me} hit={hit} /> : on && (
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
      {c.gaps.length > 0 && <p className="cu-note"><Icon name="pause" size={13} />Notes were off for part of this, so that part isn’t here.</p>}
    </>
  );
}

export function AskView({ asks, ready, onAsk, onCatchUp, onSeek }: { asks: Asked[]; ready: boolean; onAsk: (q: string) => void; onCatchUp: () => void; onSeek: (at: number) => void }) {
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
          {!asks.length && !ready && <EmptyState title="Nothing to ask about yet" className="ic-empty">Turn notes on and talk for a bit. Answers come from what’s been transcribed.</EmptyState>}
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

export function ChatView({ state, onSend }: { state: CallState; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.chat.length]);
  return (
    <>
      <div className="ic-scroll ic-pad">
        {state.chat.length ? (
          <div className="ic-chat">
            {state.chat.map((c) => (
              <motion.div key={c.id} className="ic-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
                <Avatar person={c.from} size={28} />
                <div><div className="meta"><b>{c.isMe ? `${callName(c.from)} (you)` : callName(c.from)}</b><span className="ac-time">{clock(c.at)}</span></div><p>{c.text}</p></div>
              </motion.div>
            ))}
          </div>
        ) : <EmptyState title="No messages yet" className="ic-empty">Messages here are seen by everyone in the call.</EmptyState>}
        <div ref={end} />
      </div>
      <form className="ic-foot" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText(''); } }}>
        <div className="inrow">
          <input className="ac-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" aria-label="Message everyone" />
          <button type="submit" className="ac-btn is-primary" aria-label="Send to everyone" disabled={!text.trim()}><Icon name="sendLine" size={18} /></button>
        </div>
      </form>
    </>
  );
}

/* ---------- people ---------- */

export function PeopleView({ here, invited, organizer, onOptions }: { here: PanelPerson[]; invited: Person[]; organizer: Person | undefined; onOptions?: ((id: string) => ReactNode) | undefined }) {
  const away = invited.filter((g) => !here.some((p) => sameEmail(p.person, g)));
  return (
    <>
      <div className="ic-scroll ic-pad">
        <div className="ac-eyebrow ic-cap-h">In this call · {here.length}</div>
        {here.map((p) => (
          <div key={p.id} className="ic-prow">
            <Avatar person={p.person} size={36} />
            <div className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{p.tags.length ? p.tags.join(' · ') : p.detail}</small></div>
            <div className="st">
              {p.hand && <Icon name="hand" size={16} />}
              {p.speaking && p.mic && <span className="ac-level" aria-label="Speaking"><i /><i /><i /></span>}
              {!p.mic && <Icon name="micOff" size={16} aria-label="Microphone off" />}
              {onOptions?.(p.id)}
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
      </div>
      <Foot icon="lock">{organizer ? `Only people ${callName(organizer)} invited can join` : 'Only people invited can join'}</Foot>
    </>
  );
}
