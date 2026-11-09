import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Field } from './app';
import { Icon } from './icon';
import { Select } from './overlay';
import { Button, IconButton } from './primitives';

/** A person's edit, kept separate from the live task until they save it. */
export interface FollowUpValues { text: string; owner: string | null; due: string | null }

export function FollowUpEditor({ value, people, onChange, onSave, onCancel, busy = false, saveLabel = 'Save' }: {
  value: FollowUpValues; people: readonly { email: string; name: string }[];
  onChange: (value: FollowUpValues) => void; onSave: () => void; onCancel: () => void;
  busy?: boolean | undefined; saveLabel?: string | undefined;
}) {
  return (
    <form className="ac-follow-edit" onSubmit={(e) => { e.preventDefault(); if (value.text.trim() && !busy) onSave(); }} onKeyDown={(e) => {
      if (!e.defaultPrevented && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel(); }
    }}>
      <Field label="What needs doing" value={value.text} maxLength={300} autoFocus disabled={busy} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      <div className="ac-follow-fields">
        <Select label="Who it’s for" value={value.owner ?? ''} onChange={(owner) => onChange({ ...value, owner: owner || null })}
          options={[{ value: '', label: 'Nobody yet' }, ...people.filter((p) => p.email).map((p) => ({ value: p.email, label: p.name }))]} disabled={busy} icon="user" />
        <Field label="Due" placeholder="No date" value={value.due ?? ''} maxLength={40} disabled={busy} onChange={(e) => onChange({ ...value, due: e.target.value || null })} />
      </div>
      <div className="ac-follow-buttons"><Button type="submit" size="sm" loading={busy} disabled={!value.text.trim()}>{saveLabel}</Button><Button variant="quiet" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

export interface FollowUpReviewRow {
  id: string; text: string; owner: string | null; due: string | null;
  target: { text: string; owner: string | null; due: string | null } | null;
  evidence?: ReactNode; status?: ReactNode; busy: boolean; canReview: boolean;
}

function SuggestionWords({ text, owner, due }: { text: string; owner: string | null; due: string | null }) {
  return <div className="ac-follow-words"><p>{text}</p><small>{owner ?? 'Nobody yet'} · {due ?? 'No date'}</small></div>;
}

function ProposalRow({ row, onReview }: { row: FollowUpReviewRow; onReview: (id: string, decision: 'accept' | 'dismiss') => void }) {
  const article = useRef<HTMLElement>(null);
  const focused = useRef(false);
  useEffect(() => { if (!row.canReview && focused.current) article.current?.focus({ preventScroll: true }); }, [row.canReview]);
  return <article ref={article} tabIndex={-1} className="ac-follow-proposal" onFocusCapture={() => { focused.current = true; }} onBlurCapture={(e) => {
    if (e.relatedTarget instanceof Node && !article.current?.contains(e.relatedTarget)) focused.current = false;
  }}>
    {row.target && <div className="ac-follow-before"><span>Current</span><SuggestionWords {...row.target} /></div>}
    {row.target && <span className="ac-follow-label">Suggested change</span>}
    <SuggestionWords text={row.text} owner={row.owner} due={row.due} />
    {row.evidence}
    <div className="ac-follow-buttons">
      {row.canReview && <><Button size="xs" loading={row.busy} onClick={() => onReview(row.id, 'accept')}>{row.target ? 'Apply change' : 'Add'}</Button><Button variant="quiet" size="xs" disabled={row.busy} onClick={() => onReview(row.id, 'dismiss')}>Dismiss</Button></>}
      {row.status && <p className="ac-follow-status" role="status">{row.status}</p>}
    </div>
  </article>;
}

/** Review stays in place; the caller fixes its batch and keeps arrivals out of these rows. */
export function FollowUpSuggestions({ count, rows, waiting, onOpen, onClose, onReview }: {
  count: number; rows: readonly FollowUpReviewRow[] | null; waiting: number;
  onOpen: () => void; onClose: () => void; onReview: (id: string, decision: 'accept' | 'dismiss') => void;
}) {
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);
  const quiet = useRef<HTMLParagraphElement>(null);
  const opened = useRef(false);
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (rows && !opened.current) region.current?.focus({ preventScroll: true });
    if (!rows && opened.current) (opener.current ?? quiet.current)?.focus({ preventScroll: true });
    opened.current = rows !== null;
  }, [rows !== null]);
  if (!rows && !count && !visited) return null;
  return (
    <div className="ac-follow-review">
      {!rows ? count ? <Button ref={opener} variant="quiet" size="sm" icon="waveform" aria-expanded={false} aria-controls={id} onClick={() => { setVisited(true); onOpen(); }}>{count} {count === 1 ? 'suggestion' : 'suggestions'} from the call</Button> : <p ref={quiet} tabIndex={-1} className="ac-follow-status">No suggestions waiting.</p> : (
        <section ref={region} tabIndex={-1} id={id} className="ac-follow-batch" aria-label="Suggestions from the call" onKeyDown={(e) => { if (!e.defaultPrevented && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
          <div className="ac-follow-head"><Icon name="waveform" size={16} /><h3>Suggestions from the call</h3><IconButton icon="x" label="Close suggestions" size={16} onClick={onClose} /></div>
          {rows.map((row) => <ProposalRow key={row.id} row={row} onReview={onReview} />)}
          {waiting > 0 && <p className="ac-follow-waiting">{waiting} more {waiting === 1 ? 'suggestion' : 'suggestions'} waiting</p>}
        </section>
      )}
    </div>
  );
}
