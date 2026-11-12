/*
 * The band of sky above a note or a series: the way back and the title, what can be done with it, and one line of what's
 * worth knowing at a glance. What happened to a note that's gone sits on the same evening.
 */
import { Button, Evening, Icon, IconButton, Popover, buttonClass } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

/** The head of a note or a series: `to` the way back, then its `title`, with `acts` beside it and `children` under it. */
export function PageHead({ to = 'Notes', title, acts, children }: { to?: 'Notes' | 'Home' | undefined; title: string; acts?: ReactNode; children?: ReactNode }) {
  return (
    <header className="nd-head" style={{ '--d': 0 }}>
      <div className="dusk-top">
        <div className="nd-title">
          <Link to={to === 'Home' ? '/home' : '/notes'} className="nd-back">{to}<i aria-hidden="true">/</i></Link>
          <h1 className="ac-clamp-1" title={title}>{title}</h1>
        </div>
        {acts && <div className="nd-acts">{acts}</div>}
      </div>
      <div className="nd-meta">{children}</div>
    </header>
  );
}

/**
 * More: copying the notes, and deleting them or taking them out of yours. Going through with that asks in the same
 * popover, and says what goes.
 */
export function NoteMenu({ ready, mine, inCall, ask, busy, gone, onCopy, onDelete, onWriteAgain }: { ready: boolean; mine: boolean; inCall: boolean; ask: string; busy: boolean; gone: boolean; onCopy: () => void; onDelete: () => void; onWriteAgain?: (() => void) | undefined }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const opened = (o: boolean) => { setOpen(o); if (!o) setSure(false); };
  return (
    <Popover open={open && !gone} onOpenChange={opened} align="end" label={sure ? (mine ? 'Delete these notes' : 'Remove these notes') : 'More'} tip="More" className={sure ? 'nd-del' : 'nd-more-pop'}
      anchor={<IconButton icon="more" label="More" title={undefined} />}>
      {sure ? (
        <div role="alertdialog" aria-label={mine ? 'Delete these notes' : 'Remove these notes'}>
          <h2 className="nd-pop-h">{mine ? 'Delete these notes for everyone?' : 'Remove these notes from yours?'}</h2>
          <p className="nd-pop-p">{ask}</p>
          <div className="nd-pop-f">
            <Button variant="quiet" size="sm" autoFocus onClick={() => opened(false)}>Cancel</Button>
            <button type="button" className="nd-yes nd-danger" disabled={busy || gone} onClick={onDelete}>{mine ? 'Delete' : 'Remove'}</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="ac-pop-item" disabled={!ready} onClick={() => { opened(false); onCopy(); }}>
            <Icon name="copy" size={18} /><span><b>Copy as text</b>{!ready && <small>Once the notes are written.</small>}</span>
          </button>
          {onWriteAgain && (
            <button type="button" className="ac-pop-item" onClick={() => { opened(false); onWriteAgain(); }}>
              <Icon name="pen" size={18} /><span><b>Write the notes again</b><small>From the transcript, with the AI model you choose.</small></span>
            </button>
          )}
          <div className="ac-pop-sep" />
          <button type="button" className="ac-pop-item" disabled={inCall} onClick={() => setSure(true)}>
            <Icon name="trash" size={18} /><span><b>{mine ? 'Delete notes' : 'Remove from your notes'}</b><small>{inCall ? 'Once the call ends.' : mine ? 'For everyone. Can’t be undone.' : 'Everyone else keeps them.'}</small></span>
          </button>
        </>
      )}
    </Popover>
  );
}

/** What's left where a note or a series was: what went, or why it isn't here, and the way back. */
export function GonePage({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <Evening moment="note" className="nd">
      <div className="nd-gonetop"><Link to="/notes" className="nd-back">Notes</Link></div>
      <section className="nd-gone" aria-label={title}>
        <h1>{title}</h1>
        <p>{lead}</p>
        {children}
        <Link to="/notes" className={buttonClass({ variant: 'primary' })}><Icon name="left" size={16} />Back to notes</Link>
      </section>
    </Evening>
  );
}
