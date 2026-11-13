/*
 * The Drive (docs: Product › The Drive): every workspace you're in and everything in them, from your calls and made on
 * purpose. A slim band of evening holds the page's title, the search, which finds what's called what as you type, and New,
 * its one filled button. Under it, the tree of places beside a sheet of large previews of whichever is picked: Recent, by
 * day; Shared with you; a workspace, with its folders, calls and files; a call's own workspace, with the call and what it
 * made; Trash, across every workspace. A document opens beside the tree, in the workspace it lives in, and ⤢ takes it full
 * screen. On a phone the tree becomes chips along the top, New sits beside the search, and a document opens full screen.
 */
import type { WorkspaceSummary } from '@alcove/api';
import { Button, Dots, EmptyState, Evening, Icon, IconButton, Kbd, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ariaShortcut, overlayOpen, shortcut, withMod } from '~/lib/keys';
import { DocumentBeside } from '~/features/workspace/Beside';
import { workspaceQueries } from '~/features/workspace/queries';
import { useMedia } from '~/lib/live';
import { PHONE, canEdit, useDriveActions, type DriveActions } from './actions';
import { CallSheet } from './CallSpace';
import { CallsList, SpacesList } from './Lists';
import { NewButton } from './New';
import { Found, Recent, SharedWithYou, sharedIn } from './Recent';
import { SheetHead } from './Sheet';
import { SpaceSheet } from './Space';
import { TrashSheet } from './Trash';
import { Tree } from './Tree';
import { callTitle, filesIn, isCallSpace, marksFor, type DriveAt, type DriveFile } from './places';

/**
 * The search in the sky. ⌘K comes here on this page, in place of the palette; Esc clears it. On a phone it shares the sky
 * with New, so what it says there is short enough to read whole.
 */
function Search({ text, onText }: { text: string; onText: (text: string) => void }) {
  const field = useRef<HTMLInputElement>(null);
  const phone = useMedia(PHONE);
  /* In the capture phase, so the shell doesn't open the palette as well. With something open over the page, it's the shell's. */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!withMod(e) || e.key.toLowerCase() !== 'k' || overlayOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      field.current?.focus();
      field.current?.select();
    };
    addEventListener('keydown', on, { capture: true });
    return () => removeEventListener('keydown', on, { capture: true });
  }, []);
  return (
    <div className="dv-q">
      <Icon name="search" size={18} />
      <input ref={field} type="search" value={text} placeholder={phone ? 'Search the Drive' : 'Find a document, a board or a file'} aria-label="Find a document, a board or a file" aria-keyshortcuts={ariaShortcut('K')}
        autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={200} onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.preventDefault(); onText(''); } }} />
      {text ? <IconButton icon="x" size={15} label="Clear search" className="dv-q-x" onClick={() => { onText(''); field.current?.focus(); }} /> : <Kbd className="dv-q-k">{shortcut('K')}</Kbd>}
    </div>
  );
}

type Chip = 'recent' | 'shared' | 'workspaces' | 'calls' | 'trash';
const CHIPS: { chip: Chip; label: string; to: DriveAt }[] = [
  { chip: 'recent', label: 'Recent', to: {} }, { chip: 'shared', label: 'Shared with you', to: { show: 'shared' } },
  { chip: 'workspaces', label: 'Workspaces', to: { show: 'workspaces' } }, { chip: 'calls', label: 'From calls', to: { show: 'calls' } },
  { chip: 'trash', label: 'Trash', to: { show: 'trash' } }
];
/**
 * On a phone, the places along the top: the one you're in, or the one the workspace you're in is under, is lit. From calls
 * is there once there's a call's workspace to list.
 */
function Chips({ at, current, calls, actions }: { at: DriveAt; current: WorkspaceSummary | undefined; calls: boolean; actions: DriveActions }) {
  const lit: Chip | null = at.q ? null : current ? (isCallSpace(current) ? 'calls' : 'workspaces') : at.show === undefined ? 'recent' : at.show;
  return (
    <nav className="dv-chips" aria-label="Places in the Drive">
      {CHIPS.filter((c) => calls || c.chip !== 'calls').map((c) => <button key={c.chip} type="button" className={cn(lit === c.chip && 'is-on')} aria-current={lit === c.chip ? 'page' : undefined} onClick={() => actions.go(c.to)}>{c.label}</button>)}
    </nav>
  );
}

