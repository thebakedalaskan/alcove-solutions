/*
 * A call's own pages, in its folder at the top of its home (docs: Calls and recordings › The call's home): while you're in
 * the call, its live notes, follow-ups and transcript, the same rows as everywhere in the call; once it's over, its note,
 * for someone who has it. The server says which (`ItemCall`), from the call's and the note's own access, so someone without
 * the notes sees the folder and whatever else is in it. Nothing here opens the note in a call's place: from a call, it opens
 * in a tab of its own.
 */
import { CALL_PAGES, type CallPage, type ItemCall } from '@alcove/api';
import { WsRow, type IconName } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useWs } from './context';
import { LiveRows } from './live/LiveRows';

const NAMES: Record<CallPage, { name: string; icon: IconName; hash?: string | undefined }> = {
  notes: { name: 'Notes', icon: 'notes' },
  'follow-ups': { name: 'Follow-ups', icon: 'todos', hash: 'follow-ups' },
  transcript: { name: 'Transcript', icon: 'transcript', hash: 'transcript' }
};

function NoteRows({ noteId, depth }: { noteId: string; depth: number }) {
  const ws = useWs();
  const navigate = useNavigate();
  const open = (page: CallPage) => {
    const { hash } = NAMES[page];
    if (ws.mode === 'call') { window.open(`/notes/${encodeURIComponent(noteId)}${hash ? `#${hash}` : ''}`, '_blank', 'noopener'); return; }
    void navigate({ to: '/notes/$noteId', params: { noteId }, ...(hash ? { hash } : {}) });
  };
  return <>{CALL_PAGES.map((page) => <WsRow key={page} id={`${noteId}:${page}`} name={NAMES[page].name} kind="live" icon={NAMES[page].icon} depth={depth} onOpen={() => open(page)} />)}</>;
}

/** The pages of the call `call` is the folder of, `depth` folders in. */
export function CallPages({ call, depth }: { call: ItemCall; depth: number }) {
  if (call.here) return <LiveRows depth={depth} area="tree" />;
  return call.noteId ? <NoteRows noteId={call.noteId} depth={depth} /> : null;
}
