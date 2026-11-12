/*
 * What the call suggests be done, under the follow-ups in its Notes panel (FollowUps.tsx): two at a time, each with Add, or
 * Apply for a change to a follow-up, and ×, then "N more suggested". A suggestion goes once it's added or dismissed, and one
 * added is in the checklist above. Nothing else moves or changes its words under someone's pointer or keyboard: while a mouse
 * or pen points at these, a finger is on them or was a moment ago (../layout/touchHold.ts), focus from the keyboard is in
 * them, or a decision is on its way, the rows stay as they were shown, anything new waits behind "N more suggested", and a
 * decision goes with the revision that was shown (useFollowUpReview). They catch up once none of that is so: focus a click
 * leaves behind doesn't hold them, as Chat's questions are held (../layout/ChatQuestions.tsx).
 */
import type { FollowUpReview as Review } from '@alcove/api';
import { Avatar, Button, DURATION, EASE, IconButton, cn, type AvatarPerson } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react';
import { useFollowUpReview, type FollowUpProposal } from '~/features/notes/useFollowUpReview';
import { useTouchHold } from '../layout/touchHold';

/** A suggestion as the panel shows it. `evidence` is the times it was said, which open the transcript there. */
export interface SuggestedFollowUp extends FollowUpProposal {
  /** Whose it would be, with their face, if anyone said. */
  person: AvatarPerson | null;
  /** Their first name. */
  name: string;
  /** When it would be due, in words, if anyone said. */
  when: string | null;
  /** For a change to a follow-up: the follow-up as it is now, in words. */
  was: string | null;
}

/** How many show before "N more suggested". */
const SHOWN = 2;

/**
 * `empty` shows when nothing is suggested. `after` is where focus goes when a decision from the keyboard leaves nothing here
 * to land on.
 */
