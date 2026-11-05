/*
 * Someone's card, from their face in the list, on a document or from their name in a line: where they are, as far as you can
 * know it, and what you can do about it. A document you can't open is never named: the stream doesn't say which it is.
 */
import type { Person } from '@alcove/api';
import { WsPersonCard } from '@alcove/ui';
import { useWs } from './context';
import { nameOf } from './tree';

export function PersonCard({ person, onDone }: { person: Person; onDone: () => void }) {
  const ws = useWs();
  const someone = ws.others.find((o) => o.person.id === person.id);
  const item = someone?.document ? ws.tree.all.get(someone.document) : undefined;
  const where = item ? nameOf(item) : someone?.elsewhere ? 'A document you can’t open' : 'Not in the workspace';
  const page = ws.page.current;
  return (
    <WsPersonCard person={person} where={where} followed={ws.following?.person.id === person.id}
      onFollow={() => { onDone(); ws.follow(person.id); }}
      onStop={() => { onDone(); ws.stopFollowing(); }}
      onGo={item ? () => { onDone(); ws.go({ kind: 'document', id: item.id, block: someone?.block ?? undefined }); } : undefined}
      onTag={page?.canTag ? () => { onDone(); page.tag(person); } : undefined} />
  );
}
