/*
 * The call's notes in the organizer's lobby, until it starts: on or off, and What the notes keep, opening in place with
 * the same switches scheduling has (the transcript, the recording, shared screens). Each switch saves at once, and what's
 * still saving goes to `track`, saying whether it was saved, so Join can wait for it and the call starts as the lobby
 * shows it; once Join is pressed (`locked`) nothing here switches. A change that can't be saved goes back and says so.
 *
 * What a switch shows while it saves is the lobby's own; each answer the call gives goes straight into what's cached of
 * it, so once nothing is saving the lobby shows the call as it was last saved, never a read from before.
 */
import { errorMessage, type Meeting, type NotesChoices, type NotesSetting } from '@alcove/api';
import { Icon, KeepSwitches, Switch, keptLines, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useUpdateCall } from '~/features/calls/list/queries';
import { callKeys } from '~/features/calls/list/queryKeys';
import { useMyModelUnencrypted } from '~/features/notes/models';
import { log } from '~/lib/log';

const llog = log.child({ component: 'lobby' });

/** Notes for the call, until it starts: said once, switched here, and what they keep. `who` says who gets them. */
export function LobbyNotes({ meeting, who, locked, track }: { meeting: Meeting; who: string; locked: boolean; track: (saving: Promise<boolean>) => void }) {
  const qc = useQueryClient();
  const update = useUpdateCall();
  const updateKeep = useUpdateCall();
  const toast = useToast();
  const modelPrivate = !useMyModelUnencrypted();
  // What's switched and still saving: notes on or off, and what they keep.
  const [saving, setSaving] = useState<NotesSetting | null>(null);
  const [keeping, setKeeping] = useState<NotesChoices | null>(null);
  const [open, setOpen] = useState(false);
  const rows = useId();
  // One change of what's kept is on its way at a time. One made meanwhile waits for it, and goes as the switches are then.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef<NotesChoices | null>(null);
  const unfinished = useRef(0);
  const notes = saving ?? meeting.notes;
  const choices = keeping ?? meeting.choices;
  /** The call as a save left it, for the lobby to read at once, by whichever link it was read (its own, or its series'). */
  const saved = (m: Meeting) => {
    for (const [key, read] of qc.getQueriesData<Meeting | null>({ queryKey: callKeys.byCodes })) if (read?.id === m.id) qc.setQueryData(key, m);
  };

  const change = (on: boolean) => {
    if (locked || update.isPending) return;
    const was = meeting.notes;
    const next: NotesSetting = on ? 'on' : 'off';
    setSaving(next);
    track(update.mutateAsync({ id: meeting.id, input: { notes: next } }).then((m) => {
      saved(m);
      setSaving(null);
      return true;
    }, (e: unknown) => {
      llog.warn('changing the call’s notes failed', { err: e, meetingId: meeting.id });
      setSaving(null);
      toast(`Couldn’t turn notes ${next}, so they’re still ${was}. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
      return false;
    }));
  };
  const keep = (next: NotesChoices) => {
    if (locked) return;
    setKeeping(next);
    waiting.current = next;
    unfinished.current += 1;
    const sent = queue.current.then(async () => {
      const wanted = waiting.current;
      // A later switch already sent this one with it.
      if (!wanted) return true;
      waiting.current = null;
      saved(await updateKeep.mutateAsync({ id: meeting.id, input: { choices: wanted } }));
      return true;
    }).catch((e: unknown) => {
      waiting.current = null;
      llog.warn('changing what the call’s notes keep failed', { err: e, meetingId: meeting.id });
      setKeeping(null);
      toast(`Couldn’t change what the notes keep, so they keep what they did. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
      return false;
    }).finally(() => {
      unfinished.current -= 1;
      if (!unfinished.current) setKeeping(null);
    });
    queue.current = sent;
    track(sent);
  };

  const kept = keptLines(choices);
  return (
    <div className="rg-notes">
      <Icon name="notes" size={18} />
      <span className="min-w-0"><b>Notes {notes}</b><small>{notes === 'on' ? who : 'You can turn them on during the call.'}</small></span>
      <Switch checked={notes === 'on'} label="Notes" disabled={locked} onChange={change} />
      {notes === 'on' && (
        <div className="rg-keep">
          <button type="button" className="rg-keep-h" aria-expanded={open} aria-controls={open ? rows : undefined} onClick={() => setOpen((o) => !o)}>
            What the notes keep<Icon name="down" size={13} className="chev" />
          </button>
          {open ? (
            <div id={rows} className="rg-keep-b"><KeepSwitches choices={choices} modelPrivate={modelPrivate} disabled={locked} onChoices={keep} /></div>
          ) : kept.length > 0 && <div className="kept">{kept.map((l) => <span key={l}>{l}</span>)}</div>}
        </div>
      )}
    </div>
  );
}
