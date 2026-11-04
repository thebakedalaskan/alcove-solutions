/*
 * Shared screens in a note: what was on screen while things were said. Each moment sits among the transcript lines
 * said while it was up; decisions, questions, follow-ups and answers that were about something shown point at it
 * ("On screen"). Opening one shows the frame, the part meant, what the notes model read on it and how legible it was,
 * and plays the call from there. Images come from the API for whoever has the note.
 */
import type { ScreenMoment, ScreenRef } from '@alcove/api';
import { Button, Card, Icon, IconButton, Modal, ScreenLegibility, ScreenMomentCard, ScreenShot } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';
import { spokenName } from '~/lib/people';
import { position } from '~/lib/time';

/** Whose screen and when: "Priya’s screen · 0:42–1:30", or "Your screen" for your own. */
export function screenMeta(m: ScreenMoment, me: string | undefined): string {
  const name = m.presenter ? spokenName(m.presenter, me) : null;
  const whose = !name ? 'A shared screen' : name === 'You' ? 'Your screen' : `${name}’s screen`;
  // The range stays on one line: word joiners either side of the dash.
  const when = m.until - m.at >= 1 ? `${position(m.at)}\u2060–\u2060${position(m.until)}` : position(m.at);
  return `${whose} · ${when}`;
}

/** What's open in the viewer: a moment, and the part of it something pointed at. */
export interface OpenScreen { id: string; region?: number | undefined }
/** Opens a moment of a note's shared screens, at the part something points at when it does. */
export type ScreenOpener = (s: OpenScreen) => void;

/** A moment among the transcript lines: its thumbnail, what it is, whose and when, and what it shows. */
export function ScreenMomentRow({ noteId, m, me, written, onOpen }: { noteId: string; m: ScreenMoment; me: string | undefined; written: boolean; onOpen: ScreenOpener }) {
  return (
    <ScreenMomentCard src={api.notes.screenUrl(noteId, m.id)} width={m.width} height={m.height} title={m.title} meta={screenMeta(m, me)}
      description={m.description || undefined} legible={written ? m.legible : undefined} onOpen={() => onOpen({ id: m.id })} />
  );
}

/** Where something in the notes was on a shared screen: plainly, or only maybe. Opens the frame at the part meant. */
export function ScreenRefChip({ screen, screens, onOpen }: { screen: ScreenRef; screens: ScreenMoment[]; onOpen: ScreenOpener }) {
  const m = screens.find((x) => x.id === screen.id);
  if (!m) return null;
  const part = screen.region === undefined ? undefined : m.regions[screen.region]?.label;
  const what = `${screen.sure ? 'On screen' : 'Maybe on screen'}${part ? `: ${part}` : ''}`;
  return (
    <button type="button" className="scr-ref" title={`${what}, ${position(m.at)}. Opens what was shown.`} onClick={() => onOpen({ id: m.id, region: screen.region })}>
      <Icon name="monitor" size={13} />{what}<span className="ac-mono">{position(m.at)}</span>
    </button>
  );
}

/**
 * One moment of a note's shared screens, opened: the frame, the part meant outlined, what it is and whose, what the
 * notes say it shows, how legible it was, the text read on it, and the call from there. Arrows move through them.
 */
export function ScreenViewer({ noteId, screens, open, me, onOpen, onClose, onSeek }: {
  noteId: string; screens: ScreenMoment[]; open: OpenScreen | null; me: string | undefined;
  onOpen: ScreenOpener; onClose: () => void; onSeek?: ((s: number) => void) | undefined;
}) {
  const i = open ? screens.findIndex((m) => m.id === open.id) : -1;
  const m = screens[i];
  const prev = screens[i - 1];
  const next = screens[i + 1];
  const [textOpen, setTextOpen] = useState(false);
  useEffect(() => { setTextOpen(false); }, [open?.id]);
  useEffect(() => {
    if (!m) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onOpen({ id: prev.id }); }
      if (e.key === 'ArrowRight' && next) { e.preventDefault(); onOpen({ id: next.id }); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [m, prev, next, onOpen]);
  return (
    <Modal open={!!m} onOpenChange={(o) => { if (!o) onClose(); }} label={m ? `Shared screen: ${m.title || 'untitled'}` : 'Shared screen'} className="scr-view">
      {m && (
        <>
          <div className="scr-h">
            <div className="min-w-0">
              <h2 className="ac-title"><Icon name="monitor" size={17} />{m.title || 'A shared screen'}</h2>
              <p className="ac-mono">{screenMeta(m, me)}</p>
            </div>
            <div className="scr-nav">
              <IconButton icon="left" label="Previous screen" disabled={!prev} onClick={() => prev && onOpen({ id: prev.id })} />
              <IconButton icon="right" label="Next screen" disabled={!next} onClick={() => next && onOpen({ id: next.id })} />
              <IconButton icon="x" label="Close" onClick={onClose} />
            </div>
          </div>
          <div className="scr-body">
            <ScreenShot src={api.notes.screenUrl(noteId, m.id)} alt={m.title ? `${m.title}, as shared` : 'The shared screen'} width={m.width} height={m.height} regions={m.regions} focus={open?.region} />
            {m.description && <p className="scr-desc">{m.description}</p>}
            {m.legible !== 'clear' && (
              <div className="scr-legible"><ScreenLegibility legible={m.legible} /><span>{m.legible === 'partly' ? 'Some of it was too small or blurred to read, so the notes only use what could be.' : m.legible === 'unreadable' ? 'Nothing on it could be read, so the notes don’t say what it showed.' : 'The notes model couldn’t read it, so the notes don’t say what it showed.'}</span></div>
            )}
            {m.text.trim() && (
              <div className="scr-text">
                <button type="button" aria-expanded={textOpen} onClick={() => setTextOpen((o) => !o)}><Icon name="down" size={15} />Text read on it</button>
                {textOpen && <pre>{m.text}</pre>}
              </div>
            )}
          </div>
          <div className="scr-f">
            <span className="ac-mono">{i + 1} of {screens.length}</span>
            {onSeek && <Button variant="secondary" icon="play" onClick={() => { onSeek(m.at); onClose(); }}>Play from {position(m.at)}</Button>}
          </div>
        </>
      )}
    </Modal>
  );
}

/** What was on screen in the call, beside the note: each moment small, with when it was shown. Each opens the frame. */
export function ScreensCard({ noteId, screens, onOpen }: { noteId: string; screens: ScreenMoment[]; onOpen: ScreenOpener }) {
  return (
    <Card title="On screen" aside={<span className="ac-mono">{screens.length}</span>}>
      <div className="scr-list">
        {screens.map((m) => (
          <button key={m.id} type="button" className="scr-item" onClick={() => onOpen({ id: m.id })} aria-label={`Open the screen at ${position(m.at)}: ${m.title || 'untitled'}`}>
            <ScreenShot src={api.notes.screenUrl(noteId, m.id)} alt="" width={m.width} height={m.height} />
            <span><b>{m.title || 'A shared screen'}</b><small className="ac-mono">{position(m.at)}</small></span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/** The viewer's state for a note: which moment is open, if any. */
export function useScreenViewer() {
  const [open, setOpen] = useState<OpenScreen | null>(null);
  return { open, show: setOpen, close: () => setOpen(null) };
}
