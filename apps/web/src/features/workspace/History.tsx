/*
 * History, from ⋯ on a document: what it said, grouped by call, and going back to any of it. A version opens read-only in the
 * page's place, with what changed in it tinted, and the page stays open behind it. Restoring keeps today's as a version too.
 *
 * Restoring changes the page under anyone else in the document, so whoever restores is told who's there before they do, and
 * everyone in the document is told after, by name. Someone typing through it stays Saving… (the session knows a restore from a
 * dropped connection), and what they typed lands on what was restored.
 */
import { DocCaretStateSchema, errorMessage, firstName, type DocSession, type DocVersionSummary, type NoteSummary, type Person, type WorkspaceItem } from '@alcove/api';
import { WsDocBy, WsFade, WsHistory, WsPage, WsScroll, WsVersionFailed, wsToast, type WsRestoreAsk, type WsVersion } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { overlayOpen } from '~/lib/keys';
import { sessions, useNow } from '~/lib/live';
import { q, useRestoreVersion } from '~/lib/queries';
import { daysFromToday, dayMonth, hm, shortDay } from '~/lib/time';
import type { Ws } from './context';
import { useMediaView } from './DocumentMedia';
import { Editor } from './editor/lazy';
import type { EditorHandle } from './editor/types';
import type { OpenVersion } from './editor/version';
import { useTagPeople } from './tags';
import { nameOf } from './tree';

/** How long someone's browser says what it restored: long enough for everyone to hear, and gone before anyone new comes along. */
const SAYS_FOR_MS = 8_000;
/** How long Restore waits to hear its own change, so the page doesn't show what it said before for a moment. */
const HEARS_FOR_MS = 1_500;
/** Up to this far either side of a note's call, something kept in that call is taken to be from it. */
const CALL_SLACK_MS = 5 * 60_000;

/** A row in the list. `version`: what it shows, null for now. `before`: the version it's compared with, to tint what changed. */
interface Row extends WsVersion { version: string | null; before: string | null; from: string | null }

const NOW = 'now';

/** "Priya, Aiko and you". */
const joined = (names: string[]) => (names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);
/** Who changed something, as a list says it, with you last. */
function namesOf(by: readonly { name: string }[], me: Person | null): string[] {
  const all = [...new Set(by.map((p) => p.name))];
  const others = all.filter((n) => n !== me?.name).map((n) => firstName(n) || n);
  return all.length > others.length ? [...others, 'you'] : others;
}
const possessive = (names: string[]) => {
  if (names.length === 0) return 'Edits';
  if (names.length > 2) return `${names.length} people’s edits`;
  if (names[0] === 'you') return 'Your edits';
  return names[1] === 'you' ? `${names[0] ?? ''}’s and your edits` : `${joined(names)}’s edits`;
};
const counted = (names: string[]) => (names.length === 0 ? '' : names.length === 1 ? ` · ${names[0] === 'you' ? 'You' : names[0]}` : ` · ${names.length} people`);
/** When something's from, as a toast says it. */
const whenFrom = (iso: string) => (daysFromToday(new Date(iso)) === 0 ? hm(iso) : shortDay(new Date(iso)));
/** The same, as "as it was" says it. */
const asOf = (iso: string) => `${daysFromToday(new Date(iso)) === 0 ? 'at' : 'on'} ${whenFrom(iso)}`;
const columnDay = (iso: string) => (daysFromToday(new Date(iso)) === 0 ? 'Today' : dayMonth(new Date(iso)));

/** The note of a call, if this person has one: the only one of a call whose time covers what was kept in it. */
function noteOf(notes: readonly NoteSummary[], from: string, to: string): NoteSummary | undefined {
  const a = Date.parse(from), b = Date.parse(to);
  const covering = notes.filter((n) => {
    const start = Date.parse(n.startedAt);
    return n.kind === 'call' && a >= start - CALL_SLACK_MS && b <= start + n.duration * 1000 + CALL_SLACK_MS;
  });
  return covering.length === 1 ? covering[0] : undefined;
}

interface RowsFor { versions: readonly DocVersionSummary[]; item: WorkspaceItem; me: Person | null; here: string[]; notes: readonly NoteSummary[]; call: { id: string; startedAt: string } | undefined; now: number }

interface Stretch { key: string; kept: DocVersionSummary[] }
const dayKey = (v: DocVersionSummary) => `day:${new Date(v.at).toDateString()}`;

