/* The call's own pages at the top of the list: Notes, Follow-ups, Transcript. And what's left of them on the note. */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { EmptyState } from '../empty';
import { Icon } from '../icon';
import { Dots } from '../motion';
import { Avatar, type AvatarPerson } from '../people';
import { Button } from '../primitives';
import { WsArch } from './document';
import { useMove } from './shared';

/** What goes on the page, like `WsPage` for a document. */
function LivePage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="wl"><h1 className="wl-t">{title}</h1>{children}</div>;
}

/** Rows that slide in as they're written, 240 ms. What's there already doesn't move. */
function Written({ children }: { children: ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

/** Sending something into the document you were last in. `target` is its name, and without `put` the arrows don't show. */
export interface WsPut { target: string; onPut: (id: string) => void }

/** The arrow beside a line that sends it into a document. `target` is what the document's called. */
export function WsPutArrow({ verb, target, onPut }: { verb: 'Add to' | 'Quote in'; target: string; onPut: () => void }) {
  const label = `${verb} ${target}`;
  return <button type="button" className="ws-put" aria-label={label} title={label} onClick={onPut}><Icon name="cornerRight" size={14} /></button>;
}
const Put = ({ id, verb, put }: { id: string; verb: 'Add to' | 'Quote in'; put: WsPut }) => <WsPutArrow verb={verb} target={put.target} onPut={() => put.onPut(id)} />;

/** Something decided in the call. `at`: when, as the time of day. */
export interface WsDecision { id: string; text: string; at: string }

/** A to-do from this call, said out loud or written in a document. */
export interface WsFollowUp {
  id: string; text: string; done: boolean;
  /** Who it's for, when anyone said. */
  person: AvatarPerson | null;
  /** Their first name. */
  name: string;
  /** When it's due, in words: Today, Fri 6 Nov, No date. */
  due: string;
  /** Where it came from: Said at 14:12, Launch plan, Said at 14:16 · Agenda · 5 Nov, Added by hand. */
  source: string;
  /** Opens the line it came from, when it came from a document. */
  onSource?: (() => void) | undefined;
  /** Someone who can read this and not change it sees the box and can't press it. */
  locked?: boolean | undefined;
}

function FollowUpRow({ row, onTick, sourced = false }: { row: WsFollowUp; onTick: (id: string) => void; sourced?: boolean | undefined }) {
  const move = useMove();
  return (
    <motion.div className={cn('wl-todo', row.done && 'is-done')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}>
      <button type="button" className="wb-box" role="checkbox" aria-checked={row.done} aria-label="Done" disabled={row.locked} onClick={() => onTick(row.id)}><Icon name="check" size={13} /></button>
      <span className="wl-tx"><span className="wl-w">{row.text}</span>{sourced && (row.onSource ? <button type="button" className="src" onClick={row.onSource}>{row.source}</button> : <span className="src">{row.source}</span>)}</span>
      {row.person && <span className="who"><Avatar person={row.person} size={18} /><span>{row.name}</span></span>}
      <span className="wl-due">{row.due}</span>
    </motion.div>
  );
}

/**
 * Notes, written as people talk: the summary, what's been decided (a time opens the transcript there, an arrow sends the
 * line into a document), and the first follow-ups with a way to all of them. `allFollowUps` is how many there are.
 * `notice` says what's holding the notes back, when something is.
 */
export function WsNotesPage({ summary, decided, followUps, allFollowUps, put, notice, onTime, onTick, onAll }: {
  summary: string; decided: WsDecision[]; followUps: WsFollowUp[]; allFollowUps: number; put?: WsPut | undefined; notice?: ReactNode;
  onTime: (id: string) => void; onTick: (id: string) => void; onAll: () => void;
}) {
  const move = useMove();
  return (
    <LivePage title="Notes">
      <p className="wl-s">Written as people talk, in confidential compute.</p>
      {notice}
      {summary && <p className="wl-sum">{summary}</p>}
      <div className="wl-h"><span className="ac-eyebrow">Decided</span></div>
      <Written>
        {decided.map((d) => (
          <motion.div key={d.id} className="wl-r" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}>
            <span className="mk"><Icon name="check" size={12} /></span><span className="wl-tx">{d.text}</span>
            <button type="button" className="wl-at" title="Open the transcript here" onClick={() => onTime(d.id)}>{d.at}</button>
            {put && <Put id={d.id} verb="Add to" put={put} />}
          </motion.div>
        ))}
      </Written>
      {decided.length === 0 && <p className="wl-s">Nothing decided yet.</p>}
      <div className="wl-h"><span className="ac-eyebrow">Follow-ups</span>{allFollowUps > 0 && <button type="button" className="wl-all" onClick={onAll}>All {allFollowUps}<Icon name="right" size={13} /></button>}</div>
      <Written>{followUps.map((f) => <FollowUpRow key={f.id} row={f} onTick={onTick} />)}</Written>
      {followUps.length === 0 && <p className="wl-s">Nothing to do yet.</p>}
    </LivePage>
  );
}

/**
 * Follow-ups: everything to do from this call. `mine` filters to yours; `rows` are the ones to show, and the counts are
 * how many there are either way. `draft`, `onDraft` and `onAdd` are the line at the end, and Enter adds it. Left out for
 * someone who can't add one. `notice` says what's holding the notes back.
 */
export function WsFollowUps({ mine, onMine, everyoneCount, mineCount, rows, notice, onTick, draft, onDraft, onAdd }: {
  mine: boolean; onMine: (mine: boolean) => void; everyoneCount: number; mineCount: number; rows: WsFollowUp[]; notice?: ReactNode;
  onTick: (id: string) => void; draft: string; onDraft: (text: string) => void; onAdd?: (() => void) | undefined;
}) {
  return (
    <LivePage title="Follow-ups">
      <p className="wl-s">Everything to do from this call, said out loud or written in a document.</p>
      {notice}
      <div className="wl-seg" role="group" aria-label="Whose">
        <button type="button" aria-pressed={!mine} onClick={() => onMine(false)}>Everyone <span>{everyoneCount}</span></button>
        <button type="button" aria-pressed={mine} onClick={() => onMine(true)}>Mine <span>{mineCount}</span></button>
      </div>
      <Written>{rows.map((f) => <FollowUpRow key={f.id} row={f} onTick={onTick} sourced />)}</Written>
      {rows.length === 0 && <p className="wl-s">{mine ? 'Nothing with your name on it yet.' : 'Nothing to do yet.'}</p>}
      {onAdd && (
        <div className="wl-add">
          <Icon name="plus" size={16} />
          <input type="text" placeholder="Add a follow-up" aria-label="Add a follow-up" value={draft} maxLength={300} onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }} />
        </div>
      )}
    </LivePage>
  );
}

