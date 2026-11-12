/*
 * A call that happened, at /calls/<note ID> (features/notes/Call.tsx). `at`: a moment in the recording, in seconds, from a
 * link in an answer, a search or a series: the call opens there, with the transcript at the line said then, and doesn't play
 * unless `play` says to; once it has, `play` leaves the address. `room`: the breakout room's section the link came to, which
 * opens in Notes. `tab`: what's open beside the player, Notes unless it says otherwise, or the Transcript for a moment.
 */
import { NoteMomentSchema, NotePlayParamSchema, NoteRoomParamSchema } from '@alcove/api';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback } from 'react';
import { CallPage, Missing, type CallTab } from '~/features/notes/Call';
import { q } from '~/lib/queries';

const TABS: readonly CallTab[] = ['notes', 'transcript', 'shared', 'yours'];
const tabOf = (v: unknown): CallTab | undefined => TABS.find((t) => t === v);

export const Route = createFileRoute('/_app/calls/$noteId')({
  validateSearch: (s: Record<string, unknown>): { at?: number | undefined; room?: string | undefined; play?: true | undefined; tab?: CallTab | undefined } => {
    const at = NoteMomentSchema.safeParse(s['at']);
    const room = NoteRoomParamSchema.safeParse(s['room']);
    const play = NotePlayParamSchema.safeParse(s['play']);
    return { at: at.success ? at.data : undefined, room: room.success ? room.data : undefined, play: play.success ? play.data : undefined, tab: tabOf(s['tab']) };
  },
  loader: ({ context, params }) => (params.noteId === 'example' ? undefined : context.queryClient.ensureQueryData(q.note(params.noteId))),
  errorComponent: ({ error }: ErrorComponentProps) => <Missing error={error} />,
  component: CallRoute
});

function CallRoute() {
  const { noteId } = Route.useParams();
  const { at, room, play, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  /* Play from plays once: `play` leaves the address as soon as it has, and the page stays where it is. */
  const played = useCallback(() => void navigate({ search: (s) => ({ ...s, play: undefined }), hash: true, replace: true, resetScroll: false, hashScrollIntoView: false }), [navigate]);
  const onTab = useCallback((t: CallTab) => void navigate({ search: (s) => ({ ...s, tab: t }), hash: true, replace: true, resetScroll: false, hashScrollIntoView: false }), [navigate]);
  return <CallPage noteId={noteId} at={at} room={room} play={play === true} tab={tab ?? (at !== undefined && room === undefined ? 'transcript' : 'notes')} onTab={onTab} onPlayed={played} />;
}