export function SuggestedFollowUps({ proposals, onReview, empty, after }: {
  proposals: readonly SuggestedFollowUp[]; onReview: (review: Review) => Promise<unknown>;
  empty?: ReactNode; after: RefObject<HTMLElement | null>;
}) {
  const head = useId();
  const reduce = useReducedMotion();
  const { pending, stateOf, review, deciding } = useFollowUpReview(proposals, onReview, 'Changed since you saw it.');
  const region = useRef<HTMLDivElement>(null);
  const rowsById = useRef(new Map<string, HTMLDivElement>());
  const [pointing, setPointing] = useState(false);
  const touch = useTouchHold();
  const [keyed, setKeyed] = useState(false);
  const [kept, setKept] = useState<readonly SuggestedFollowUp[] | null>(null);
  const [all, setAll] = useState(false);
  const [refocus, setRefocus] = useState<{ id: string; at: number; done: boolean | null } | null>(null);
  const [said, setSaid] = useState('');
  /* A decision from the keyboard holds them from when it's made until focus is back among them, as the row it was on has gone. */
  const holding = pointing || touch.held || keyed || deciding || refocus !== null;

  const listed = (kept ?? pending).filter((p) => !stateOf(p).done);
  const waiting = kept ? pending.filter((p) => !kept.some((k) => k.id === p.id)) : [];
  const shown = all ? listed : listed.slice(0, SHOWN);
  const more = listed.length - shown.length + waiting.length;
  const there = listed.length > 0 || waiting.length > 0;

  /* While someone is at the suggestions they stay as they were shown; once they've left, they catch up. */
  useLayoutEffect(() => { setKept((was) => (holding ? was ?? pending : null)); }, [holding]);

  /*
   * A decision from the keyboard keeps focus here: on the row that took the decided one's place, or on that row again. That's
   * the keyboard's focus, and holds them, even where a browser doesn't count focus a script moved as visible.
   */
  useLayoutEffect(() => {
    if (!refocus || refocus.done === null) return;
    const target = refocus.done ? shown[refocus.at] ?? shown[refocus.at - 1] : shown.find((p) => p.id === refocus.id);
    const row = target && rowsById.current.get(target.id);
    (row ?? after.current)?.focus();
    if (row) setKeyed(true);
    setRefocus(null);
  }, [refocus]);

  /* Taking away what had focus moves it without a blur, and with nothing listed there is nothing to point at. */
  useLayoutEffect(() => {
    if (keyed && !region.current?.contains(document.activeElement)) setKeyed(false);
    if (pointing && !region.current) setPointing(false);
  });

  /*
   * They have no scroller of their own: the panel round them scrolls them. While a finger holds them, each scroll of anything
   * they're in, a flick's glide included, keeps them a while longer, as a scroll of a list's own scroller would.
   */
  const { onScroll } = touch;
  useEffect(() => {
    const scrolled = (e: Event) => { if (region.current && e.target instanceof Node && e.target.contains(region.current)) onScroll(); };
    document.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', scrolled, { capture: true });
  }, [onScroll]);

  /* Keyboard focus in them holds them; focus a press leaves behind doesn't, so they catch up once the pointer has left. */
  const focusIn = (e: FocusEvent<HTMLDivElement>) => setKeyed(e.target instanceof Element && e.target.matches(':focus-visible'));
  const focusOut = (e: FocusEvent<HTMLDivElement>) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setKeyed(false); };
  const decide = (p: SuggestedFollowUp, decision: Review['decision'], keyboard: boolean) => {
    const at = shown.findIndex((x) => x.id === p.id);
    if (keyboard) setRefocus({ id: p.id, at, done: null });
    void review(p, decision).then((outcome) => {
      if (outcome?.done) setSaid(`${outcome.text}: ${p.text}`);
      if (!keyboard) return;
      if (outcome) setRefocus({ id: p.id, at, done: outcome.done });
      /* Nothing was decided, as one was on its way already: focus stays where it is. */
      else setRefocus((was) => (was?.id === p.id && was.done === null ? null : was));
    });
  };
  /* "N more suggested" shows the rest, and what arrived since, at the end: pressing it is asking for them. */
  const showMore = () => {
    setAll(true);
    if (kept && waiting.length) setKept([...kept, ...waiting]);
  };
  const move = { duration: reduce ? 0 : DURATION[2], ease: EASE.out };

  return (
    <>
      {there ? (
        <div ref={region} className="nn-sugs" role="group" aria-labelledby={head}
          onPointerEnter={(e) => { if (e.pointerType !== 'touch') setPointing(true); }} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setPointing(false); }}
          {...touch.on} onFocus={focusIn} onBlur={focusOut}>
          <div className="nn-sugh"><span id={head}>Suggested from the call</span></div>
          <AnimatePresence initial={false}>
            {shown.map((p) => {
              const state = stateOf(p);
              return (
                <motion.div key={p.id} ref={(el: HTMLDivElement | null) => { if (el) rowsById.current.set(p.id, el); else rowsById.current.delete(p.id); }}
                  tabIndex={-1} className="nn-row is-sug" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: reduce ? 0 : DURATION[1] } }} transition={move}>
                  <span className="nn-ck is-sug" aria-hidden="true" />
                  <div className="nn-tx">
                    <p>{p.text}</p>
                    {(p.person || p.when || p.evidence) && (
                      <div className="mt">
                        {p.person && <><Avatar person={p.person} size={16} /><span>{p.name}</span></>}
                        {p.when && <span className="due">{p.when}</span>}
                        {p.evidence && <span className="at">{p.evidence}</span>}
                      </div>
                    )}
                    {p.was && <p className="was">Was <s>{p.was}</s></p>}
                  </div>
                  <div className="end">
                    {state.canReview && <>
                      <Button size="xs" loading={state.deciding === 'accept'} disabled={state.deciding !== null} onClick={(e) => decide(p, 'accept', e.detail === 0)}>{p.target ? 'Apply' : 'Add'}</Button>
                      <IconButton icon="x" label={`Dismiss: ${p.text}`} size={15} disabled={state.deciding !== null} onClick={(e) => decide(p, 'dismiss', e.detail === 0)} />
                    </>}
                  </div>
                  {state.status && <p className={cn('status', state.failed && 'is-caution')} role="status">{state.status}</p>}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {more > 0 ? <button type="button" className="nn-more" onClick={showMore}>{more} more suggested</button>
            : all && listed.length > SHOWN && <button type="button" className="nn-more" onClick={() => setAll(false)}>Show fewer</button>}
        </div>
      ) : empty}
      <p className="sr-only" role="status">{said}</p>
    </>
  );
}