/**
 * Versions as stretches of work, grouped by the call they were kept in, and edits outside calls a day at a time. A version
 * is what the document said before the edit that kept it, so the first a call keeps, at its first edit, is what the document
 * said going in: work from before the call, and the way back to it. That's only so for a document that was there before the
 * call started (`startOf`, when it's known): one made in the call has nothing from before it.
 */
function stretchesOf(versions: readonly DocVersionSummary[], made: number, startOf: (callId: string, kept: readonly DocVersionSummary[]) => number | undefined): Stretch[] {
  const byCall = new Map<string, DocVersionSummary[]>();
  for (const v of versions) if (v.callId) byCall.set(v.callId, [...(byCall.get(v.callId) ?? []), v]);
  const out: Stretch[] = [];
  const add = (key: string, v: DocVersionSummary) => {
    const last = out.at(-1);
    if (last?.key === key) last.kept.push(v);
    else out.push({ key, kept: [v] });
  };
  versions.forEach((v, i) => {
    const older = versions[i + 1];
    const start = v.callId ? startOf(v.callId, byCall.get(v.callId) ?? []) : undefined;
    const goingIn = v.callId !== null && v.reason === 'edits' && older?.callId !== v.callId && start !== undefined && made < start;
    add(v.reason === 'restore' ? `restore:${v.id}` : v.callId && !goingIn ? `call:${v.callId}` : dayKey(v), v);
  });
  return out;
}

/**
 * The list, newest first: now, then a stretch of work a row. A call's versions are one row, what's kept before a restore
 * one each, and everything else one a day, so a long morning's writing doesn't fill the list. A row shows the newest it holds.
 */
function rowsOf({ versions, item, me, here, notes, call, now }: RowsFor): Row[] {
  const startOf = (callId: string, kept: readonly DocVersionSummary[]): number | undefined => {
    if (callId === call?.id) return Date.parse(call.startedAt);
    const newest = kept[0], oldest = kept.at(-1);
    const note = newest && oldest ? noteOf(notes, oldest.at, newest.at) : undefined;
    return note ? Date.parse(note.startedAt) : undefined;
  };
  const stretches = stretchesOf(versions, Date.parse(item.createdAt), startOf);
  const rows: Row[] = [{ id: NOW, name: 'Now', sub: here.length ? `${joined(here)} and you` : 'You', at: hm(new Date(now)), version: null, before: null, from: null }];
  stretches.forEach(({ key, kept }, i) => {
    const newest = kept[0];
    const oldest = kept.at(-1);
    if (!newest || !oldest) return;
    const names = namesOf(kept.flatMap((v) => v.by), me);
    const base = { version: newest.id, id: newest.id, before: stretches[i + 1]?.kept[0]?.id ?? null, from: newest.at, at: columnDay(newest.at) };
    if (newest.reason === 'restore') {
      rows.push({ ...base, name: 'Before restoring', sub: `${shortDay(new Date(newest.at))} · ${hm(newest.at)}` });
    } else if (key.startsWith('call:') && newest.callId === call?.id) {
      rows.push({ ...base, name: 'During this call', sub: `Started at ${hm(call.startedAt)}${counted(names)}`, at: 'Today' });
    } else if (key.startsWith('call:')) {
      rows.push({ ...base, name: noteOf(notes, oldest.at, newest.at)?.title ?? 'During a call', sub: `${shortDay(new Date(newest.at))}${counted(names)}` });
    } else {
      rows.push({ ...base, name: possessive(names), sub: shortDay(new Date(newest.at)) });
    }
  });
  if (item.by) rows.push({ id: 'made', name: `Created by ${firstName(item.by.name) || item.by.name}`, sub: shortDay(new Date(item.createdAt)), at: columnDay(item.createdAt), fixed: true, version: null, before: null, from: null });
  return rows;
}

/** Everyone else in the document now, by the carets their browsers keep up, and who of them is typing. */
function othersIn(ws: Ws, session: DocSession, documentId: string): { name: string; typing: boolean }[] {
  const seen = new Map<string, { name: string; typing: boolean }>();
  session.awareness.getStates().forEach((state, client) => {
    const user = DocCaretStateSchema.safeParse(state).data?.user;
    if (client === session.awareness.clientID || !user?.id || !user.name) return;
    const there = ws.here.filter((h) => h.person.id === user.id);
    if (there.some((h) => h.isMe)) return;
    seen.set(user.id, { name: firstName(user.name) || user.name, typing: there.some((h) => h.document === documentId && h.typing) });
  });
  return [...seen.values()];
}

