/*
 * The head of a call's page, on its slim band of sky: the way back to Calls and what can be done with the call at the right
 * (Share, Download, More), then its title and one line of what's worth knowing at a glance, the faces of who has the notes
 * opening who each is and how they got them. What happened to a call that's gone sits on the same evening.
 */
import type { Recipient } from '@alcove/api';
import { Button, Evening, Faces, Icon, IconButton, Popover, buttonClass } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Recipients } from './parts';

/** The head of a call: the way back, `acts` at the right, then its `title`, with `children` the line under it. */
export function CallHead({ title, back = 'Calls', acts, children }: { title: string; back?: 'Calls' | 'Home' | undefined; acts?: ReactNode; children?: ReactNode }) {
  return (
    <header className="cd-head" style={{ '--d': 0 }}>
      <div className="cd-bar">
        <Link to={back === 'Home' ? '/home' : '/calls'} className="cd-back"><Icon name="left" size={17} />{back}</Link>
        {acts && <div className="cd-acts">{acts}</div>}
      </div>
      <h1 className="cd-title" title={title}>{title}</h1>
      <div className="cd-meta">{children}</div>
    </header>
  );
}

/** Who was on the call, as the line under the title says it, opening who has the notes and how each got them. */
export function WhoHas({ people, words, recipients, me, fresh }: { people: Parameters<typeof Faces>[0]['people']; words: string; recipients: Recipient[]; me: string | undefined; fresh: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="Who has these notes" className="cd-who-pop"
      anchor={<button type="button" className="cd-whobtn" aria-haspopup="dialog"><Faces people={people} size={22} max={5} /><span>{words}</span></button>}>
      <Recipients recipients={recipients} me={me} fresh={fresh} />
    </Popover>
  );
}

/** What More offers. Each is only there when it applies. */
export interface MoreActs {
  /** Pin to the side panel, or take it off. */
  pin?: { on: boolean; toggle: () => void } | undefined;
  /** Copy as text, once the notes are written. */
  copy?: (() => void) | undefined;
  /** Meet again: scheduling with the same people and name. */
  again?: (() => void) | undefined;
  /** The call's own Google Drive exports. */
  drive?: (() => void) | undefined;
  /** Write the notes again, for the organizer. */
  rewrite?: (() => void) | undefined;
}

/**
 * More: pinning, copying the notes, meeting again, Google Drive and writing them again, then deleting them, or taking them out
 * of yours. Going through with that asks in the same popover, and says what goes.
 */
export function CallMore({ acts, mine, removable = true, inCall, ask, busy, gone, onDelete }: {
  acts: MoreActs; mine: boolean; removable?: boolean | undefined; inCall: boolean; ask: string; busy: boolean; gone: boolean; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const opened = (o: boolean) => { setOpen(o); if (!o) setSure(false); };
  const item = (icon: Parameters<typeof Icon>[0]['name'], label: string, small: string | undefined, go: () => void) => (
    <button type="button" className="ac-pop-item" onClick={() => { opened(false); go(); }}><Icon name={icon} size={18} /><span><b>{label}</b>{small && <small>{small}</small>}</span></button>
  );
  return (
    <Popover open={open && !gone} onOpenChange={opened} align="end" label={sure ? (mine ? 'Delete these notes' : 'Remove these notes') : 'More'} tip="More" className={sure ? 'cd-del' : 'cd-more-pop'}
      anchor={<IconButton icon="more" label="More" title={undefined} />}>
      {sure ? (
        <div role="alertdialog" aria-label={mine ? 'Delete these notes' : 'Remove these notes'}>
          <h2 className="cd-pop-h">{mine ? 'Delete these notes for everyone?' : 'Remove these notes from yours?'}</h2>
          <p className="cd-pop-p">{ask}</p>
          <div className="cd-pop-f">
            <Button variant="quiet" size="sm" autoFocus onClick={() => opened(false)}>Cancel</Button>
            <Button variant="secondary" size="sm" className="cd-danger" disabled={busy || gone} onClick={onDelete}>{mine ? 'Delete' : 'Remove'}</Button>
          </div>
        </div>
      ) : (
        <>
          {acts.pin && item(acts.pin.on ? 'pinOff' : 'pin', acts.pin.on ? 'Unpin from the side panel' : 'Pin to the side panel', undefined, acts.pin.toggle)}
          {acts.copy && item('copy', 'Copy as text', undefined, acts.copy)}
          {acts.again && item('repeat', 'Meet again', 'With the same people, at a time that works.', acts.again)}
          {acts.drive && item('cloudUpload', 'Google Drive', 'Where this call’s files go.', acts.drive)}
          {acts.rewrite && item('pen', 'Write the notes again', 'From the transcript, with the AI model you choose.', acts.rewrite)}
          {/* A note your team can see isn't yours to remove: it goes when its organizer stops showing it to the team. */}
          {removable && <>
            <div className="ac-pop-sep" />
            <button type="button" className="ac-pop-item" disabled={inCall} onClick={() => setSure(true)}>
              <Icon name="trash" size={18} /><span><b>{mine ? 'Delete notes' : 'Remove from your notes'}</b><small>{inCall ? 'Once the call ends.' : mine ? 'For everyone. Can’t be undone.' : 'Everyone else keeps them.'}</small></span>
            </button>
          </>}
        </>
      )}
    </Popover>
  );
}

/** What's left where a call was: what went, or why it isn't here, and the way back. */
export function GonePage({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <Evening moment="note" className="cd is-gone">
      <div className="cd-bar"><Link to="/calls" className="cd-back"><Icon name="left" size={17} />Calls</Link></div>
      <section className="cd-gone" aria-label={title}>
        <h1>{title}</h1>
        <p>{lead}</p>
        {children}
        <Link to="/calls" className={buttonClass({ variant: 'primary' })}><Icon name="left" size={16} />Back to Calls</Link>
      </section>
    </Evening>
  );
}
