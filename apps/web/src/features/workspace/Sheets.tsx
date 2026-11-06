/*
 * The two who-has-it sheets, which look the same: Share on a document (the workspace's people, anyone it's shared with, and
 * closing it to the workspace), and the people in a workspace, from the name at the top of the list.
 */
import { errorCode, errorMessage, firstName, type DocumentRole, type Person, type PersonSuggestion, type WorkspaceItem, type WorkspacePerson, type WorkspaceRole } from '@alcove/api';
import { WsShareSheet, wsToast, type WsShareMatch, type WsShareRole, type WsShareRow } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSettled } from '~/lib/live';
import { q, useDocumentShare, useWorkspacePeople } from '~/lib/queries';
import { useWs } from './context';
import { nameOf } from './tree';

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
  const search = useQuery({ ...q.people(term), enabled: term.length > 0 });
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

/** Share, on a document someone can edit. */
export function ShareSheet({ item }: { item: WorkspaceItem }) {
  const ws = useWs();
  const name = nameOf(item);
  const share = useQuery(q.documentShare(ws.workspaceId, item.id));
  const people = useQuery(q.workspacePeople(ws.workspaceId)).data ?? [];
  const changes = useDocumentShare(ws.workspaceId, item.id);
  const refused = (e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); };
  const entries = share.data?.entries ?? [];
  const restricted = share.data?.restricted ?? item.restricted;
  const adding = useAdding(
    (p) => entries.some((e) => e.person.email === p.email) || (!restricted && people.some((w) => w.person.email === p.email)),
    (p) => { changes.set.mutateAsync({ to: [{ email: p.email }], role: 'edit' }).then(() => { ws.say(wsToast.canOpen(firstName(p.name) || p.email, 'edit', name)); }, refused); }
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

/** Who's in a workspace and what they can do, in the same sheet as Share. */
export function PeopleSheet() {
  const ws = useWs();
  const admin = ws.sent.role === 'admin';
  const people = useQuery(q.workspacePeople(ws.workspaceId)).data ?? [];
  const changes = useWorkspacePeople(ws.workspaceId);
  const refused = (e: unknown) => { ws.say(wsToast.failed(errorCode(e) === 'conflict' ? 'A workspace always keeps an admin.' : errorMessage(e))); };
  const adding = useAdding(
    (p) => people.some((w) => w.person.email === p.email),
    (p) => { changes.add.mutateAsync({ email: p.email, role: 'edit' }).catch(refused); }
  );
  const rows = people.map((p): WsShareRow => ({
    id: p.id, people: [p.person], name: p.isMe ? `${p.person.name} (you)` : p.person.name, sub: addressUnder(p.person),
    role: roleFor(p, admin, (role) => { changes.setRole.mutateAsync({ id: p.id, role }).catch(refused); }, () => { changes.remove.mutateAsync(p.id).catch(refused); })
  }));
  return <WsShareSheet title={`People in ${ws.spaceName}`} rows={rows} {...(admin ? { query: adding.query, onQuery: adding.setQuery, onAdd: adding.onAdd, matches: adding.matches } : {})} />;
}