/** The words Restore asks with, when someone else is in the document. */
function askWords(others: { name: string; typing: boolean }[]): string {
  const typing = others.filter((o) => o.typing).map((o) => o.name);
  const who = typing.length ? typing : others.map((o) => o.name);
  const one = who.length === 1;
  return `${joined(who)} ${typing.length ? `${one ? 'is' : 'are'} typing here` : `${one ? 'is' : 'are'} in this document`}. Restoring changes it for them too, and keeps today’s as a version.`;
}

/** Resolves when something next arrives in `doc`, or after a while. */
function hearing(doc: DocSession['doc']): { heard: Promise<void>; stop: () => void } {
  let stop = () => {};
  const heard = new Promise<void>((resolve) => {
    const done = () => { doc.off('update', done); resolve(); };
    stop = done;
    doc.on('update', done);
  });
  return { heard, stop };
}

/** A version in the page's place. */
function Version({ ws, item, row }: { ws: Ws; item: WorkspaceItem; row: Row }) {
  const pass = ws.pass;
  const shown = useQuery({ ...q.documentVersion(ws.workspaceId, item.id, row.version ?? '', pass), enabled: row.version !== null });
  const before = useQuery({ ...q.documentVersion(ws.workspaceId, item.id, row.before ?? '', pass), enabled: row.before !== null });
  const update = shown.data?.update;
  /* Nothing to compare with is no reason not to show it. */
  const earlier = before.isError ? null : before.data?.update ?? (row.before === null ? null : undefined);
  const [open, setOpen] = useState<OpenVersion | null>(null);
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  /* Its photos, videos and files as they are now: one deleted for good since says so, here too. */
  const { media } = useMediaView(ws, item.id);
  /* Faces on its tags, as the page has them. */
  const { faces: tagged } = useTagPeople(ws);
  const faces = useMemo(() => [...tagged, ...ws.here.map((h) => h.person)], [tagged, ws.here]);
  /* What changed may be a long way down, and it's what someone came to see. */
  const firstChange = open ? [...open.changed][0] : undefined;
  useEffect(() => { if (editor && firstChange) editor.scrollToBlock(firstChange); }, [editor, firstChange]);
  useEffect(() => {
    if (!update || earlier === undefined) return;
    let left = false;
    let made: OpenVersion | null = null;
    void import('./editor/version').then(({ openVersion }) => {
      if (left) return;
      made = openVersion(update, earlier);
      setOpen(made);
    });
    return () => { left = true; made?.close(); };
  }, [update, earlier]);
  const documentName = useCallback((id: string) => { const d = ws.tree.all.get(id); return d && d.trashedAt === null ? nameOf(d) : undefined; }, [ws.tree]);
  if (shown.isError) return <WsVersionFailed why={errorMessage(shown.error)} />;
  return (
    <WsScroll>
      <WsFade id={row.id}>
        <WsPage>
          {open && (
            <Suspense>
              <Editor ref={setEditor} doc={open.doc} awareness={open.awareness} readOnly titleHint={item.name} people={faces} changed={open.changed} documentName={documentName} media={media}
                byline={item.by ? <WsDocBy person={item.by} name={firstName(item.by.name)} edited={row.from ? `As it was ${asOf(row.from)}` : ''} /> : undefined} />
            </Suspense>
          )}
        </WsPage>
      </WsFade>
    </WsScroll>
  );
}

export interface History {
  show: () => void;
  /** When what's on the page is from, while it isn't now. */
  reading: string | null;
  /** The version in the page's place. */
  page: ReactNode;
  /** The panel beside it. */
  panel: ReactNode;
}