/** A line of the transcript. `name` is their first name, `at` the time of day. `flash` glows it, 1.6 s, as a time opened it. */
export interface WsSaid { id: string; person: AvatarPerson; name: string; at: string; text: string; flash?: boolean | undefined }

/**
 * Transcript: the whole call so far, with who's talking right now (`now`) at the end, and their words once they're
 * written. An arrow on a line quotes it into a document. `lines` are the ones that match `query`. `notice` says what's
 * holding the transcript back. Each line carries `data-line`, so what opens it here can bring it into view.
 */
export function WsTranscript({ query, onQuery, lines, now, put, notice }: { query: string; onQuery: (q: string) => void; lines: WsSaid[]; now?: (Omit<WsSaid, 'id' | 'at' | 'text'> & { text?: string | undefined }) | null | undefined; put?: WsPut | undefined; notice?: ReactNode }) {
  const move = useMove();
  return (
    <LivePage title="Transcript">
      <label className="wl-find"><Icon name="search" size={15} /><input type="text" placeholder="Find in the transcript" aria-label="Find in the transcript" value={query} onChange={(e) => onQuery(e.target.value)} /></label>
      {notice}
      <Written>
        {lines.map((l) => (
          <motion.div key={l.id} data-line={l.id} className={cn('wl-line', l.flash && 'is-flash')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}>
            <Avatar person={l.person} size={24} />
            <div className="c"><span className="w"><b>{l.name}</b><span className="ac-time">{l.at}</span></span><p>{l.text}</p></div>
            {put && <Put id={l.id} verb="Quote in" put={put} />}
          </motion.div>
        ))}
      </Written>
      {lines.length === 0 && !now && <p className="wl-s">{query ? 'Nothing said matches that yet.' : 'Nothing said yet.'}</p>}
      {now && (
        <div className="wl-line is-now">
          <Avatar person={now.person} size={24} />
          <div className="c"><span className="w"><b>{now.name}</b><Dots className="ws-dots" /></span>{now.text && <p>{now.text}</p>}</div>
        </div>
      )}
    </LivePage>
  );
}

/**
 * Notes, Follow-ups and Transcript on a call with notes off: they stay in the list and say why they're empty. Only the
 * organizer can turn notes on, so they get `onTurnOn` and everyone else `onAsk`. `organizer` is their first name. Someone
 * who has asked is told so, and `onTakeBack` takes it back.
 */
export function WsNotesOff({ organizer, onTurnOn, onAsk, onTakeBack }: { organizer: string; onTurnOn?: (() => void) | undefined; onAsk?: (() => void) | undefined; onTakeBack?: (() => void) | undefined }) {
  return (
    <div className="wl">
      <EmptyState className="wd-none" title="Notes are off" art={<WsArch />} action={onTurnOn
        ? <Button variant="primary" size="sm" onClick={onTurnOn}>Turn notes on</Button>
        : onTakeBack ? <Button variant="quiet" size="sm" onClick={onTakeBack}>Take it back</Button>
          : onAsk && <Button variant="primary" size="sm" onClick={onAsk}><Icon name="hand" size={15} />Ask {organizer} for notes</Button>}>
        {onTakeBack ? `You asked ${organizer} for notes. Your documents work as usual.` : 'Nothing from this call is being written down. Your documents work as usual.'}
      </EmptyState>
    </div>
  );
}

/** A document worked on in a call. `sub`: who did what, in words, for someone who can open it. */
export interface WsWorkedOnDoc { id: string; name: string; sub: string }

/**
 * On the note after the call, under its own heading among the note's sections: what was worked on, a row for each document
 * that opens it. Show only what the reader can open.
 */
export function WsWorkedOn({ documents, onOpen }: { documents: WsWorkedOnDoc[]; onOpen: (id: string) => void }) {
  return (
    <div className="ws-ndocs">
      {documents.map((d) => <button key={d.id} type="button" className="ws-ndoc" onClick={() => onOpen(d.id)}><Icon name="fileText" size={17} /><span><b>{d.name}</b><small>{d.sub}</small></span><Icon name="right" size={15} /></button>)}
    </div>
  );
}
