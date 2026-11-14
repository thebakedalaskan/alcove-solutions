/* Sharing a note and pinning it: the same on the note's page and beside the notes list. */
import { MAX_PINS, NOTE_LINK_DAYS, errorMessage, firstName, type Group, type Note, type Person, type TeamMember } from '@alcove/api';
import { Button, CopyField, IconButton, Switch, useToast, type ButtonSize } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PeoplePicker } from '~/features/team/PeoplePicker';
import { callName, listNames, sameEmail, someNames } from '~/lib/people';
import { accountQueries, usePins } from '~/features/account/queries';
import { noteQueries } from '~/features/notes/queries';
import { planQueries } from '~/features/plans/queries';
import { teamQueries } from '~/features/team/queries';
import { sharingQueries, useCreateNoteLink, useRevokeNoteLink, useSetTeamVisible, useShareNote } from './queries';
import { shortDay } from '~/lib/time';

/** "Product, Lena and Sam" */
const and = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** Where a link to notes opens: its secret in the fragment, which browsers never send to any server. */
export const noteLinkAt = (secret: string): string => `${location.origin}/link#${secret}`;

/**
 * Or a link: whoever opens it signed in, until it runs out, gets the notes to keep, as shared by you. Making one shows it
 * once, to copy (only its hash is kept); the links that still work are listed, with until when, and yours, or any on your
 * own notes, revoked. Neither its running out nor revoking it takes back what it gave.
 */
function ShareLinks({ noteId }: { noteId: string }) {
  const toast = useToast();
  const me = useQuery(accountQueries.session()).data?.ownerId;
  const links = useQuery(sharingQueries.noteLinks(noteId));
  const make = useCreateNoteLink(noteId);
  const revoke = useRevokeNoteLink(noteId);
  const [made, setMade] = useState<string | null>(null);
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  return (
    <div className="pick-links">
      <div className="pick-links-h">
        <span><b>Share a link</b><small>Whoever opens it signed in gets these notes to keep. The link works for {NOTE_LINK_DAYS} days.</small></span>
        <Button variant="secondary" size="sm" icon="link" loading={make.isPending} onClick={() => make.mutate(undefined, { onSuccess: (n) => setMade(noteLinkAt(n.secret)), onError: failed })}>Make a link</Button>
      </div>
      {made && <CopyField value={made} label="The link to these notes" />}
      {links.data?.map((l) => (
        <div key={l.id} className="pick-links-row">
          <span className="ac-clamp-1">{l.by.id === me ? 'Your link' : `${firstName(l.by.name)}’s link`}<small> · works until {shortDay(new Date(l.expiresAt))}</small></span>
          {l.revocable && <button type="button" className="lk quiet" disabled={revoke.isPending} onClick={() => revoke.mutate(l.id, { onSuccess: () => toast('Revoked. The link opens nothing now, and whoever opened it keeps the notes.', { icon: 'check' }), onError: failed })}>Revoke</button>}
        </div>
      ))}
    </div>
  );
}

/**
 * Who on your team has these notes whatever Visible to team says, as it says it: invited to the call, or given them since
 * (shared with them, or by a link). "Priya, Kofi and Maya have them anyway, from the call." Null when nobody does.
 */
function keptAnyway(note: Note, members: readonly TeamMember[]): string | null {
  const kept = members.flatMap((m) => {
    const r = m.you ? undefined : note.recipients.find((x) => x.role !== 'organizer' && sameEmail(x.person, m.person));
    return r ? [{ person: m.person, invited: r.role === 'invited' }] : [];
  });
  if (!kept.length) return null;
  const invited = kept.some((k) => k.invited);
  const shared = kept.some((k) => !k.invited);
  const how = invited && shared ? 'from the call or shared afterwards' : invited ? 'from the call' : 'shared afterwards';
  return `${someNames(kept.map((k) => k.person))} ${kept.length === 1 ? 'has' : 'have'} them anyway, ${how}.`;
}

/**
 * Visible to team: the organizer, while licensed on a team, lets everyone licensed on it read the notes and ask about
 * them, and nothing more. It stays visible if they leave the team, and while it is they can always turn it off (turning it
 * on again takes a license). Whoever on the team was invited, or given the notes since, keeps them either way, and it says
 * who. The switch shows what was pressed until Alcove has it, then what the note says. Absent for anyone else.
 */
function TeamVisible({ note }: { note: Note }) {
  const toast = useToast();
  const team = useQuery(planQueries.plan()).data?.team;
  const members = useQuery({ ...teamQueries.myTeam(), enabled: !!team }).data?.members;
  const set = useSetTeamVisible(note.id);
  if (note.received || (!team?.licensed && !note.teamVisible)) return null;
  const on = set.isPending && set.variables !== undefined ? set.variables : note.teamVisible;
  const name = team?.name ?? 'the team';
  const kept = members ? keptAnyway(note, members) : null;
  const flip = (visible: boolean) => set.mutate(visible, {
    onSuccess: () => toast(visible ? `Visible to ${name}` : `Not visible to ${name} any more.${kept ? ` ${kept}` : ''}`, { icon: 'check' }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  return (
    <div className="pick-links">
      <div className="pick-links-h">
        <span>
          <b>Visible to team</b>
          <small>
            Everyone licensed on {name} can read it and ask about it.{kept && ` ${kept}`}
            {!team?.licensed && ' Once it’s off, turning it on again takes a license on a team.'}
          </small>
        </span>
        <Switch label="Visible to team" checked={on} disabled={set.isPending} onChange={flip} />
      </div>
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
  const groups = useQuery(accountQueries.prefs()).data?.groups;
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
      after={<><div className="pick-have"><span>{note.recipients.length === 1 ? 'Only you have them' : `${note.recipients.length} people have them`}</span></div><TeamVisible note={note} /><ShareLinks noteId={note.id} /></>}
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
  const all = useQuery(noteQueries.notes()).data;
  const prefs = useQuery(accountQueries.prefs()).data;
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