/** What the sheet shows for where you are. */
function Place({ at, spaces, files, loading, failed, actions, onClear, onRetry }: {
  at: DriveAt; spaces: readonly WorkspaceSummary[]; files: readonly DriveFile[]; loading: boolean; failed: boolean; actions: DriveActions; onClear: () => void; onRetry: () => void;
}) {
  if (at.q) return <Found text={at.q} files={files} spaces={spaces} actions={actions} onClear={onClear} />;
  if (at.show === 'trash') return <TrashSheet spaces={spaces} actions={actions} />;
  if (at.show === 'workspaces') return <SpacesList spaces={spaces} actions={actions} />;
  if (at.show === 'calls') return <CallsList spaces={spaces} actions={actions} />;
  if (at.ws && at.doc) {
    const { ws, doc } = at;
    return <DocumentBeside key={`${ws}/${doc}`} workspaceId={ws} documentId={doc} onFullScreen={() => actions.openFull(ws, doc)} onOpen={(id) => actions.go({ ws, doc: id })} onClose={() => actions.go({ ws }, { replace: true })} />;
  }
  if (at.ws) {
    const w = spaces.find((s) => s.id === at.ws);
    if (w && isCallSpace(w)) return <CallSheet key={w.id} w={w} actions={actions} />;
    if (w) return <SpaceSheet key={w.id} w={w} mark={marksFor(spaces)(w)} at={at} actions={actions} />;
    return (
      <EmptyState className="dv-none" title="You can’t open this workspace" action={<Button variant="secondary" onClick={() => actions.go({})}>Back to Recent</Button>}>
        It may have been deleted, or you were taken out of it.
      </EmptyState>
    );
  }
  if (failed) {
    const title = at.show === 'shared' ? 'Shared with you' : 'Recent';
    return <><SheetHead title={title} /><EmptyState className="dv-none" title="Your files didn’t load" action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>Alcove couldn’t be reached. Check your connection.</EmptyState></>;
  }
  if (loading) return <><SheetHead title={at.show === 'shared' ? 'Shared with you' : 'Recent'} /><p className="dv-loading"><Dots /></p></>;
  if (at.show === 'shared') return <SharedWithYou files={sharedIn(files, spaces)} spaces={spaces} actions={actions} />;
  return <Recent files={files} spaces={spaces} actions={actions} />;
}

export function Drive({ at }: { at: DriveAt }) {
  const spaces = useQuery(workspaceQueries.workspaces()).data ?? [];
  const library = useQuery(workspaceQueries.documents());
  const actions = useDriveActions();
  const files = useMemo(() => filesIn(library.data), [library.data]);
  const shared = useMemo(() => sharedIn(files, spaces).length, [files, spaces]);
  const current = at.ws ? spaces.find((w) => w.id === at.ws) : undefined;
  const target = current && canEdit(current.role) ? { workspaceId: current.id, folder: at.folder ?? null } : null;
  /*
   * What's typed shows at once, and goes in the address as it's typed, so Back and Forward go through what was searched.
   * Only a change that didn't come from typing here (Back, a link) puts words in the field.
   */
  const [text, setText] = useState(at.q ?? '');
  const typed = useRef(at.q ?? '');
  useEffect(() => {
    if ((at.q ?? '') === typed.current) return;
    typed.current = at.q ?? '';
    setText(at.q ?? '');
  }, [at.q]);
  const search = (to: string) => {
    setText(to);
    typed.current = to.trim() ? to : '';
    actions.go(to.trim() ? { ...at, q: to } : { ...at, q: undefined }, { replace: true });
  };
  const label = at.q ? 'What was found' : at.show === 'shared' ? 'Shared with you' : at.show === 'trash' ? 'Trash' : at.show === 'workspaces' ? 'Workspaces'
    : at.show === 'calls' ? 'From calls' : current ? (isCallSpace(current) ? callTitle(current) : current.name ?? 'A workspace') : 'Recent';
  return (
    <Evening moment="drive" className="dv">
      <header className="dv-sky" style={{ '--d': 0 }}>
        <h1 className="dusk-title">Drive</h1>
        <Search text={text} onText={search} />
        <div className="dv-sky-end"><NewButton target={target} spaces={spaces} actions={actions} /></div>
        <div className="dv-sky-phone"><NewButton target={target} spaces={spaces} actions={actions} compact /></div>
      </header>
      <div className="dv-split" style={{ '--d': 1 }}>
        <Tree at={at} spaces={spaces} shared={shared} actions={actions} />
        <section className={cn('dv-sheet', at.ws && at.doc && 'is-doc')} aria-label={label}>
          <Chips at={at} current={current} calls={spaces.some(isCallSpace)} actions={actions} />
          <Place at={at} spaces={spaces} files={files} loading={library.isPending} failed={library.isError} actions={actions}
            onClear={() => search('')} onRetry={() => void library.refetch()} />
        </section>
      </div>
    </Evening>
  );
}
