/*
 * Leaving: one calm sheet whose content changes in place. First the choice. Anyone who doesn't host just leaves.
 * Whoever hosts (the organizer, or someone standing in for them) ends the call for everyone, or leaves and keeps it
 * going with someone else hosting: the best person is chosen already, and Change shows who else could. Once the call
 * has ended, who gets the notes and how they're coming along, until they can be read.
 */
import { errorMessage, firstName, minutesLabel, type NoteProgress, type Person } from '@alcove/api';
import { Avatar, Button, Dots, Faces, Icon, Modal } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { callName, listNames } from '~/lib/people';

const llog = log.child({ component: 'leave' });
const UI = { duration: 0.28, ease: [0.22, 0.8, 0.24, 1] } as const;

export type Ended = { noteId: string | null; duration: number };
/** Someone who could host after you, by participant ID. */
export interface NextHost { id: string; person: Person }

export function LeaveSheet({ open, onOpenChange, title, elapsed, hosting, organizer, standingInFor, next, notes, locked, others, getting, leaving, ended, onEnd, onHandOff, onRead, onHome, inline = false }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; elapsed: number;
  /** You host the call now: leaving ends it for everyone, or hands it to someone. Anyone else just leaves. */
  hosting: boolean;
  /** You organized the call. */
  organizer: boolean;
  /** You're hosting in someone's place: the organizer, by name. */
  standingInFor: string | null;
  /** Who could host after you, best first: people invited who are in the call. */
  next: NextHost[];
  /** Notes have been on at some point, so the call has notes. */
  notes: boolean;
  /** Nobody new can join, so someone who leaves can't come back. */
  locked: boolean;
  /** Anyone else in the call. */
  others: number;
  /** Everyone invited besides you: they get the notes too. */
  getting: Person[];
  leaving: boolean; ended: Ended | null;
  onEnd: () => void; onHandOff: (to: string) => void; onRead: (noteId: string) => void; onHome: () => void;
  /** A floating call has its own document: the same question replaces its picture, without a main-document modal. */
  inline?: boolean | undefined;
}) {
  const reducedMotion = useReducedMotion();
  const reduce = reducedMotion || inline;
  const [progress, setProgress] = useState<NoteProgress | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Who hosts after you: the best person, unless you choose someone else (and they're still here to).
  const [chosen, setChosen] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const pick = next.find((n) => n.id === chosen) ?? next[0] ?? null;
  useEffect(() => { if (!open) { setChoosing(false); setChosen(null); } }, [open]);
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
  // Leaving can keep the call going only for someone hosting with somebody here who can take over.
  const keep = hosting && others > 0 && pick !== null;
  const back = standingInFor ? firstName(standingInFor) : null;
  const said = !hosting ? (locked ? 'The call goes on without you. It’s locked, so you can’t join again unless the host unlocks it.' : 'The call goes on without you. You can join again with the link.')
    : !others ? 'You’re the only one here, so leaving ends the call.'
      : !keep ? `${back ? `You’re hosting while ${back} is away.` : 'You organized this call.'} Nobody else here can host: guests can’t. Leaving ends it for everyone${notes ? ', and the notes go to everyone invited' : ''}.`
        : back ? `You’re hosting while ${back} is away. Someone else can host, or you can end the call for everyone${notes ? ', and the notes go to everyone invited' : ''}.`
          : `You organized this call. End it for everyone${notes ? ', and the notes go to everyone invited' : ''}, or leave it with someone else hosting until you’re back.`;
  // Anyone who doesn't host only leaves: the call goes on without them.
  const endLabel = !hosting ? (leaving ? 'Leaving…' : 'Leave the call') : leaving ? 'Ending the call…' : others ? 'End call for everyone' : 'End the call';
  const endButton = <Button key="end" variant={keep && back ? 'secondary' : 'primary'} loading={leaving && !keep} disabled={leaving} onClick={onEnd} autoFocus={!(keep && back)}>{endLabel}</Button>;
  const keepButton = keep && pick
    ? <Button key="keep" variant={back ? 'primary' : 'secondary'} disabled={leaving} onClick={() => onHandOff(pick.id)} autoFocus={Boolean(back)}>Leave and keep it going</Button>
    : null;
  const change = (o: boolean) => { if (!ended && !leaving) onOpenChange(o); };
  const content = (
      <motion.div layout={!reduce} transition={UI} className="in">
        <AnimatePresence mode="wait" initial={false}>
          {!ended ? (
            <motion.div key="ask" initial={false} exit={{ opacity: 0 }} transition={UI}>
              <div className="ac-eyebrow">{title} · {minutes} min</div>
              <h2 className="ac-display-s">Leave the call?</h2>
              <p>{said}</p>
              {keep && pick && (
                <div className="next-host">
                  <div className="who">
                    <Avatar person={pick.person} size={26} />
                    <span><b>{callName(pick.person)}</b> {back ? `will host until ${back} is back` : 'will host until you’re back'}</span>
                    {next.length > 1 && (
                      <Button variant="quiet" size="sm" className="change" aria-expanded={choosing} disabled={leaving} onClick={() => setChoosing((c) => !c)}>{choosing ? 'Done' : 'Change'}</Button>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {choosing && (
                      <motion.div key="list" className="pick" role="radiogroup" aria-label="Who hosts after you"
                        initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={UI}>
                        {next.map((n) => (
                          <button key={n.id} type="button" role="radio" aria-checked={n.id === pick.id} className="ic-opt"
                            onClick={() => { setChosen(n.id); setChoosing(false); }}>
                            <Avatar person={n.person} size={24} /><span className="nm">{n.person.name}</span><Icon name="check" size={16} className="tick" />
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              <div className="acts">
                {back ? [keepButton, endButton] : [endButton, keepButton]}
                <Button variant="quiet" disabled={leaving} onClick={() => onOpenChange(false)}>Stay in the call</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="ended" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI}>
              <div className="ac-eyebrow">{title} · {minutesLabel(ended.duration)}</div>
              <h2 className="ac-display-s">Call ended</h2>
              {ended.noteId ? (
                <>
                  {!progress?.ready && !failed && <p>Notes will be ready in a minute.</p>}
                  <div className="who">{getting.length > 0 && <Faces people={getting} size={26} max={6} />}<span>{organizer ? (getting.length ? `${listNames(getting)} and you get the notes.` : 'You get the notes.') : 'Everyone invited gets the notes, you included.'}</span></div>
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
  );
  return inline
    ? open && <InlineLeave onStay={() => change(false)}>{content}</InlineLeave>
    : <Modal open={open} onOpenChange={change} placement="bottom" label="Leave the call" className="ic-leave">{content}</Modal>;
}

/** Owns this question's focus within the child document; closing never focuses the opener's document. */
function InlineLeave({ onStay, children }: { onStay: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stay = useRef(onStay);
  stay.current = onStay;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); stay.current(); return; }
      if (event.key !== 'Tab') return;
      const all = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = all[0];
      const last = all.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      const at = root.ownerDocument.activeElement;
      if (event.shiftKey && (at === first || !root.contains(at))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (at === last || !root.contains(at))) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', key);
    return () => root.removeEventListener('keydown', key);
  }, []);
  return <div ref={ref} className="ic-leave" role="dialog" aria-label="Leave the call">{children}</div>;
}
