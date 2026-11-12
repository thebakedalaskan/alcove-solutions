/*
 * Where a document came from, outside a call: under its title, the call it came from as a chip that opens the call, and who
 * made it with when it was last edited; under a quote from a call, who said it, in which call, and a ▶ chip that opens the
 * call at that moment. What a call is called is read from its notes, for whoever has them; anyone else is told who and when.
 */
import { firstName, type NoteSummary, type WorkspaceItem } from '@alcove/api';
import { MomentChip, WsDocMeta } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { q } from '~/lib/queries';
import { agoLabel, dayMonth, hm, noteDay, position } from '~/lib/time';
import { beforeTheCall, callDay, cameFrom } from './calls';
import { useWs, type Ws } from './context';
import { clockOf } from './live/dates';
import { nameOf } from './tree';

/** When something was last edited: "just now" and minutes ago within the hour, then "at 08:40" today, "yesterday", "Tue 27 Oct". */
export function editedLabel(iso: string, now: number): string {
  if (now - Date.parse(iso) < 3_600_000) return `Edited ${agoLabel(iso, now)}`;
  const day = noteDay(iso, new Date(now));
  return day === 'Today' ? `Edited at ${hm(iso)}` : `Edited ${day === 'Yesterday' ? 'yesterday' : day}`;
}

/** The chip under a document's title: the call it came from, or, in a call's own workspace, the call it's for. */
function fromOf(ws: Ws, item: WorkspaceItem, notes: readonly NoteSummary[], now: number, open: (noteId: string) => void): { label: string; onClick?: (() => void) | undefined } | undefined {
  const kept = cameFrom(ws.tree, item, notes);
  if (kept) {
    const noteId = kept.noteId;
    const note = noteId === null ? undefined : notes.find((n) => n.id === noteId);
    return { label: note ? `From ${note.title}, ${callDay(note.startedAt, new Date(now))}` : `From ${nameOf(kept.folder)}`, onClick: noteId ? () => open(noteId) : undefined };
  }
  const home = ws.home;
  if (!home) return undefined;
  if (beforeTheCall(home, now)) return { label: `For ${home.title}, ${callDay(home.at, new Date(now))} at ${hm(home.at)}` };
  const noteId = home.call?.noteId ?? null;
  return { label: `${Date.parse(item.createdAt) < Date.parse(home.at) ? 'For' : 'From'} ${home.title}, ${callDay(home.at, new Date(now))}`, onClick: noteId ? () => open(noteId) : undefined };
}

/** Under a document's title. */
export function DocMeta({ item, now }: { item: WorkspaceItem; now: number }) {
  const ws = useWs();
  const navigate = useNavigate();
  const notes = useQuery({ ...q.notes(), enabled: ws.owner !== null }).data ?? [];
  const from = fromOf(ws, item, notes, now, (noteId) => { void navigate({ to: '/calls/$noteId', params: { noteId } }); });
  return <WsDocMeta from={from} person={item.by} name={item.by ? firstName(item.by.name) : null} edited={editedLabel(item.editedAt, now)} />;
}

/** Under a quote from a call. */
export function QuoteCite({ note, line, name, at }: { note: string | null; line: string | null; name: string; at: string }) {
  const ws = useWs();
  const read = useQuery({ ...q.note(note ?? ''), enabled: note !== null && ws.owner !== null, retry: false, staleTime: 60_000 }).data;
  const who = firstName(name) || 'Someone';
  if (note === null || !read) return <span>{who} · {clockOf(at)}</span>;
  const said = line === null ? undefined : read.transcript?.find((l) => l.id === line);
  const where = ws.home?.call?.noteId === note ? 'in this call' : `in ${read.title} on ${dayMonth(new Date(read.startedAt))}`;
  return (
    <>
      <span>{who}, {where}</span>
      {said && (
        <MomentChip time={position(said.at)} label={`Open ${read.title} at ${position(said.at)}`}
          link={(props) => <Link {...props} to="/calls/$noteId" params={{ noteId: note }} search={{ at: said.at, play: true }} />} />
      )}
    </>
  );
}
