/*
 * Every document someone can open in a workspace, as text, for searching in the browser: read one at a time from what each
 * is now, and streamed, so nothing of it is kept here.
 */
import type { StreamingApi } from 'hono/utils/stream';
import type { Deps } from '../../../platform/context';
import { runDoc } from './pool';
import { log } from '../../../platform/log';
import { limitKey, roleOf, trashOf, workspaceFor, workspaceVersion, type Reader } from '../access';
import { type Sending, takeSending, lineFor } from './traffic';
import { documentRow, sizeOf, working, sealedLog, kindOf, jobFor, report } from './documents';

const dlog = log.child({ component: 'documents' });

/**
 * Every document a reader can open, as words, one line each, for searching in their browser. Nothing in Trash. Refused here,
 * before a line is written, like anything else. One that won't open is left out, and the rest still come, and it's closed
 * for everyone as it would be for opening it. It stops as soon as they can't read what's next: whatever changes who has what
 * moves the workspace's version on.
 */
export async function searchText(d: Deps, reader: Reader, workspaceId: string, address: string): Promise<(out: StreamingApi) => Promise<void>> {
  const who = limitKey(reader);
  const w = await workspaceFor(d, reader, workspaceId);
  const opens = Object.entries(w.state.items).filter(([id, item]) => item.kind !== 'folder' && roleOf(reader, w, id, item) !== undefined && !trashOf(w.state, id));
  return async (out) => {
    let current = w;
    for (const [id] of opens) {
      if (out.aborted) return;
      try {
        if ((await workspaceVersion(d, workspaceId)) !== current.version) current = await workspaceFor(d, reader, workspaceId);
      } catch (e) {
        dlog.debug('search stopped: access ended', { workspaceId, err: e });
        return;
      }
      const now = current.state.items[id];
      if (!now || roleOf(reader, current, id, now) === undefined || trashOf(current.state, id)) continue;
      let room: Sending | undefined;
      try {
        const row = await documentRow(current, id);
        if (row.closed) continue;
        room = takeSending(d, who, address, sizeOf(row));
        const done = await working(current, id, row, async () => runDoc(d.docs, 'searchLine', { ...(await sealedLog(current, id)), id, itemKind: now.kind, name: now.name, kind: kindOf(now) }, jobFor(current, id, row, who)));
        report(current, id, done.found);
        room.settle(done.line.length);
        if (!(await lineFor(d, out, done.line))) return;
      } catch (e) {
        dlog.warn('document not read for search', { workspaceId, documentId: id, err: e });
      } finally {
        room?.release();
      }
    }
  };
}
