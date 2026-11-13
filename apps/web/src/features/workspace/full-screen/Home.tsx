/*
 * A workspace's Home, full screen: its name on the evening after sunset, running up behind the bar and fading into the page;
 * the line on what it's for; who's in it; what was edited lately, as large previews; and the calls kept in it, as Calls rows.
 * A call's own workspace has none: it opens on what the call made (Workspace.tsx).
 */
import { errorMessage, firstName, type DocumentPreview, type Meeting, type NoteSummary, type PreviewLine, type WorkspaceItem } from '@alcove/api';
import { CallChip, CallRow, FileCard, WsAbout, WsEmpty, WsHomeBand, WsHomeSection, WsMenu, WsPeopleLine, wsToast, type LinkRender, type ThumbLine, type ThumbProps, type WsMenuRow, type WsNaming } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState, type ReactElement } from 'react';
import { repeatLineHere } from '~/features/calls/scheduling/words';
import { useNow } from '~/lib/live';
import { callQueries } from '~/features/calls/list/queries';
import { noteQueries } from '~/features/notes/queries';
import { workspaceQueries, useSetWorkspaceAbout } from '~/features/workspace/queries';
import { callLength, hm, noteDay } from '~/lib/time';
import { PageBar } from './Bar';
import { callDayTitle, callsIn } from './calls';
import { useWs } from '../context';
import { useFrame } from './Frame';
import { editedLabel } from './Origin';
import { PersonCard } from '../sharing/People';
import { PeopleSheet } from '../sharing/Sheets';
import { documentsIn, nameOf } from '../tree/tree';

/** How many of what was edited lately Home shows. */
const RECENT = 3;

/** How a line of a document is marked on its card: a bullet, a tick box, or nothing. */
const markOf = (line: PreviewLine): ThumbLine['mark'] => (line.kind === 'bullet' ? 'dot' : line.kind === 'todo' ? 'todo' : line.kind === 'done' ? 'done' : undefined);

/** What a card's picture draws: a board; a document that's only photos, only a PDF, or only a video; or a document's first lines. */
function thumbOf(item: WorkspaceItem, preview: DocumentPreview | undefined): Pick<ThumbProps, 'kind' | 'count' | 'lines'> {
  if (item.kind === 'board') return { kind: 'board' };
  if (preview && preview.lines.length === 0) {
    if (preview.pictures > 0) return { kind: 'photos', count: preview.pictures };
    if (preview.file === 'PDF') return { kind: 'pdf' };
  }
  return { kind: 'doc', lines: (preview?.lines ?? []).map((l) => ({ text: l.text, mark: markOf(l) })) };
}

/** The people in a workspace, by name, you last: "Priya, Kofi, Ines and you". */
function namesOf(people: readonly { name: string; isMe: boolean }[]): string {
  const others = people.filter((p) => !p.isMe).map((p) => firstName(p.name));
  if (others.length === 0) return 'Just you';
  if (others.length > 5) return `${others.slice(0, 4).join(', ')} and ${others.length - 4} others`;
  return `${others.join(', ')} and you`;
}

/** A call's link, as a Calls row draws it. */
const linkTo = (to: { noteId: string } | { meetingId: string }): LinkRender => (props) => ('noteId' in to
  ? <Link {...props} to="/calls/$noteId" params={{ noteId: to.noteId }} />
  : <Link {...props} to="/calls/upcoming/$meetingId" params={{ meetingId: to.meetingId }} />);

