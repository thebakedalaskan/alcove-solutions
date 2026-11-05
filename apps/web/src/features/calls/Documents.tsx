/*
 * What to bring to a call, in the same modal: your workspace's documents, or your own, to pick from. They open in the
 * call and the notes can read them.
 */
import { MAX_CALL_DOCUMENTS, type CallDocument, type Document, type DocumentKind } from '@alcove/api';
import { Button, Dots, EmptyState, FlowBody, FlowFoot, FlowNote, Icon, Segmented, cn, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fold } from '~/lib/people';
import { q } from '~/lib/queries';
import { agoLabel } from '~/lib/time';

const KIND_ICON: Record<DocumentKind, IconName> = { doc: 'fileText', sheet: 'table', board: 'stickyNote' };
const KIND_WORD: Record<DocumentKind, string> = { doc: '', sheet: 'Sheet · ', board: 'Board · ' };
/** "Launch plan, Launch checklist" */
export const docNames = (docs: readonly { name: string | null; by: string }[]) => docs.map((d) => d.name ?? `${d.by}’s document`).join(', ');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A workspace, in the words under the heading. */
const fromLine = (name: string) => (name === 'Your documents' ? 'From your documents' : `From the ${name} workspace`);

/** Everyone sees these: whoever can't open one sees whose it is, and not its name. */
export function BroughtRow({ d }: { d: CallDocument }) {
  return (
    <div className="cf-doc is-read">
      <span className="cf-tile"><Icon name={KIND_ICON[d.kind]} size={17} /></span>
      <span className="min-w-0"><b className="ac-clamp-1">{d.name ?? `${d.by}’s document`}</b><small>{d.name ? `${d.by}’s` : `You can’t open this one. Ask ${d.by} for it.`}</small></span>
      <span />
    </div>
  );
}

export function Documents({ picked, back, foot }: {
  /** IDs already brought. */
  picked: readonly string[];
  back: boolean;
  /** The foot, with what's picked: everything in the library that's ticked. */
  foot: (docs: Document[], ids: string[]) => ReactNode;
}) {
  const library = useQuery(q.documents());
  const [ids, setIds] = useState<string[]>([...picked]);
  const [term, setTerm] = useState('');
  const [place, setPlace] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (matchMedia('(hover: hover)').matches) search.current?.focus({ preventScroll: true }); }, []);

  const spaces = library.data?.workspaces;
  const space = spaces?.find((w) => w.id === place) ?? spaces?.[0];
  const all = useMemo(() => (spaces ?? []).flatMap((w) => w.documents), [spaces]);
  const shown = (space?.documents ?? []).filter((d) => !term.trim() || fold(d.name).includes(fold(term.trim())));
  const full = ids.length >= MAX_CALL_DOCUMENTS;
  const toggle = (id: string) => setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : full ? list : [...list, id]));
  const docs = all.filter((d) => ids.includes(d.id));

  return (
    <>
      <FlowBody back={back}>
        <h2>Bring documents</h2>
        {library.isPending ? <p className="cf-sub"><Dots /></p> : library.isError ? (
          <EmptyState title="Documents can’t be read just now">The call works without them. Try again in a moment.</EmptyState>
        ) : !all.length ? (
          <EmptyState title="No documents to bring yet">Documents from your workspace show here, ready to bring to a call.</EmptyState>
        ) : (
          <>
            {spaces && spaces.length > 1
              ? <div className="cf-bar"><Segmented value={space?.id ?? ''} onChange={setPlace} label="Workspace" options={spaces.map((w) => ({ value: w.id, label: w.name }))} /></div>
              : <p className="cf-sub">{space ? fromLine(space.name) : ''}</p>}
            <div className="cf-field"><Icon name="search" size={18} /><input ref={search} type="text" value={term} aria-label="Search documents" placeholder="Search docs and boards" onChange={(e) => setTerm(e.target.value)} /></div>
            {full && <FlowNote tone="info" icon="fileText">A call can bring {MAX_CALL_DOCUMENTS} documents at most.</FlowNote>}
            <div className="cf-docs" role="group" aria-label="Documents">
              {shown.map((d) => {
                const on = ids.includes(d.id);
                return (
                  <button key={d.id} type="button" className={cn('cf-doc', on && 'on')} aria-pressed={on} disabled={full && !on} onClick={() => toggle(d.id)}>
                    <span className="tick">{on && <Icon name="check" size={14} />}</span>
                    <span className="cf-tile"><Icon name={KIND_ICON[d.kind]} size={17} /></span>
                    <span className="min-w-0"><b className="ac-clamp-1">{d.name}</b><small>{KIND_WORD[d.kind]}{d.by}’s</small></span>
                    <span className="when">{capital(agoLabel(d.updatedAt))}</span>
                  </button>
                );
              })}
            </div>
            {!shown.length && <p className="cf-sub">Nothing here matches “{term.trim()}”.</p>}
          </>
        )}
      </FlowBody>
      {all.length > 0 && foot(docs, ids)}
    </>
  );
}

/** The foot of a view that brings documents. */
export const BringFoot = ({ count, onBring, busy = false }: { count: number; onBring: () => void; busy?: boolean | undefined }) => (
  <FlowFoot summary="The notes can read them too. Anyone who can’t open one is told, without seeing its name.">
    <Button variant="primary" loading={busy} onClick={onBring}>{count ? `Bring ${count}` : 'Bring documents'}</Button>
  </FlowFoot>
);
