/*
 * What was worked on in the call, on its note: each document someone changed during it, and who, for whoever reads the note
 * and can open it now (`Note.workedOn`). Each opens in the app, in your theme: the same document, nothing copied or archived.
 */
import { firstName, type NoteWorkedOn } from '@alcove/api';
import { WsWorkedOn } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { Section } from './parts';

/** "Priya, Aiko and you edited this". You come last; past four people, the first few and how many more, you among them. */
export function workedBy(by: NoteWorkedOn['by']): string {
  const others = by.filter((b) => !b.isMe).map((b) => firstName(b.name) || 'Someone');
  const me = by.some((b) => b.isMe);
  const names = me ? [...others, 'you'] : others;
  const shown = names.length <= 4 ? names : me ? ['you', ...others.slice(0, 2)] : others.slice(0, 3);
  const more = names.length - shown.length;
  const list = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length < 2 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} edited this`;
}

/** A section of the note. Boards open nowhere in the app yet, so only documents are listed: nothing here leads to a dead end. */
export function WorkedOn({ worked }: { worked: readonly NoteWorkedOn[] }) {
  const navigate = useNavigate();
  const documents = worked.filter((w) => w.kind === 'document');
  if (!documents.length) return null;
  return (
    <Section title="Worked on in this call" className="nd-worked">
      <WsWorkedOn documents={documents.map((d) => ({ id: d.id, name: d.name || 'Untitled', sub: workedBy(d.by) }))}
        onOpen={(id) => {
          const d = documents.find((x) => x.id === id);
          if (d) void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: d.workspaceId, documentId: d.id } });
        }} />
    </Section>
  );
}