/** The calls kept in a workspace: the next of each that's coming (yours, which you can see are kept here), then each one past, newest first. */
function useCalls(): ReactElement[] {
  const ws = useWs();
  const now = useNow(60_000);
  const notes = useQuery(noteQueries.notes()).data ?? [];
  const inbox = useQuery(noteQueries.inbox()).data;
  const upcoming = useQuery(callQueries.upcoming()).data ?? [];
  const kept = callsIn(ws.tree);
  const ahead = upcoming
    .filter((m) => m.workspaceId === ws.workspaceId && m.status === 'scheduled' && Date.parse(m.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((m, i, all) => !m.seriesId || all.findIndex((x) => x.seriesId === m.seriesId) === i);
  const past = kept.flatMap((c): NoteSummary[] => { const n = c.noteId === null ? undefined : notes.find((x) => x.id === c.noteId); return n ? [n] : []; });
  const soonRow = (m: Meeting): ReactElement => {
    const everyone = [m.organizer, ...m.guests];
    return (
      <CallRow key={`m:${m.id}`} soon who={{ faces: everyone }} title={m.title} open={linkTo({ meetingId: m.id })}
        tag={m.repeat ? { icon: 'repeat', text: repeatLineHere(m.repeat, new Date(m.startsAt)) } : undefined}
        line={namesOf(everyone.map((p) => ({ name: p.name, isMe: p.email === ws.me?.email })))} notesOff={m.notes === 'off'}
        when={{ at: hm(m.startsAt), length: callDayTitle(m.startsAt, new Date(now)) }} />
    );
  };
  const pastRow = (n: NoteSummary): ReactElement => {
    const confirm = inbox?.decisions.filter((d) => d.noteId === n.id).length ?? 0;
    const mine = inbox?.followUps.filter((a) => a.noteId === n.id).length ?? 0;
    const chips = [
      ...(confirm > 0 ? [<CallChip key="d" kind="decide">{confirm} to confirm</CallChip>] : []),
      ...(mine > 0 ? [<CallChip key="f" kind="follow">{mine === 1 ? '1 follow-up' : `${mine} follow-ups`}</CallChip>] : [])
    ];
    return (
      <CallRow key={`n:${n.id}`} who={{ faces: n.people }} title={n.title} open={linkTo({ noteId: n.id })} gist={n.excerpt || undefined}
        chips={chips.length > 0 ? chips : undefined} when={{ at: noteDay(n.startedAt, new Date(now)), length: callLength(n.duration) }} />
    );
  };
  return [...ahead.map(soonRow), ...past.map(pastRow)];
}

/** The line on what the workspace is for, under its name: an admin presses it to say, or to change it, in place. */
function About() {
  const ws = useWs();
  const line = useQuery({ ...workspaceQueries.workspaceAbout(ws.workspaceId), enabled: ws.sent.role !== null }).data;
  const set = useSetWorkspaceAbout(ws.workspaceId);
  const [editing, setEditing] = useState(false);
  if (line === undefined) return null;
  const field: WsNaming | null = editing ? {
    name: line, placeholder: 'What this workspace is for', onCancel: () => setEditing(false),
    onCommit: (to) => {
      setEditing(false);
      const next = to.replace(/\s+/g, ' ').trim();
      if (next !== line) set.mutateAsync(next).catch((e: unknown) => { ws.say(wsToast.failed(`Couldn’t save what it’s for. ${errorMessage(e)}`)); });
    }
  } : null;
  return <WsAbout text={line} editing={field} onEdit={ws.sent.role === 'admin' ? () => setEditing(true) : undefined} />;
}

export function Home() {
  const ws = useWs();
  const frame = useFrame();
  const now = useNow(60_000);
  const member = ws.sent.role !== null;
  const people = useQuery({ ...workspaceQueries.workspacePeople(ws.workspaceId), enabled: member }).data;
  const recent = useMemo(() => documentsIn(ws.tree).filter((i) => i.trashedAt === null).sort((a, b) => b.editedAt.localeCompare(a.editedAt)).slice(0, RECENT), [ws.tree]);
  const docs = recent.filter((i) => i.kind === 'document').map((i) => i.id);
  const previews = useQuery({ ...workspaceQueries.workspacePreviews(ws.workspaceId, docs), enabled: docs.length > 0 }).data;
  const calls = useCalls();
  const [sheet, setSheet] = useState<'people' | 'more' | null>(null);
  const [card, setCard] = useState<string | null>(null);

  const others = ws.others.map((o) => o.person);
  const faces = others.map((person) => ({
    person, card: { open: card === person.id, onOpenChange: (to: boolean) => setCard(to ? person.id : null), content: card === person.id ? <PersonCard person={person} onDone={() => setCard(null)} /> : null }
  }));
  const more: WsMenuRow[] = [
    ...(ws.sent.role === 'admin' ? [{ id: 'rename', icon: 'pen' as const, label: 'Rename', onSelect: () => { setSheet(null); ws.showPages(); ws.setNaming('rename'); } }] : []),
    { id: 'link', icon: 'link' as const, label: 'Copy link', onSelect: () => {
      setSheet(null);
      navigator.clipboard.writeText(`${location.origin}/drive/${ws.workspaceId}`).then(() => ws.say(wsToast.linkCopied()), () => ws.say(wsToast.failed('Couldn’t copy the link.')));
    } }
  ];
  return (
    <>
      <PageBar faces={faces}
        share={member ? { open: sheet === 'people', onOpenChange: (to) => setSheet(to ? 'people' : null), content: sheet === 'people' ? <PeopleSheet /> : null } : undefined}
        more={{ open: sheet === 'more', onOpenChange: (to) => setSheet(to ? 'more' : null), content: sheet === 'more' ? <WsMenu rows={more} label={`More for ${ws.spaceName}`} /> : null }}
        moreLabel={`More for ${ws.spaceName}`} />
      <div className="wf-home-scroll" onScroll={(e) => frame?.setScrolled(e.currentTarget.scrollTop > 8)}>
        <WsHomeBand name={ws.spaceName} />
        <div className="wf-home">
          <About />
          {people && <WsPeopleLine people={people.map((p) => p.person)} line={namesOf(people.map((p) => ({ name: p.person.name, isMe: p.isMe })))} onOpen={() => setSheet('people')} />}
          {recent.length > 0 ? (
            <WsHomeSection title="Recently edited" className="wf-recent">
              <div className="wf-cards">
                {recent.map((item) => {
                  const thumb = thumbOf(item, previews?.find((p) => p.id === item.id));
                  return (
                    <FileCard key={item.id} size="lg" kind={thumb.kind} name={nameOf(item)} by={editedLabel(item.editedAt, now)} thumb={{ count: thumb.count, lines: thumb.lines }}
                      onOpen={() => ws.go({ kind: 'document', id: item.id })} />
                  );
                })}
              </div>
            </WsHomeSection>
          ) : (
            <WsEmpty space={ws.spaceName} page onDocument={ws.canChange ? () => ws.actions.newDocument(null) : undefined} onFolder={ws.canChange ? () => { ws.showPages(); ws.setDraft({ parent: null }); } : undefined} />
          )}
          {calls.length > 0 && (
            <WsHomeSection title="Calls">
              <div className="wf-rows">{calls}</div>
            </WsHomeSection>
          )}
        </div>
      </div>
    </>
  );
}
