/* Live notes: four people talk on the left; what they decide and who's doing what lands in the notes on the right. */
import { Avatar, Caption, Chip, EASE, Faces, Fit, NoteRow, SealedBadge, useSceneLoop } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { SceneFrame, SceneHead, Tile, WriteIn, box, words, type Rect } from './parts';

interface Line { who: CastId; before: string; mark?: string; after?: string; note?: { kind: 'dec' | 'fol'; text: string; owner?: CastId } }
const LINES: Line[] = [
  { who: 'theo', before: 'Sign-ups are back up since Tuesday’s fix.' },
  { who: 'priya', before: 'Then let’s', mark: 'move the launch to the 18th', after: '.', note: { kind: 'dec', text: 'Launch moves to Thursday 18 November' } },
  { who: 'kofi', before: 'Works for me.', mark: 'I’ll send the new screens by Wednesday', after: '.', note: { kind: 'fol', text: 'Share the updated screens · Wed', owner: 'kofi' } },
  { who: 'maya', before: 'And', mark: 'I’ll brief support on Monday', after: ' so they’re ready.', note: { kind: 'fol', text: 'Brief the support team · Mon', owner: 'maya' } },
  { who: 'theo', before: 'Great.', mark: 'Keep the waitlist open until launch', after: ', then.', note: { kind: 'dec', text: 'The waitlist stays open until launch' } }
];
const SUMMARY = 'Sign-ups recovered after Tuesday’s fix, so the team moved the launch to the 18th. Kofi shares the new screens on Wednesday and Maya briefs support on Monday.';
const PEOPLE: CastId[] = ['theo', 'priya', 'kofi', 'maya'];
const TILE = (id: CastId): Rect => { const i = Math.max(0, PEOPLE.indexOf(id)); return [28 + (i % 2) * 356, 60 + Math.floor(i / 2) * 186, 344, 174]; };

interface State { line: number; take: number; mark: boolean; rows: number[]; summary: 'none' | 'writing' | 'done'; ring: boolean }
const DONE: State = { line: 4, take: 0, mark: true, rows: [1, 2, 3, 4], summary: 'done', ring: true };

function Listening() {
  return <motion.div className="lp-sk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}><div className="grid gap-[7px]"><i /><i /></div><span>Listening…</span></motion.div>;
}

function Rows({ kind, rows, still }: { kind: 'dec' | 'fol'; rows: number[]; still: boolean }) {
  const mine = rows.filter((i) => LINES[i]?.note?.kind === kind);
  return (
    <>
      <AnimatePresence initial={false}>
        {mine.map((i) => {
          const n = LINES[i]?.note;
          if (!n) return null;
          return (
            <motion.div key={i} className="overflow-hidden rounded-[8px]" initial={still ? false : { height: 0, opacity: 0, y: 10, backgroundColor: 'rgba(255,138,91,0.14)' }}
              animate={{ height: 'auto', opacity: 1, y: 0, backgroundColor: 'rgba(255,138,91,0)' }} exit={{ opacity: 0, y: -6, transition: { duration: 0.45, ease: EASE.in } }}
              transition={{ duration: 0.8, ease: EASE.out, backgroundColor: { duration: 1.8, delay: 0.3 } }}>
              <NoteRow owner={n.owner ? CAST[n.owner] : undefined}>{n.text}</NoteRow>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {mine.length === 0 && <Listening />}
    </>
  );
}

export function NotesScene() {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<State>(DONE);
  useSceneLoop(stage, async (c) => {
    for (;;) {
      await c.sleep(3200);
      setS((x) => ({ ...x, rows: [], summary: 'none' }));
      await c.sleep(700);
      for (const [i, l] of LINES.entries()) {
        setS((x) => ({ ...x, line: i, take: x.take + 1, mark: false, ring: true }));
        await c.sleep(300 + words([l.before, l.mark ?? '', l.after ?? ''].join(' ')).length * 90 + 350);
        if (l.note) {
          await c.sleep(250);
          setS((x) => ({ ...x, mark: true }));
          await c.sleep(350);
          setS((x) => ({ ...x, rows: [...x.rows, i] }));
        }
        await c.sleep(1300);
      }
      setS((x) => ({ ...x, ring: false, summary: 'writing' }));
      await c.sleep(2600);
      setS((x) => ({ ...x, ring: true }));
    }
  }, !reduce);

  const line = LINES[s.line] ?? LINES[0];
  const still = s.take === 0;
  return (
    <SceneFrame>
      <Fit width={1180} height={560} stageRef={stage} label="A call on the left and the notes it produces on the right">
        <div className="lp-scene">
          <SceneHead title="Weekly product call" time="06:40" left={28} top={24} width={700} />
          {PEOPLE.map((id) => <Tile key={id} id={id} rect={TILE(id)} />)}
          {line && <motion.div className="lp-ring" initial={false} animate={{ ...box(TILE(line.who)), opacity: s.ring ? 1 : 0 }} transition={{ duration: 0.9, ease: EASE.inOut, opacity: { duration: 0.4 } }} />}
          <div className="lp-cap">
            <AnimatePresence mode="wait" initial={false}>
              {line && (
                <motion.div key={s.take} exit={{ opacity: 0, y: -4, transition: { duration: 0.25, ease: EASE.in } }}>
                  <Caption who={<motion.span className="inline-flex items-center gap-2" initial={still ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE.out }}><Avatar person={CAST[line.who]} size={18} />{firstOf(line.who)}</motion.span>}>
                    <WriteIn chunks={words(line.before)} step={0.09} blur={3} still={still} />
                    {line.mark && <>{' '}<mark className={s.mark ? 'lp-mark on' : 'lp-mark'}><WriteIn chunks={words(line.mark)} step={0.09} blur={3} delay={words(line.before).length * 0.09} still={still} /></mark></>}
                    {line.after && <WriteIn chunks={[line.after]} blur={3} delay={(words(line.before).length + words(line.mark ?? '').length) * 0.09} still={still} />}
                  </Caption>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="ac-notes lp-nt">
            <div className="ac-tabs">
              <button type="button" className="ac-tab" aria-selected="true" tabIndex={-1}>Notes</button><button type="button" className="ac-tab" aria-selected="false" tabIndex={-1}>Transcript</button><button type="button" className="ac-tab" aria-selected="false" tabIndex={-1}>Ask</button>
              <Chip tone="sun" icon="sealed">Sealed</Chip>
            </div>
            <div className="ac-notes-body">
              <div><div className="ac-eyebrow">Decided</div><Rows kind="dec" rows={s.rows} still={still} /></div>
              <div><div className="ac-eyebrow">Follow-ups</div><Rows kind="fol" rows={s.rows} still={still} /></div>
              <div>
                <div className="ac-eyebrow">Summary</div>
                {s.summary === 'none' ? <Listening />
                  : <p className="ac-summary"><WriteIn chunks={words(SUMMARY)} step={0.035} blur={6} still={s.summary === 'done'} /></p>}
              </div>
            </div>
            <div className="ac-notes-foot">
              <SealedBadge inline title="Written in confidential compute" />
              <Faces people={PEOPLE.map((id) => CAST[id])} size={20} />
            </div>
          </div>
        </div>
      </Fit>
    </SceneFrame>
  );
}
