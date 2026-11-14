/*
 * The who-has-it sheets, which look the same: Share on a document or a board (the workspace's people, anyone it's shared with,
 * and closing it to the workspace); the people in a workspace, wherever the workspace is shown whole (Share on its Home and
 * on its sheet in the Drive, who can open it at the foot of its side panel, People under its name, and in a call Who's in it,
 * with whoever else is in the call); and for someone in the call who isn't in the workspace, who can't read its people, the
 * people in the call.
 */
import { errorCode, errorMessage, firstName, type DocumentRole, type Person, type PersonSuggestion, type TeamAccess, type WorkspaceItem, type WorkspacePerson, type WorkspaceRole } from '@alcove/api';
import { WsShareSheet, wsToast, type WsPop, type WsShareMatch, type WsShareRole, type WsShareRow, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSettled } from '~/lib/live';
import { teamQueries } from '~/features/team/queries';
import { workspaceQueries, useDocumentShare, useSetTeamAccess, useWorkspacePeople } from '~/features/workspace/queries';
import { useWs } from '../context';
import { nameOf } from '../tree/tree';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLE_WORDS: Record<WorkspaceRole, string> = { admin: 'Admin', edit: 'Can edit', read: 'Can read' };
/** What goes under a name: their address, unless their address is all there is, and that's the name. */
const addressUnder = (p: Person) => (p.email === p.name ? '' : p.email);

/**
 * Who the field finds, leaving out `known`. Only a search for exactly what's in the field now finds anyone: one for what was
 * there a moment ago, or one still settling, found someone else. Enter adds the first of them; with none, an address adds
 * itself, and anything else waits.
 */
function useAdding(known: (p: Person) => boolean, add: (person: Pick<Person, 'name' | 'email'>) => void) {
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const term = useSettled(typed, 160);
  const search = useQuery({ ...teamQueries.people(term), enabled: term.length > 0 });
  const found = term.length > 0 && term === typed && !search.isPlaceholderData ? search.data : undefined;
  const shown: PersonSuggestion[] = (found ?? []).filter((s) => !known(s.person)).slice(0, 4);
  const take = (person: Pick<Person, 'name' | 'email'>) => { setQuery(''); add(person); };
  const address = typed.toLowerCase();
  return {
    query, setQuery,
    matches: shown.map((s): WsShareMatch => ({ id: s.person.id, person: s.person, sub: addressUnder(s.person), onAdd: () => take(s.person) })),
    /** Enter in the field. */
    onAdd: () => {
      const first = shown[0];
      if (first) take(first.person);
      else if (EMAIL.test(address)) take({ name: address, email: address });
    }
  };
}

/** Share, on a document someone can edit, in its workspace: in a call, the call hears of each change at once. */
export function ShareSheet({ item }: { item: WorkspaceItem }) {
  const ws = useWs();
  return <ShareSheetFor workspaceId={ws.workspaceId} item={item} say={ws.say} pass={ws.pass} />;
}

/**
 * Share, wherever it opens: in the document's workspace, or from a board's name in a call. `say` shows what it did. `pass`: the
 * call it's opened from, which is told of each change at once.
 */
