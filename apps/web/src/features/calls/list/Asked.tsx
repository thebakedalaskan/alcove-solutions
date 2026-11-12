/*
 * A question across every call, on the sheet: where it was read and from how many calls, the answer as it arrives, and a
 * chip for each moment it comes from; then the calls it read, each quoting the line it used. × puts it away, and so does
 * typing. When a call it read went while it was written, it isn't shown: Ask again.
 */
import type { AnswerPart, Inbox, Note, NoteFound } from '@alcove/api';
import { Button, CallsAnswer, CallsGroup, Dots, MomentChip, SheetHead, Unencrypted, Words } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { Answer } from '~/features/notes/answer';
import { inNote } from '~/features/notes/parts';
import { position } from '~/lib/time';
import { plural } from '~/lib/words';
import { PastRow } from './Rows';
import { citedLine, type Said } from './said';

type Cite = Extract<AnswerPart, { type: 'cite' }>;

/** Each call an answer cites, once, in the order it uses them. A call that's gone isn't shown. */
export const citedCalls = (cites: readonly Cite[], notes: readonly NoteFound[]): NoteFound[] =>
  [...new Set(cites.map((c) => c.noteId))].flatMap((id) => notes.filter((n) => n.id === id));

export function Asked({ answer, lost, notes, read, me, now, inbox, pinned, outside, onClose, onAgain }: {
  answer: Answer | null;
  /** The question whose answer wasn't shown, because a call it read went while it was written. */
  lost: string | null;
  notes: NoteFound[];
  /** The cited calls' notes, as they're read: what an answer cites is quoted from them. */
  read: (id: string) => Note | undefined;
  me: string | undefined; now: number; inbox: Inbox | undefined; pinned: readonly string[];
  /** The model that answers is outside a secure enclave. */
  outside: boolean;
  onClose: () => void; onAgain: () => void;
}) {
  const cites = (answer?.cites ?? []).flatMap((c): Cite[] => (c.type === 'cite' ? [c] : []));
  const cited = citedCalls(cites, notes);
  const reading = !!answer && !answer.done;
  /** What an answer cites in a call, in the order it uses it. A cite at 0:00 is the call as a whole. */
  const saidIn = (n: NoteFound): Said => {
    const lines = [...new Set(cites.filter((c) => c.noteId === n.id && c.at > 0).map((c) => c.at))].map((at) => citedLine(read(n.id), n.id, at));
    return { lines, count: lines.length };
  };
  const sealed = reading ? 'Reading your calls' : outside
    ? <>Written outside a secure enclave, from {plural(cited.length, 'call')} <Unencrypted compact /></>
    : `Read in confidential compute, from ${plural(cited.length, 'call')}`;
  return (
    <>
      <SheetHead title="Asked across every call" />
      {lost ? (
        <CallsAnswer sealed="Read in confidential compute" onClose={onClose} cites={<Button size="sm" icon="retry" onClick={onAgain}>Ask again</Button>}>
          A call this read was deleted, or taken from you, while the answer was written, so it isn’t shown.
        </CallsAnswer>
      ) : answer && (
        <CallsAnswer sealed={sealed} reading={reading && !answer.text} onClose={onClose}
          cites={answer.done && cites.length ? cites.map((c) => {
            const n = notes.find((x) => x.id === c.noteId);
            if (!n) return null;
            const time = c.at > 0 ? `${n.title} · ${position(c.at)}` : n.title;
            return <MomentChip key={`${c.noteId}@${c.at}`} time={time} label={c.at > 0 ? `Open ${n.title} at ${position(c.at)}` : `Open ${n.title}`} link={(p) => <Link to="/calls/$noteId" params={{ noteId: n.id }} {...(c.at > 0 ? inNote(c.at, undefined) : {})} {...p} />} />;
          }) : undefined}>
          {answer.done ? <Words text={answer.text} /> : answer.text || <><Dots />Reading every call you have, in confidential compute</>}
        </CallsAnswer>
      )}
      {answer?.done && cited.length > 0 && (
        <CallsGroup label="Where the answer comes from">
          {cited.map((n) => <PastRow key={n.id} n={n} me={me} now={now} inbox={inbox} pinned={pinned.includes(n.id)} said={saidIn(n)} cited />)}
        </CallsGroup>
      )}
    </>
  );
}
