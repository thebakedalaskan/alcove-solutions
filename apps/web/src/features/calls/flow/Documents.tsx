/*
 * What to bring to a call, in the same modal: the documents and boards you can open, by workspace, to pick from. They open
 * in the call and the notes can read them.
 */
import { MAX_CALL_DOCUMENTS, type CallDocument, type Document, type DocumentKind, type DocumentLibrary } from '@alcove/api';
import { Button, Dots, EmptyState, FlowBody, FlowFoot, FlowNote, Icon, Segmented, Select, cn, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fold } from '~/lib/people';
import { q } from '~/lib/queries';
import { agoLabel } from '~/lib/time';

const KIND_ICON: Record<DocumentKind, IconName> = { doc: 'fileText', board: 'stickyNote' };
const KIND_WORD: Record<DocumentKind, string> = { doc: 'document', board: 'board' };
type Called = Pick<CallDocument, 'name' | 'by' | 'kind'>;
/** What something goes by here: its name, or the app's word until it has one. Whoever can't open it sees whose it is. */
export const called = (d: Called) => (d.name === null ? (d.by ? `${d.by}’s ${KIND_WORD[d.kind]}` : `A ${KIND_WORD[d.kind]}`) : d.name || 'Untitled');
/** "Launch plan, Launch checklist" */
export const docNames = (docs: readonly Called[]) => docs.map(called).join(', ');
/** The line under a name: that it's a board, and whose it is. */
const whoseLine = (d: Pick<CallDocument, 'by' | 'kind'>) => [d.kind === 'board' ? 'Board' : '', d.by ? `${d.by}’s` : ''].filter(Boolean).join(' · ');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Somewhere documents come from, as the picker offers it. */
export interface Place { id: string; label: string; line: string; documents: Document[] }
/** Someone outside a workspace isn't told its name, so what's been shared with them sits together, whichever it came from. */
export function placesIn(workspaces: DocumentLibrary['workspaces']): Place[] {
  const named = workspaces.flatMap((w): Place[] => (w.name === null ? [] : [{ id: w.id, label: w.name, line: `From the ${w.name} workspace`, documents: w.documents }]));
  const shared = workspaces.flatMap((w) => (w.name === null ? w.documents : [])).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return shared.length ? [...named, { id: 'shared', label: 'Shared with you', line: 'Shared with you', documents: shared }] : named;
}
/** How many places fit side by side; past that it's a list. */
const SIDE_BY_SIDE = 4;

/** Everyone sees these: whoever can't open one sees whose it is, and not its name. */
export function BroughtRow({ d }: { d: CallDocument }) {
  return (
    <div className="cf-doc is-read">
      <span className="cf-tile"><Icon name={KIND_ICON[d.kind]} size={17} /></span>
      <span className="min-w-0"><b className="ac-clamp-1">{called(d)}</b><small>{d.name !== null ? whoseLine(d) : `You can’t open this one.${d.by ? ` Ask ${d.by} for it.` : ''}`}</small></span>
      <span />
    </div>
  );
}

/** One thing to tick. */
function PickRow({ kind, name, sub, when, on, disabled, onToggle }: { kind: DocumentKind; name: string; sub: string; when?: string | undefined; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={cn('cf-doc', on && 'on')} aria-pressed={on} disabled={disabled} onClick={onToggle}>
      <span className="tick">{on && <Icon name="check" size={14} />}</span>
      <span className="cf-tile"><Icon name={KIND_ICON[kind]} size={17} /></span>
      <span className="min-w-0"><b className="ac-clamp-1">{name}</b><small>{sub}</small></span>
      <span className="when">{when}</span>
    </button>
  );
}