export function ShareSheetFor({ workspaceId, item, say, pass }: { workspaceId: string; item: WorkspaceItem; say: (toast: WsToastData) => void; pass?: string | undefined }) {
  const name = nameOf(item);
  const share = useQuery(workspaceQueries.documentShare(workspaceId, item.id));
  const people = useQuery(workspaceQueries.workspacePeople(workspaceId)).data ?? [];
  const changes = useDocumentShare(workspaceId, item.id, pass);
  const refused = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
  const entries = share.data?.entries ?? [];
  const restricted = share.data?.restricted ?? item.restricted;
  const adding = useAdding(
    (p) => entries.some((e) => e.person.email === p.email) || (!restricted && people.some((w) => w.person.email === p.email)),
    (p) => { changes.set.mutateAsync({ to: [{ email: p.email }], role: 'edit' }).then(() => { say(wsToast.canOpen(firstName(p.name) || p.email, 'edit', name)); }, refused); }
  );

  const setRole = (email: string, role: DocumentRole) => { changes.set.mutateAsync({ to: [{ email }], role }).catch(refused); };
  const roleOf = (id: string, email: string, role: DocumentRole, seat: boolean): WsShareRole => ({
    label: role === 'edit' ? 'Can edit' : 'Can read',
    options: [
      ...(seat ? [] : [
        { label: 'Can edit', ticked: role === 'edit', onSelect: () => setRole(email, 'edit') },
        { label: 'Can read', ticked: role === 'read', onSelect: () => setRole(email, 'read') }
      ]),
      { label: 'Remove', caution: true, onSelect: () => { changes.remove.mutateAsync(id).catch(refused); } }
    ]
  });
  const restrict = (to: boolean) => { changes.restrict.mutateAsync(to).catch(refused); };
  const space = share.data?.workspace;
  const rows: WsShareRow[] = [];
  if (space) {
    rows.push({
      id: 'workspace', people: people.map((p) => p.person), name: space.name,
      sub: restricted ? 'Only the people below' : space.people === 1 ? 'Just you' : `${space.people} people`,
      role: {
        label: restricted ? 'Can’t open' : 'Can edit',
        options: [
          { label: `Everyone in ${space.name}`, ticked: !restricted, onSelect: () => restrict(false) },
          { label: 'Only people added here', ticked: restricted, onSelect: () => restrict(true) }
        ]
      }
    });
  }
  if (restricted && item.by) rows.push({ id: 'maker', people: [item.by], name: item.by.name, sub: 'Made this', role: { label: 'Can edit' } });
  for (const e of entries) {
    rows.push({ id: e.id, people: [e.person], name: e.person.name, sub: e.kind === 'seat' ? 'Guest in this call' : addressUnder(e.person), role: roleOf(e.id, e.person.email, e.role, e.kind === 'seat') });
  }
  return <WsShareSheet title={`Share ${name}`} query={adding.query} onQuery={adding.setQuery} onAdd={adding.onAdd} matches={adding.matches} rows={rows} />;
}

/** Someone's row in the workspace's own sheet. An admin can change anyone; everyone else can only leave. */
function roleFor(p: WorkspacePerson, admin: boolean, setRole: (role: WorkspaceRole) => void, remove: () => void): WsShareRole {
  const out = { label: 'Leave this workspace', caution: true, onSelect: remove };
  if (!admin) return { label: ROLE_WORDS[p.role], options: p.isMe ? [out] : undefined };
  return {
    label: ROLE_WORDS[p.role],
    options: [
      ...(['admin', 'edit', 'read'] as const).map((role) => ({ label: ROLE_WORDS[role], ticked: p.role === role, onSelect: () => setRole(role) })),
      p.isMe ? out : { label: 'Remove', caution: true, onSelect: remove }
    ]
  };
}

/** Who's in the workspace open here and what they can do, in the same sheet as Share. */
export function PeopleSheet() {
  const ws = useWs();
  return <PeopleSheetFor workspaceId={ws.workspaceId} name={ws.spaceName} admin={ws.sent.role === 'admin'} say={ws.say} teamAccess={ws.sent.teamAccess} />;
}

/**
 * Share for the workspace open here, where it's shown whole rather than one page of it (the foot of its side panel, full
 * screen): who's in it, in the people sheet. Nothing for someone who isn't in it, who can't read its people.
 */
export function useSpaceShare(): WsPop | undefined {
  const ws = useWs();
  const [open, setOpen] = useState(false);
  if (ws.sent.role === null) return undefined;
  return { open, onOpenChange: setOpen, content: open ? <PeopleSheet /> : null };
}

/**
 * Who to ask, for someone in a workspace who can't add people to it: only its admins can, by first name ("Ask Priya or Kofi").
 * Undefined until its people are known.
 */
function askAnAdmin(people: readonly WorkspacePerson[]): string | undefined {
  const admins = people.filter((p) => p.role === 'admin' && !p.isMe).map((p) => firstName(p.person.name) || p.person.email);
  const [only, ...more] = admins;
  if (only === undefined) return undefined;
  const who = more.length === 0 ? only : admins.length <= 3 ? `${admins.slice(0, -1).join(', ')} or ${admins.at(-1) ?? ''}` : `${admins.slice(0, 2).join(', ')} or another admin`;
  return `Only an admin can add people. Ask ${who}.`;
}

