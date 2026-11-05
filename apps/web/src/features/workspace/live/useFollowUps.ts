/*
 * The call's follow-ups as one list: what was said and what people added come with the call, so they're as live as it is, and
 * what's written in documents comes from `CallSession.followUps`. A line in a document that says the same as something said,
 * for the same person, is that follow-up, not another: it's one row, and ticking it ticks both.
 */
import { errorMessage, type CallState, type DocFollowUp, type Person } from '@alcove/api';
import { wsToast, type WsFollowUp } from '@alcove/ui';
import { useCallback, useMemo, useState } from 'react';
import { useLive } from '~/lib/live';
import type { Ws } from '../context';
import { dayWords, dueWords } from './dates';
import { clockAt, personNamed, sameName } from './lines';
import type { LiveCall } from './types';

/** A row, what it takes to tick it, and whether it's yours. */
export interface FollowUpRow extends WsFollowUp { mine: boolean; ticks: ((done: boolean) => Promise<void>)[]; said: { text: string; owner?: string | undefined; due?: string | undefined } }

const folded = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const face = (s: CallState, name: string | undefined): Pick<Person, 'name'> & Partial<Person> | null => (name ? personNamed(s, name) ?? { name } : null);

/** Whether a document's to-do is for you: by who it tags, as this workspace knows you, or else by name. */
function isYours(d: DocFollowUp, me: Person | undefined, myId: string | undefined): boolean {
  return d.mentions.some((m) => m.id === myId || m.id === me?.id || (me !== undefined && m.name === me.name));
}

export function useFollowUps(live: LiveCall, ws: Pick<Ws, 'here' | 'workspaceId' | 'go' | 'say'>) {
  const { session } = live;
  const state = useLive(session);
  const written = useLive(session.followUps);
  /* A tick shows as it's pressed, until the call says so too. */
  const [ticking, setTicking] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { here, workspaceId, go } = ws;
  const notes = state.liveNotes;
  const me = state.participants.find((p) => p.isMe)?.person;
  const myId = here.find((h) => h.isMe)?.person.id;
  /* Notes written for what someone may read of the call can't be ticked, and nor can anything by a guest. */
  const mayTick = state.role !== 'guest' && notes.notes?.read.whileHere !== true;

  const rows = useMemo((): FollowUpRow[] => {
    const now = new Date();
    const tickSaid = (id: string) => (mayTick ? [(done: boolean) => session.tickFollowUp(id, done)] : []);
    const said = (notes.notes?.next ?? []).map((f) => ({ f, when: f.evidence[0]?.said ?? 0, source: `Said at ${clockAt(state, f.evidence[0]?.said ?? 0)}` }));
    const typed = notes.added.map((f) => ({ f, when: f.at, source: 'Added by hand' }));
    const out = [...said, ...typed].sort((a, b) => a.when - b.when).map(({ f, source }): FollowUpRow => ({
      id: f.id, text: f.text, done: f.done, person: face(state, f.owner), name: f.owner ? firstOf(f.owner) : '', due: dueWords(f.due, now), source,
      locked: !mayTick, mine: me !== undefined && f.owner !== undefined && sameName(f.owner, me.name), ticks: tickSaid(f.id), said: { text: f.text, owner: f.owner, due: f.due }
    }));
    /* Each thing said is the same as one line at most: a second copy in a document is a to-do of its own. */
    const joined = new Set<string>();
    for (const d of (written?.items ?? []).filter((x): x is DocFollowUp => x.from === 'document')) {
      const tag = d.mentions[0];
      const date = d.dates[0];
      const open = d.workspaceId === workspaceId ? () => go({ kind: 'document', id: d.documentId, block: d.block }) : undefined;
      const tickDoc = d.canTick ? [(done: boolean) => session.tickDocumentFollowUp({ workspaceId: d.workspaceId, documentId: d.documentId, block: d.block, done })] : [];
      const same = out.find((r) => !joined.has(r.id) && folded(r.text) === folded(d.text) && (tag === undefined || r.name === '' || sameName(r.name, tag.name)));
      if (same) {
        joined.add(same.id);
        same.source = `${same.source} · ${d.document}`;
        same.onSource = open;
        same.done = d.done;
        same.ticks = [...same.ticks, ...tickDoc];
        same.locked = same.ticks.length === 0;
        continue;
      }
      out.push({
        id: `${d.documentId}:${d.block}`, text: d.text.replace(/\s+/g, ' ').trim(), done: d.done, person: tag ? face(state, tag.name) : null, name: tag ? firstOf(tag.name) : '', due: date ? dayWords(date, now) : 'No date',
        source: d.document, onSource: open, locked: tickDoc.length === 0, mine: isYours(d, me, myId), ticks: tickDoc, said: { text: d.text }
      });
    }
    return out.map((r) => { const done = ticking.get(r.id); return done === undefined ? r : { ...r, done }; });
  }, [notes, written, state.participants, state.startedAt, mayTick, me, myId, session, workspaceId, go, ticking]);

  const say = ws.say;
  const tick = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row || row.ticks.length === 0) return;
    const done = !row.done;
    setTicking((was) => new Map(was).set(id, done));
    const settled = () => setTicking((was) => { const next = new Map(was); next.delete(id); return next; });
    Promise.all(row.ticks.map((t) => t(done))).then(settled, (e: unknown) => { settled(); say(wsToast.failed(errorMessage(e))); });
  }, [rows, say]);

  return { rows, tick, open: rows.filter((r) => !r.done).length, canAdd: mayTick && state.notes.noteId !== null };
}