export function Documents({ picked, brought = [], back, foot }: {
  /** IDs already brought. */
  picked: readonly string[];
  /** What's on the call as it stands: anything there you can't bring any more shows here, to take off. */
  brought?: readonly CallDocument[] | undefined;
  back: boolean;
  /** The foot, with what's picked: everything in the library that's ticked. */
  foot: (docs: Document[], ids: string[]) => ReactNode;
}) {
  const library = useQuery(q.documents());
  const [ids, setIds] = useState<string[]>([...picked]);
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (matchMedia('(hover: hover)').matches) search.current?.focus({ preventScroll: true }); }, []);

  const places = useMemo(() => placesIn(library.data?.workspaces ?? []), [library.data]);
  const place = places.find((p) => p.id === chosen) ?? places[0];
  const all = useMemo(() => places.flatMap((p) => p.documents), [places]);
  const looking = fold(term.trim());
  const matches = (d: Called) => !looking || fold(called(d)).includes(looking);
  const shown = (place?.documents ?? []).filter(matches);
  const lost = brought.filter((d) => !all.some((x) => x.id === d.id));
  const full = ids.length >= MAX_CALL_DOCUMENTS;
  const toggle = (id: string) => setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : full ? list : [...list, id]));
  const docs = all.filter((d) => ids.includes(d.id));
  /* Until the library is read everything on the call looks lost, so nothing here counts until it is. */
  const anything = library.isSuccess && (all.length > 0 || lost.length > 0);
  const options = places.map((p) => ({ value: p.id, label: p.label }));

  return (
    <>
      <FlowBody back={back}>
        <h2>Bring documents</h2>
        {library.isPending ? <p className="cf-sub"><Dots /></p> : library.isError ? (
          <EmptyState title="Documents can’t be read just now">The call works without them. Try again in a moment.</EmptyState>
        ) : !anything ? (
          <EmptyState title="No documents to bring yet">Documents from your workspace show here, ready to bring to a call.</EmptyState>
        ) : (
          <>
            {places.length > SIDE_BY_SIDE
              ? <div className="cf-bar"><Select value={place?.id} onChange={setChosen} label="Workspace" options={options} /></div>
              : places.length > 1
                ? <div className="cf-bar"><Segmented value={place?.id ?? ''} onChange={setChosen} label="Workspace" className="cf-places" options={options.map((o) => ({ ...o, label: <span className="ac-clamp-1">{o.label}</span> }))} /></div>
                : place && <p className="cf-sub ac-clamp-2">{place.line}</p>}
            {all.length > 0 && <div className="cf-field"><Icon name="search" size={18} /><input ref={search} type="text" value={term} aria-label="Search documents" placeholder="Search docs and boards" onChange={(e) => setTerm(e.target.value)} /></div>}
            {full && <FlowNote tone="info" icon="fileText">A call can bring {MAX_CALL_DOCUMENTS} documents at most.</FlowNote>}
            <div className="cf-docs" role="group" aria-label="Documents">
              {lost.filter(matches).map((d) => {
                const on = ids.includes(d.id);
                return <PickRow key={d.id} kind={d.kind} name={called(d)} sub={d.name === null ? 'You can’t open this one any more' : whoseLine(d)} on={on} disabled={full && !on} onToggle={() => toggle(d.id)} />;
              })}
              {shown.map((d) => {
                const on = ids.includes(d.id);
                return <PickRow key={d.id} kind={d.kind} name={called(d)} sub={whoseLine(d)} when={capital(agoLabel(d.updatedAt))} on={on} disabled={full && !on} onToggle={() => toggle(d.id)} />;
              })}
            </div>
            {looking && !shown.length && <p className="cf-sub">Nothing here matches “{term.trim()}”.</p>}
          </>
        )}
      </FlowBody>
      {anything && foot(docs, ids)}
    </>
  );
}

/** The foot of a view that brings documents. */
export const BringFoot = ({ count, onBring, busy = false }: { count: number; onBring: () => void; busy?: boolean | undefined }) => (
  <FlowFoot summary="The notes can read them too. Anyone who can’t open one is told, without seeing its name.">
    <Button variant="primary" loading={busy} onClick={onBring}>{count ? `Bring ${count}` : 'Bring documents'}</Button>
  </FlowFoot>
);
