/* Sharing a note and pinning it: the same on the note's page and beside the notes list. */
import { MAX_PINS, errorMessage, type Group, type Note, type Person } from '@alcove/api';
import { Button, IconButton, useToast, type ButtonSize } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { callName, listNames, sameEmail } from '~/lib/people';
import { q, usePins, useShareNote } from '~/lib/queries';

/** "Product, Lena and Sam" */
const and = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/**
 * Share: with people by name or address, or with one of your groups, which reaches all of its people at once and
 * tells each of them it came to them as that group. `onShared` hears who got the notes just now.
 */
export function ShareNote({ note, size, onShared }: { note: Note; size?: ButtonSize | undefined; onShared?: ((emails: string[]) => void) | undefined }) {
  const toast = useToast();
  const share = useShareNote();
  const groups = useQuery(q.prefs()).data?.groups;
  const [open, setOpen] = useState(false);
  const recording = note.status === 'recording';
  const have = note.recipients.map((r) => r.person.email);
  const done = (people: Person[], group?: Group) => share.mutate({ id: note.id, emails: people.map((p) => p.email), group }, {
    onSuccess: (after) => {
      const fresh = after.recipients.filter((r) => !have.some((e) => sameEmail(r.person, { email: e }))).map((r) => r.person);
      onShared?.(fresh.map((p) => p.email));
      if (!fresh.length) toast('They have these notes already.', { icon: 'check' });
      else toast(`Shared with ${group ? and([group.name, ...people.map(callName)]) : listNames(fresh)}`, { icon: 'send' });
    },
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  return (
    <PeoplePicker open={open} onOpenChange={setOpen} align="end" title="Share these notes" cta="Share" skip={have} groups={groups}
      anchor={<Button variant="secondary" size={size} icon="share" loading={share.isPending} disabled={recording} title={recording ? 'You can share these once the recording stops.' : undefined}>Share</Button>}
      note="They find them in Alcove when they sign in with that email."
      after={<div className="pick-have"><span>{note.recipients.length === 1 ? 'Only you have them' : `${note.recipients.length} people have them`}</span></div>}
      onDone={done} />
  );
}

/**
 * Pins a note to the side panel, or unpins it. Pins whose notes are gone are dropped, never sent back; with
 * MAX_PINS pinned, it says to unpin one first.
 */
export function PinNote({ noteId }: { noteId: string }) {
  const toast = useToast();
  const pins = usePins();
  const all = useQuery(q.notes()).data;
  const prefs = useQuery(q.prefs()).data;
  const pinned = (prefs?.pinned ?? []).filter((id) => !all || all.some((n) => n.id === id));
  const on = pinned.includes(noteId);
  const toggle = () => {
    if (!prefs) return;
    if (!on && pinned.length >= MAX_PINS) { toast(`${MAX_PINS} notes are pinned, the most there can be. Unpin one to pin these.`, { icon: 'pin' }); return; }
    pins.mutate(on ? pinned.filter((id) => id !== noteId) : [...pinned, noteId], { onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  };
  return <IconButton icon="pin" label="Pin these notes" title={on ? 'Pinned. Unpin these notes' : 'Pin these notes'} aria-pressed={on} on={on} onClick={toggle} />;
}