/** Someone in a call, as Who's in it lists them, as you may know them: `guest`, they came in with the link, by name alone. */
export interface InTheCall { person: Person; isMe: boolean; organizer: boolean; guest: boolean }

/** Everyone in the call once, the organizer first: someone on two devices is one person. */
function onceEach(people: readonly InTheCall[]): InTheCall[] {
  const seen = new Set<string>();
  return [...people].sort((a, b) => Number(b.organizer) - Number(a.organizer)).filter((p) => {
    const key = p.person.email ? p.person.email.toLowerCase() : p.person.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const youIn = (p: InTheCall) => (p.isMe ? `${p.person.name} (you)` : p.person.name);

/**
 * Who's in a workspace and what they can do, wherever it's asked: an admin adds people and changes anyone; anyone else reads
 * who's in it, is told who to ask to add someone, and can leave. In a call that opens it to everyone in it, `call` has who's in
 * the call, and whoever of them isn't in the workspace is under its people: they can edit it while they're in the call. On a
 * team's workspace (`teamAccess`), who's in it too: the whole team, or only the people added, which its admins change.
 */
export function PeopleSheetFor({ workspaceId, name, admin, say, call, teamAccess = null }: {
  workspaceId: string; name: string; admin: boolean; say: (toast: WsToastData) => void; call?: readonly InTheCall[] | undefined; teamAccess?: TeamAccess | null | undefined;
}) {
  const read = useQuery(workspaceQueries.workspacePeople(workspaceId)).data;
  const people = read ?? [];
  const changes = useWorkspacePeople(workspaceId);
  const access = useSetTeamAccess(workspaceId);
  // What was just chosen shows at once, until the workspace says so itself.
  const shown = access.isPending ? access.variables : teamAccess;
  const choose = (to: TeamAccess) => { access.mutateAsync(to).catch((e: unknown) => { say(wsToast.failed(errorMessage(e))); }); };
  const team = shown === null ? null : { access: shown, ...(admin ? { onChange: choose } : {}) };
  const refused = (e: unknown) => { say(wsToast.failed(errorCode(e) === 'conflict' ? 'A workspace always keeps an admin.' : errorMessage(e))); };
  const adding = useAdding(
    (p) => people.some((w) => w.person.email === p.email),
    (p) => { changes.add.mutateAsync({ email: p.email, role: 'edit' }).catch(refused); }
  );
  const rows = people.map((p): WsShareRow => ({
    id: p.id, people: [p.person], name: p.isMe ? `${p.person.name} (you)` : p.person.name, sub: addressUnder(p.person),
    role: roleFor(p, admin, (role) => { changes.setRole.mutateAsync({ id: p.id, role }).catch(refused); }, () => { changes.remove.mutateAsync(p.id).catch(refused); })
  }));
  /* Whoever in the call isn't among its people, once they're known: a guest has no address, so is never one of them. */
  const members = new Set(people.map((p) => p.person.email.toLowerCase()));
  const also = read && call ? onceEach(call).filter((c) => !c.person.email || !members.has(c.person.email.toLowerCase())).map((c): WsShareRow => ({
    id: `call:${c.person.id}`, people: [c.person], name: youIn(c), sub: 'Can edit while they’re in the call', tag: c.guest ? 'Guest' : undefined
  })) : [];
  return <WsShareSheet title={`People in ${name}`} about={admin ? undefined : askAnAdmin(people)} rows={rows} team={team} inCall={also} {...(admin ? { query: adding.query, onQuery: adding.setQuery, onAdd: adding.onAdd, matches: adding.matches } : {})} />;
}

/**
 * Who's in it, for someone in a call who isn't in the workspace the call uses: they can't read its people, so it's the people
 * in the call, everyone of whom can open it and edit it while they're there.
 */
export function CallPeopleSheet({ name, people }: { name: string; people: readonly InTheCall[] }) {
  const rows = onceEach(people).map((c): WsShareRow => ({ id: c.person.id, people: [c.person], name: youIn(c), sub: c.organizer ? 'Organizer' : addressUnder(c.person), tag: c.guest ? 'Guest' : undefined }));
  return <WsShareSheet title={`Who’s in ${name}`} about="Everyone in the call can open it and edit it while they’re here." rows={rows} />;
}
