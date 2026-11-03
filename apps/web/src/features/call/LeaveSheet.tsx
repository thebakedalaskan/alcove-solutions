/*
 * Leaving: one calm sheet whose content changes in place. First the choice; once the call has
 * ended, who gets the notes and how they're coming along, until they can be read.
 */
import { errorMessage, minutesLabel, type NoteProgress, type Person } from '@alcove/api';
import { Button, Dots, Faces, Icon, Modal } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { listNames } from '~/lib/people';

const llog = log.child({ component: 'leave' });
const UI = { duration: 0.28, ease: [0.22, 0.8, 0.24, 1] } as const;

export type Ended = { noteId: string | null; duration: number };

export function LeaveSheet({ open, onOpenChange, title, elapsed, others, getting, leaving, ended, onEnd, onRead, onHome }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; elapsed: number;
  /** Anyone else in the call. */
  others: number;
  /** Everyone invited besides you: they get the notes too. */
  getting: Person[];
  leaving: boolean; ended: Ended | null;
  onEnd: () => void; onRead: (noteId: string) => void; onHome: () => void;
}) {
  const reduce = useReducedMotion();
  const [progress, setProgress] = useState<NoteProgress | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const noteId = ended?.noteId ?? null;
  useEffect(() => {
    if (!noteId) return;
    let alive = true;
    void (async () => {
      try {
        for await (const p of api.notes.progress(noteId)) { if (!alive) return; setProgress(p); }
      } catch (e) {
        llog.warn('note progress stopped', { err: e, noteId });
        if (alive) setFailed(errorMessage(e));
      }
    })();
    return () => { alive = false; };
  }, [noteId]);

  const minutes = Math.max(1, Math.floor((ended?.duration ?? elapsed) / 60));
  return (
    <Modal open={open} onOpenChange={(o) => { if (!ended && !leaving) onOpenChange(o); }} placement="bottom" label="Leave the call" className="ic-leave">
      <motion.div layout={!reduce} transition={UI} className="in">
        <AnimatePresence mode="wait" initial={false}>
          {!ended ? (
            <motion.div key="ask" initial={false} exit={{ opacity: 0 }} transition={UI}>
              <div className="ac-eyebrow">{title} · {minutes} min</div>
              <h2 className="ac-display-s">Leave the call?</h2>
              <p>{others ? 'You organized this call. Leaving ends it for everyone, and the notes go to everyone invited.' : 'You’re the only one here, so leaving ends the call.'}</p>
              <div className="acts">
                <Button variant="primary" loading={leaving} onClick={onEnd} autoFocus>{leaving ? 'Ending the call…' : others ? 'End call for everyone' : 'End the call'}</Button>
                <Button variant="quiet" disabled={leaving} onClick={() => onOpenChange(false)}>Stay in the call</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="ended" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
              <div className="ac-eyebrow">{title} · {minutesLabel(ended.duration)}</div>
              <h2 className="ac-display-s">Call ended</h2>
              {ended.noteId ? (
                <>
                  <p>Notes will be ready in a minute.</p>
                  <div className="who">{getting.length > 0 && <Faces people={getting} size={26} max={6} />}<span>{getting.length ? `${listNames(getting)} and you get the notes.` : 'You get the notes.'}</span></div>
                  <div className="state" role="status">
                    {failed ? <><Icon name="clock" size={16} /><span>Still writing. They’ll be in Notes when they’re ready.</span></>
                      : progress?.ready ? <motion.span className="ok" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={UI}><Icon name="sealed" size={16} />Notes are ready. Written in confidential compute.</motion.span>
                        : <><Dots />{progress?.steps.find((s) => !s.done)?.label ?? 'Writing in confidential compute'}</>}
                  </div>
                </>
              ) : <p>No notes were taken, so there’s nothing to send.</p>}
              <div className="acts">
                {ended.noteId && <Button variant={progress?.ready ? 'primary' : 'secondary'} onClick={() => { if (ended.noteId) onRead(ended.noteId); }}>{progress?.ready ? 'Read the notes' : 'Open the notes'}</Button>}
                <Button variant={ended.noteId ? 'quiet' : 'primary'} onClick={onHome}>Go to Home</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Modal>
  );
}
