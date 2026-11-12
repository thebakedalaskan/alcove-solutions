/* Sharing a note and pinning it: the same on the note's page and beside the notes list. */
import { MAX_PINS, NOTE_LINK_DAYS, errorMessage, firstName, type Group, type Note, type Person } from '@alcove/api';
import { Button, CopyField, IconButton, useToast, type ButtonSize } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { callName, listNames, sameEmail } from '~/lib/people';
import { q, usePins, useCreateNoteLink, useRevokeNoteLink, useShareNote } from '~/lib/queries';
import { shortDay } from '~/lib/time';

/** "Product, Lena and Sam" */
const and = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** Where a link to notes opens: its secret in the fragment, which browsers never send to any server. */
export const noteLinkAt = (secret: string): string => `${location.origin}/link#${secret}`;

/**
 * Or a link: whoever opens it signed in gets the notes, as shared by you, until it runs out. Making one shows it once,
 * to copy (only its hash is kept); the links that still work are listed, and yours, or any on your own notes, revoked.
 */
function ShareLinks({ noteId }: { noteId: string }) {
  const toast = useToast();
  const me = useQuery(q.session()).data?.ownerId;
  const links = useQuery(q.noteLinks(noteId));
  const make = useCreateNoteLink(noteId);
  const revoke = useRevokeNoteLink(noteId);
  const [made, setMade] = useState<string | null>(null);
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  return (
    <div className="pick-links">
      <div className="pick-links-h">
        <span><b>Share a link</b><small>Whoever opens it signed in gets these notes, for {NOTE_LINK_DAYS} days.</small></span>
        <Button variant="secondary" size="sm" icon="link" loading={make.isPending} onClick={() => make.mutate(undefined, { onSuccess: (n) => setMade(noteLinkAt(n.secret)), onError: failed })}>Make a link</Button>
      </div>
      {made && <CopyField value={made} label="The link to these notes" />}
      {links.data?.map((l) => (
        <div key={l.id} className="pick-links-row">
          <span className="ac-clamp-1">{l.by.id === me ? 'Your link' : `${firstName(l.by.name)}’s link`}<small> · until {shortDay(new Date(l.expiresAt))}</small></span>
          {l.revocable && <button type="button" className="lk quiet" disabled={revoke.isPending} onClick={() => revoke.mutate(l.id, { onSuccess: () => toast('Revoked. The link opens nothing now.', { icon: 'check' }), onError: failed })}>Revoke</button>}
        </div>
      ))}
    </div>
  );
}

/**
 * Share: with people by name or address, or with one of your groups, which reaches all of its people at once and
 * tells each of them it came to them as that group, or by a link anyone signed in can open. `onShared` hears who got
 * the notes just now.
 */
export function ShareNote({ note, size, align = 'end', className, onShared }: {
  note: Note; size?: ButtonSize | undefined; align?: 'start' | 'center' | 'end' | undefined; className?: string | undefined; onShared?: ((emails: string[]) => void) | undefined;
}) {
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
    <PeoplePicker open={open} onOpenChange={setOpen} align={align} className={className} title="Share these notes" cta="Share" skip={have} groups={groups}
      anchor={<Button variant="secondary" size={size} icon="share" loading={share.isPending} disabled={recording} title={recording ? 'You can share these once the recording stops.' : undefined}><span className="share-t">Share</span></Button>}
      note="They find them in Alcove when they sign in with that email."
      after={<><div className="pick-have"><span>{note.recipients.length === 1 ? 'Only you have them' : `${note.recipients.length} people have them`}</span></div><ShareLinks noteId={note.id} /></>}
      onDone={done} />
  );
}

/**
 * Pinning a note to the side panel, or unpinning it. Pins whose notes are gone are dropped, never sent back; with MAX_PINS
 * pinned, it says to unpin one first.
 */
export function usePinNote(noteId: string): { on: boolean; toggle: () => void } {
  const toast = useToast();
  const pins = usePins();
  const all = useQuery(q.notes()).data;
  const prefs = useQuery(q.prefs()).data;
  const pinned = (prefs?.pinned ?? []).filter((id) => !all || all.some((n) => n.id === id));
  const on = pinned.includes(noteId);
  // Each press keeps its own answer (mutateAsync), so a quick second press never loses the first one's error.
  const toggle = async () => {
    if (!prefs) return;
    if (!on && pinned.length >= MAX_PINS) { toast(`${MAX_PINS} notes are pinned, the most there can be. Unpin one to pin these.`, { icon: 'pin' }); return; }
    try {
      await pins.mutateAsync(on ? pinned.filter((id) => id !== noteId) : [...pinned, noteId]);
      toast(on ? 'Unpinned from the side panel.' : 'Pinned to the side panel.', { icon: 'pin', ms: 2600 });
    } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  return { on, toggle: () => void toggle() };
}

/** Pins a note to the side panel, or unpins it, as a button. */
export function PinNote({ noteId }: { noteId: string }) {
  const { on, toggle } = usePinNote(noteId);
  return <IconButton icon="pin" label="Pin these notes" title={on ? 'Pinned. Unpin these notes' : 'Pin these notes'} aria-pressed={on} on={on} onClick={toggle} />;
}
