/*
 * Notes from a call that had no workspace (`CallEndResult.filed` false), for its organizer: file them in one of theirs they can
 * edit in, or in a new one, made for the call with everyone invited in it. Filed, the call's folder (its notes, follow-ups and
 * transcript) is at the top of that workspace, and the workspace is the call's from now on, and its series' later calls'.
 * Leaving them in Notes is doing nothing. At the end of the call (LeaveSheet), and on the note while it isn't filed.
 */
import { errorMessage } from '@alcove/api';
import { Button, Icon, Notice, Select } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { namesIn } from '~/features/workspace/List';
import { log } from '~/lib/log';
import { q, useFileNotes } from '~/lib/queries';

const flog = log.child({ component: 'file-notes' });

/** A new workspace, as the choice says it. */
const NEW = 'new';

/** `ticked`: once filed, a tick says so; leave it out where something round it has its own mark (a Notice's). */
export function FileNotes({ meetingId, noteId, ticked = true }: { meetingId: string; noteId: string; ticked?: boolean | undefined }) {
  const spaces = useQuery(q.workspaces()).data ?? [];
  const file = useFileNotes();
  const named = namesIn(spaces);
  /* Only somewhere the organizer can make things in can take the call's folder. */
  const mine = spaces.filter((w) => w.name !== null && (w.role === 'admin' || w.role === 'edit'));
  const [to, setTo] = useState<string>(NEW);
  const [failed, setFailed] = useState<string | null>(null);
  /** Where they went, once they have. */
  const [filed, setFiled] = useState<{ id: string; name: string } | null>(null);
  if (filed) {
    /* A new one is named after the call: the Drive says its name once it's read again. */
    const there = spaces.find((w) => w.id === filed.id);
    return (
      <p className="nd-file-t is-done" role="status">
        {ticked && <Icon name="check" size={16} />}<span>Filed in <b>{there ? named(there) : filed.name}</b>. Its notes, follow-ups and transcript are in a folder there.</span>
      </p>
    );
  }
  const go = () => {
    setFailed(null);
    const picked = mine.find((w) => w.id === to);
    file.mutateAsync({ meetingId, noteId, to: picked ? { workspaceId: picked.id } : { newWorkspace: true } }).then((m) => {
      setFiled({ id: m.workspaceId ?? '', name: picked ? named(picked) : 'a new workspace' });
    }, (e: unknown) => {
      flog.info('notes not filed', { meetingId, made: !picked, err: e });
      setFailed(errorMessage(e));
    });
  };
  return (
    <div className="nd-file">
      <p className="nd-file-t">These notes aren’t in a workspace yet.</p>
      <div className="nd-file-row">
        <Select label="Where these notes go" value={mine.some((w) => w.id === to) ? to : NEW} align="start" className="nd-file-pick" disabled={file.isPending}
          options={[{ value: NEW, label: 'New workspace', icon: 'plus' }, ...mine.map((w) => ({ value: w.id, label: named(w), icon: 'folders' as const }))]}
          onChange={setTo} />
        <Button variant="secondary" size="sm" loading={file.isPending} onClick={go}>File them</Button>
      </div>
      {failed && <p className="nd-file-err" role="alert">{failed}</p>}
    </div>
  );
}

/**
 * On the note, for its organizer while the call is over and its notes aren't in a workspace: the same, in a small notice. Once
 * filed it stays to say where, until the page is left.
 */
export function UnfiledNotice({ meetingId, noteId }: { meetingId: string; noteId: string }) {
  const meeting = useQuery(q.meeting(meetingId)).data;
  const unfiled = meeting?.isOrganizer === true && meeting.status === 'ended' && meeting.workspaceId === null;
  const [shown, setShown] = useState(false);
  if (unfiled && !shown) setShown(true);
  if (!shown) return null;
  return <Notice icon="folders" className="nd-filing"><FileNotes meetingId={meetingId} noteId={noteId} ticked={false} /></Notice>;
}
