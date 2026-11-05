/*
 * Tagging in a document: what `@` offers, in the canvas's order, and what happens once someone's picked. Whoever can open
 * the document is told. Whoever can't is asked about once, right where you are, and only you can share anything: a tag never
 * does. The list says who can't open this before you pick, from what Share knows, and the decision reads it again.
 */
import { errorCode, errorMessage, firstName, type DocumentShare, type MentionBody, type Person, type ShareTarget, type WorkspaceItem } from '@alcove/api';
import { wsToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { q, useDocumentShare, useMention } from '~/lib/queries';
import { shortDay } from '~/lib/time';
import type { Ws } from './context';
import type { MentionItem, MentionSection, Rect } from './editor/types';
import { hashId, withEarlier } from './ids';
import { documentsIn, nameOf } from './tree';

const tlog = log.child({ component: 'tags' });

/** The dates `@` offers: today, tomorrow and the next Friday after that. */
export function dateChoices(now: number): { label: string; date: string }[] {
  const today = new Date(now);
  const day = (add: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + add);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const toFriday = (12 - today.getDay()) % 7;
  const friday = day(toFriday > 1 ? toFriday : toFriday + 7);
  return [{ label: 'Today', date: iso(day(0)) }, { label: 'Tomorrow', date: iso(day(1)) }, { label: shortDay(friday), date: iso(friday) }];
}

/** Someone as a tag shows them: never by their address, which a tag would carry to everyone who reads it. */
const named = (p: Person): Person => (p.name === p.email ? { ...p, name: callName(p) } : p);

/** What a tag calls someone in a call who has no address here: their seat, which is already nobody's address. */
const seatPerson = (p: Person, seat: string): Person => ({ ...p, id: hashId(seat) });

/** Someone asked about before anything's shared: who, the line, and where to ask. */
export interface TagAsk { person: Person; block: string; rect: () => DOMRect }

export function useTags(ws: Ws, item: WorkspaceItem, now: number) {
  const { workspaceId, pass } = ws;
  const member = ws.sent.role !== null;
  const canShare = member && item.role === 'edit';
  const qc = useQueryClient();
  const people = useQuery({ ...q.workspacePeople(workspaceId), enabled: member }).data;
  const team = useQuery({ ...q.team(), enabled: member }).data;
  const share = useQuery({ ...q.documentShare(workspaceId, item.id, pass), enabled: canShare }).data;
  const changes = useDocumentShare(workspaceId, item.id, pass);
  const mention = useMention(workspaceId, pass);
  const [asking, setAsking] = useState<readonly TagAsk[]>([]);
  /** Asked once: someone you've said Not now about isn't asked about again in this document. */
  const asked = useRef(new Set<string>());

  /* Someone added by address is known here by that until they're around, when they say who they are. */
  const members = useMemo(() => (people ?? []).map((p) => named({ ...p.person, name: ws.here.find((h) => h.person.id === p.person.id)?.person.name ?? p.person.name })), [people, ws.here]);
  /* Anyone else by the ID the workspace keys for their address: someone whose ID isn't known yet isn't offered yet. */
  const ids = ws.ids;
  const company = useMemo(() => {
    const inHere = new Set(members.map((p) => p.email));
    return (team?.members ?? []).filter((m) => !inHere.has(m.person.email)).flatMap((m) => {
      const id = ids.of(m.person.email);
      return id === undefined ? [] : [named({ ...m.person, id })];
    });
  }, [team, members, ids]);
  /* Everyone in the call, as this workspace knows them: by what they're called here if they're in it, and by their seat if not. */
  const inCall = useMemo(() => (ws.call?.people ?? []).filter((p) => !p.isMe).map((p) => {
    const here = ws.here.find((h) => h.callIdentity === p.id)?.person;
    const known = p.person.email ? members.find((m) => m.email === p.person.email) : undefined;
    const id = p.person.email ? ids.of(p.person.email) : undefined;
    const person = known ?? (here && { ...here, email: p.person.email }) ?? (id === undefined ? seatPerson(p.person, p.seat) : { ...p.person, id });
    return { connection: p.id, seat: p.seat, person: named(person) };
  }), [ws.call?.people, ws.here, members, ids]);
  const invited = useMemo(() => (ws.call?.invited ?? []).flatMap((p) => {
    const known = members.find((m) => m.email === p.email);
    const id = ids.of(p.email);
    return known ? [known] : id === undefined ? [] : [named({ ...p, id })];
  }), [ws.call?.invited, members, ids]);
  /** Everyone a tag here may show a face for, under the IDs tags carried before they were keyed too. */
  const faces = useMemo(() => withEarlier([...members, ...company, ...invited, ...inCall.map((c) => c.person)]), [members, company, invited, inCall]);
  const myEmail = ws.me?.email;
  const seatOf = useCallback((p: Person) => inCall.find((c) => c.person.id === p.id)?.seat, [inCall]);

  const opensFor = useCallback((s: DocumentShare, p: Person) => {
    const seat = seatOf(p);
    return p.email ? s.canOpen.includes(p.email) : seat !== undefined && s.seats.includes(seat);
  }, [seatOf]);
  const canOpen = useCallback((p: Person) => share === undefined || opensFor(share, p), [share, opensFor]);

  const sections = useCallback((query: string, { docsOnly }: { docsOnly: boolean }): MentionSection[] => {
    const words = query.toLowerCase();
    const has = (s: string) => s.toLowerCase().includes(words);
    const documents: MentionItem[] = documentsIn(ws.tree).filter((d) => d.id !== item.id && has(nameOf(d))).slice(0, docsOnly ? 8 : 3).map((d) => ({ kind: 'document', id: d.id, name: nameOf(d) }));
    if (docsOnly) return [{ title: 'Documents', items: documents }];
    const shown = new Set<string>(myEmail ? [myEmail] : []);
    const pick = (list: readonly Person[]): MentionItem[] => list.filter((p) => {
      const key = p.email || p.id;
      if (shown.has(key) || !has(p.name)) return false;
      shown.add(key);
      return true;
    }).slice(0, 8).map((person) => ({ kind: 'person', person, sub: canOpen(person) ? undefined : 'Can’t open this yet' }));
    const out: MentionSection[] = [
      { title: 'In this call', items: pick(inCall.map((c) => c.person)) },
      { title: 'Invited', items: pick(invited) },
      { title: ws.spaceName, items: pick(members) },
      { title: team?.name ?? 'Your company', items: pick(company) },
      { title: 'Documents', items: documents },
      { title: 'Dates', items: dateChoices(now).filter((d) => has(d.label)).map((d) => ({ kind: 'date', ...d })) }
    ];
    return out;
  }, [ws.tree, ws.spaceName, item.id, inCall, invited, members, company, team?.name, myEmail, canOpen, now]);

  /** Who to tell, by what the API knows them by. */
  const targetOf = useCallback((p: Person): ShareTarget | null => {
    const seat = seatOf(p);
    return p.email ? { email: p.email } : seat ? { seat } : null;
  }, [seatOf]);

  /* A tag written offline goes with what was typed: it's told when the connection's back, while the document's open. */
  const say = mention.mutate;
  const unsaid = useRef<MentionBody[]>([]);
  const send = useCallback(function send(tag: MentionBody) {
    say({ document: item.id, ...tag }, { onError: (e) => {
      if (errorCode(e) === 'network') unsaid.current.push(tag);
      else tlog.warn('someone tagged wasn’t told', { err: e });
    } });
  }, [say, item.id]);
  useEffect(() => {
    const back = () => { for (const tag of unsaid.current.splice(0)) send(tag); };
    addEventListener('online', back);
    return () => removeEventListener('online', back);
  }, [send]);

  const onLit = ws.call?.onTagged;
  const tell = useCallback((p: Person, block: string) => {
    const to = targetOf(p);
    if (to) send({ to, block });
    const inThisCall = inCall.find((c) => c.person.id === p.id);
    if (inThisCall) onLit?.(inThisCall.connection);
  }, [targetOf, send, inCall, onLit]);

  /** Someone was just tagged: tell them, or ask, once, right where you are. */
  const tagged = useCallback(async (person: Person, block: string, rect: () => DOMRect) => {
    const to = targetOf(person);
    if (!to || !canShare) { tell(person, block); return; }
    /* What decides is what's true now, not what the list last read. */
    const now = await qc.fetchQuery({ ...q.documentShare(workspaceId, item.id, pass), staleTime: 0 }).catch((e: unknown) => { tlog.warn('who can open this wasn’t read', { err: e }); return null; });
    if (!now || opensFor(now, person)) { tell(person, block); return; }
    if (asked.current.has(person.id)) return;
    asked.current.add(person.id);
    setAsking((was) => [...was, { person, block, rect }]);
  }, [targetOf, canShare, tell, qc, workspaceId, item.id, pass, opensFor]);

  const next = useCallback(() => setAsking((was) => was.slice(1)), []);
  const ask = asking[0] ?? null;
  /** Let them edit or read: sharing is this, and only this. Then they can be told. */
  const answer = useCallback((role: 'edit' | 'read') => {
    if (!ask) return;
    const to = targetOf(ask.person);
    next();
    if (!to) return;
    changes.set.mutateAsync({ to: [to], role }).then(() => {
      ws.say(wsToast.canOpen(firstName(ask.person.name), role, nameOf(item)));
      tell(ask.person, ask.block);
    }, (e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); });
  }, [ask, targetOf, next, changes.set, ws.say, item, tell]);

  return { sections, faces, tagged, ask, answer, notNow: next };
}

/** Where someone's tag is on the page, for asking beside it, or `fallback` if it's gone by then. */
export function tagRect(person: string, block: string, fallback: Rect | null): () => DOMRect {
  const last = fallback ? new DOMRect(fallback.left, fallback.top, fallback.width, fallback.height) : new DOMRect(0, 0, 0, 0);
  return () => document.querySelector(`[data-b="${CSS.escape(block)}"] .wn[data-p="${CSS.escape(person)}"]`)?.getBoundingClientRect() ?? last;
}