/** Everything about one document's history. `canRestore`: someone who can change it, now. */
export function useHistory(ws: Ws, item: WorkspaceItem, session: DocSession, canRestore: boolean): History {
  const [open, setOpen] = useState(false);
  /** The row chosen, until someone chooses: the newest there is. */
  const [on, setOn] = useState<string | null>(null);
  const [ask, setAsk] = useState<WsRestoreAsk | null>(null);
  const now = useNow(30_000);
  const qc = useQueryClient();
  const { workspaceId, pass, me, say } = ws;
  const restore = useRestoreVersion(workspaceId, item.id, pass);
  const versions = useQuery({ ...q.documentVersions(workspaceId, item.id, pass), enabled: open });
  const notes = useQuery({ ...q.notes(), enabled: open && ws.owner !== null }).data;
  const here = open ? othersIn(ws, session, item.id).map((o) => o.name) : [];
  const inCall = ws.mode === 'call' ? sessions.call?.session.getSnapshot() : undefined;
  const call = inCall ? { id: inCall.callId, startedAt: inCall.startedAt } : undefined;

  const rows = useMemo(
    () => rowsOf({ versions: versions.data ?? [], item, me, here, notes: notes ?? [], call, now }),
    [versions.data, item, me, here.join(), notes, call?.id, now]
  );
  const newest = rows.find((r) => r.version !== null);
  const row = rows.find((r) => r.id === on) ?? newest ?? rows[0];
  const reading = open && row?.from ? asOf(row.from) : null;

  const close = useCallback(() => {
    setOpen(false);
    setOn(null);
    setAsk(null);
    document.querySelector<HTMLElement>('.wd-head [aria-label="More for this document"]')?.focus({ preventScroll: true });
  }, []);

  /* Esc puts it away first, before the page or the call take the key. */
  const showing = open && !ws.call?.closed;
  useEffect(() => {
    if (!showing) return;
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', keys, true);
    return () => document.removeEventListener('keydown', keys, true);
  }, [showing, close]);

  /* Whoever's here is told who restored what, by the browser that did. What was said before you came isn't news. */
  useEffect(() => {
    const { awareness } = session;
    const told = new Set<string>();
    const listen = (tell: boolean) => {
      awareness.getStates().forEach((state, client) => {
        const said = DocCaretStateSchema.safeParse(state).data;
        if (client === awareness.clientID || !said?.restored) return;
        const key = `${client}:${said.restored.n}`;
        if (told.has(key)) return;
        told.add(key);
        if (!tell) return;
        void qc.invalidateQueries({ queryKey: q.documentVersions(workspaceId, item.id).queryKey });
        say(wsToast.restoredBy(firstName(said.user?.name ?? '') || 'Someone', whenFrom(said.restored.from), () => setOpen(true)));
      });
    };
    listen(false);
    const heard = () => listen(true);
    awareness.on('change', heard);
    return () => awareness.off('change', heard);
  }, [session, say, qc, workspaceId, item.id]);

  const saysRestored = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(saysRestored.current), []);
  /** Puts the document back to `version`, and doesn't let go of what's showing until the page has it. */
  const backTo = useCallback(async (version: string, from: string): Promise<DocVersionSummary[]> => {
    const { heard, stop } = hearing(session.doc);
    try {
      const list = await restore.mutateAsync(version);
      await Promise.race([heard, new Promise((r) => { setTimeout(r, HEARS_FOR_MS); })]);
      session.awareness.setLocalStateField('restored', { from, n: Date.now() });
      clearTimeout(saysRestored.current);
      saysRestored.current = setTimeout(() => { if (session.awareness.getLocalState()) session.awareness.setLocalStateField('restored', null); }, SAYS_FOR_MS);
      return list;
    } finally {
      stop();
    }
  }, [restore.mutateAsync, session]);

  const restoreNow = useCallback(async (target: Row) => {
    if (!target.version || !target.from) return;
    try {
      const list = await backTo(target.version, target.from);
      /* What it said a moment ago is the newest version there is now, so Undo is a restore too. */
      const kept = list[0];
      close();
      say(wsToast.restoredVersion(whenFrom(target.from), () => {
        if (kept) backTo(kept.id, kept.at).catch((e: unknown) => { say(wsToast.failed(errorMessage(e))); });
      }));
    } catch (e) {
      say(wsToast.failed(errorMessage(e)));
      setAsk(null);
    }
  }, [backTo, close, say]);

  const pressRestore = () => {
    if (!row) return;
    const others = othersIn(ws, session, item.id);
    if (others.length === 0) { void restoreNow(row); return; }
    setAsk({ text: askWords(others), onRestore: () => { void restoreNow(row); }, onKeep: () => setAsk(null) });
  };

  const note = versions.isError ? errorMessage(versions.error) : versions.data?.length === 0 ? 'Nothing to go back to yet. A version is kept every ten minutes of editing, and when a call ends.' : undefined;
  return {
    show: useCallback(() => setOpen(true), []),
    reading,
    page: open && row?.version ? <Version key={row.id} ws={ws} item={item} row={row} /> : null,
    panel: open && row ? (
      <WsHistory versions={rows} selected={row.id} onSelect={(id) => { setOn(id); setAsk(null); }} onRestore={canRestore ? pressRestore : undefined} restoring={restore.isPending} ask={ask} note={note} onClose={close} />
    ) : null
  };
}
