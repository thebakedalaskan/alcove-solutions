import { mayChangeAction, type NoteAction, type NoteReader, type Person } from '@alcove/api';
import { Button } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { useProposeAction, useReviewAction } from '~/features/notes/queries';
import { Backing, EvidenceFlags, type Seed } from '../entries';
import { FollowUpForm } from './FollowUpForm';
import { FollowUpReview } from './FollowUpReview';
import type { FollowUpProposal } from './useFollowUpReview';
import { Moment, type ScreenRefShown } from '../parts';

/** Manual tasks are actual tasks immediately, with an explicit owner and date. */
export function NewFollowUp({ noteId, room, people, seed, onDone }: {
  noteId: string; room?: string | undefined; people: readonly Person[]; seed?: Seed | undefined; onDone: () => void;
}) {
  const add = useProposeAction();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => { if (seed) setOpen(true); }, [seed]);
  useEffect(() => { if (!open && returning.current) { returning.current = false; button.current?.focus(); } }, [open]);
  const done = () => { returning.current = true; setOpen(false); onDone(); };
  if (!open) return <Button ref={button} variant="quiet" size="sm" icon="plus" onClick={() => setOpen(true)}>Add a follow-up</Button>;
  return <FollowUpForm key={seed?.line.id ?? 'manual'} initial={{ text: seed?.line.text.slice(0, 300) ?? '', owner: null, due: null }} people={people} saveLabel="Add" onDone={done}
    onSave={(value) => add.mutateAsync({ noteId, proposal: { text: value.text, ...(value.owner ? { owner: value.owner } : {}), ...(value.due ? { due: value.due } : {}), ...(room ? { room } : {}), ...(seed ? { lines: [seed.line.id] } : {}) } })} />;
}

/** The saved note uses exactly the same fixed review interaction as the running call. */
export function NoteFollowUpReview({ noteId, suggestions, actions, people, reader, me, onSeek, shown }: {
  noteId: string; suggestions: readonly NoteAction[]; actions: readonly NoteAction[]; people: readonly Person[];
  reader: NoteReader; me: string | undefined; onSeek?: ((seconds: number) => void) | undefined; shown?: ScreenRefShown | undefined;
}) {
  const review = useReviewAction();
  const namedOwner = (email: string | null) => people.find((p) => p.email === email)?.name ?? email;
  const proposals = suggestions.map((a): FollowUpProposal => {
    const target = actions.find((t) => t.id === a.changeOf);
    return {
      id: a.id, revision: a.revision, text: a.text, owner: a.owner?.name ?? null, due: a.due ?? null,
      target: a.target ? { ...a.target, owner: namedOwner(a.target.owner) } : null,
      allowed: mayChangeAction(target ?? a, reader),
      evidence: <><Backing evidence={a.evidence} me={me} shown={shown} moment={(at) => <Moment at={at} onSeek={onSeek} />} /><EvidenceFlags evidence={a.evidence} me={me} /></>
    };
  });
  return <FollowUpReview proposals={proposals} onReview={(input) => review.mutateAsync({ noteId, review: input })} />;
}
