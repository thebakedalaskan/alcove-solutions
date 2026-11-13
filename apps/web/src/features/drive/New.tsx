/*
 * Making something in the Drive. New, in the sky, offers a document, a board, files to upload, or a workspace. Where you are
 * says where it goes: a workspace, a folder in one, or a call's workspace. Anywhere else (Recent, Shared with you, Trash) the
 * menu steps on to ask which workspace, in the same menu, with New workspace last, named in place; files are picked first,
 * then where they go. A workspace's own sheet ends its files with the same three ways to make something, dashed.
 */
import type { WorkspaceSummary } from '@alcove/api';
import { Button, Icon, IconButton, WsMenu, WsPopover, cn, type IconName, type WsMenuRow } from '@alcove/ui';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { namesIn } from '~/features/workspace/tree/List';
import { canEdit, type DriveActions, type Making, type Target } from './actions';
import { callOrder, callTitle, isAhead, isSpace } from './places';

type Step = { at: 'menu' } | { at: 'where'; making: Making; files: File[] } | { at: 'name'; making: Making | null; files: File[] };

const WHAT: Record<Making, { icon: IconName; label: string }> = {
  document: { icon: 'filePlus', label: 'Document' },
  board: { icon: 'presentation', label: 'Board' },
  upload: { icon: 'cloudUpload', label: 'Upload files' }
};
/** How many calls' workspaces the question of where offers, the latest first, after the workspaces themselves. */
const CALLS_OFFERED = 3;

/** Files from this computer: a hidden input, pressed for someone who asked. */
function useFilePick(onFiles: (files: File[]) => void): { input: ReactElement; pick: () => void } {
  const at = useRef<HTMLInputElement>(null);
  const input = <input ref={at} type="file" multiple hidden tabIndex={-1} onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (files.length) onFiles(files); }} />;
  return { input, pick: () => at.current?.click() };
}

/** Naming a workspace in a menu's place: Enter makes it, Esc goes back. */
function NameStep({ making, busy, onName, onBack }: { making: Making | null; busy: boolean; onName: (name: string) => void; onBack: (() => void) | null }) {
  const [name, setName] = useState('');
  const what = making === null ? 'New workspace' : `A workspace for the new ${making === 'upload' ? 'files' : making}`;
  return (
    <form className="dv-pop-name" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onName(name.trim()); }}>
      <p className="dv-pop-head">{onBack && <IconButton icon="left" size={15} label="Back" type="button" onClick={onBack} />}{what}</p>
      <input type="text" aria-label="Name this workspace" placeholder="Name this workspace" value={name} maxLength={120} autoFocus autoComplete="off" spellCheck={false}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && onBack) { e.preventDefault(); e.stopPropagation(); onBack(); } }} />
      <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!name.trim()}>Make it</Button>
    </form>
  );
}

/** Where something new goes: each workspace you can make things in, then the latest calls' own, then a new one. */
function whereRows(spaces: readonly WorkspaceSummary[], onPick: (w: WorkspaceSummary) => void, onNew: () => void): WsMenuRow[] {
  const named = namesIn(spaces);
  const yours = spaces.filter((w) => isSpace(w) && canEdit(w.role));
  const calls = callOrder(spaces).filter((w) => canEdit(w.role)).slice(0, CALLS_OFFERED);
  const rows: WsMenuRow[] = [{ type: 'head', label: 'Make it in' }];
  for (const w of yours) rows.push({ id: `ws:${w.id}`, icon: 'folders', label: named(w), onSelect: () => onPick(w) });
  for (const w of calls) rows.push({ id: `ws:${w.id}`, icon: isAhead(w) ? 'cal' : 'video', label: callTitle(w), onSelect: () => onPick(w) });
  if (rows.length > 1) rows.push({ type: 'sep' });
  rows.push({ id: 'new', icon: 'plus', label: 'New workspace', onSelect: onNew });
  return rows;
}

/**
 * The steps of making something, in one menu. `target`: where it goes, when where you are says; otherwise the menu asks.
 * `menu`: whether it starts at the menu of what to make, or someone pressed one of the three already.
 */
function useSteps({ target, spaces, actions, open, close, menu }: {
  target: Target | null; spaces: readonly WorkspaceSummary[]; actions: DriveActions; open: () => void; close: () => void; menu: boolean;
}) {
  const [step, setStep] = useState<Step>({ at: 'menu' });
  const anywhere = spaces.some((w) => canEdit(w.role));
  const ask = (making: Making, files: File[]): Step => (anywhere ? { at: 'where', making, files } : { at: 'name', making, files });
  const upload = useFilePick((files) => {
    if (target) { close(); void actions.make('upload', target, files); return; }
    setStep(ask('upload', files));
    open();
  });
  /** What pressing one of the three does: make it where you are, or ask where; files are picked first. */
  const start = (making: Making): boolean => {
    if (making === 'upload') { upload.pick(); return false; }
    if (target) { close(); void actions.make(making, target); return false; }
    setStep(ask(making, []));
    return true;
  };
  const back = (from: Step): (() => void) | null => {
    if (from.at === 'name' && from.making && anywhere) return () => setStep({ at: 'where', making: from.making ?? 'document', files: from.files });
    return menu ? () => setStep({ at: 'menu' }) : null;
  };
  const rows: WsMenuRow[] = [
    ...(['document', 'board', 'upload'] as const).map((m): WsMenuRow => ({ id: m, icon: WHAT[m].icon, label: WHAT[m].label, onSelect: () => { start(m); } })),
    { type: 'sep' },
    { id: 'workspace', icon: 'folders', label: 'Workspace', onSelect: () => setStep({ at: 'name', making: null, files: [] }) }
  ];
  let body: ReactNode;
  if (step.at === 'menu') body = <WsMenu label="New" rows={rows} />;
  else if (step.at === 'where') {
    const { making, files } = step;
    body = <WsMenu label="Make it in" swapped rows={whereRows(spaces, (w) => { close(); void actions.make(making, { workspaceId: w.id, folder: null }, files); }, () => setStep({ at: 'name', making, files }))} />;
  } else {
    const { making, files } = step;
    body = <NameStep making={making} busy={actions.busy} onBack={back(step)} onName={(name) => { close(); void actions.newWorkspace(name, making ? { kind: making, files } : undefined); }} />;
  }
  return { setStep, body, upload, start };
}

/** New, in the sky: the page's one filled button. `compact` on a phone, beside the search, as a plus. */
export function NewButton({ target, spaces, actions, compact = false }: { target: Target | null; spaces: readonly WorkspaceSummary[]; actions: DriveActions; compact?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const steps = useSteps({ target, spaces, actions, menu: true, open: () => setOpen(true), close: () => setOpen(false) });
  return (
    <>
      <WsPopover open={open} onOpenChange={(to) => { setOpen(to); if (to) steps.setStep({ at: 'menu' }); }} label="New" align="end"
        anchor={compact
          ? <Button variant="primary" className="dv-new is-compact" aria-haspopup="menu"><Icon name="plus" size={17} />New</Button>
          : <Button variant="primary" className="dv-new" aria-haspopup="menu"><Icon name="plus" size={17} />New<Icon name="down" size={15} /></Button>}>
        {steps.body}
      </WsPopover>
      {steps.upload.input}
    </>
  );
}

/** The three ways to make something, dashed, at the end of a workspace's files: straight in, where you are. */
export function MakeTiles({ target, actions, className }: { target: Target; actions: DriveActions; className?: string | undefined }) {
  const upload = useFilePick((files) => { void actions.make('upload', target, files); });
  const tile = (making: Making, label: string) => (
    <button type="button" onClick={() => { if (making === 'upload') upload.pick(); else void actions.make(making, target); }}>
      <Icon name={WHAT[making].icon} size={17} />{label}
    </button>
  );
  return (
    <div className={cn('dv-make', className)}>
      {tile('document', 'New document')}{tile('board', 'New board')}{tile('upload', 'Upload files')}
      {upload.input}
    </div>
  );
}

/** The same three, where you are doesn't say where they'd go (the first day): each asks, in a menu by the button pressed. */
export function MakeAsking({ spaces, actions }: { spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  return <div className="dv-ways">{(['document', 'board', 'upload'] as const).map((m) => <AskingOne key={m} making={m} spaces={spaces} actions={actions} />)}</div>;
}
function AskingOne({ making, spaces, actions }: { making: Making; spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const [open, setOpen] = useState(false);
  const steps = useSteps({ target: null, spaces, actions, menu: false, open: () => setOpen(true), close: () => setOpen(false) });
  const label = making === 'upload' ? 'Upload files' : `New ${making}`;
  return (
    <>
      <WsPopover open={open} onOpenChange={setOpen} label={label}
        anchor={<Button variant={making === 'upload' ? 'quiet' : 'secondary'} onClick={(e) => { if (!steps.start(making)) e.preventDefault(); }}>
          <Icon name={WHAT[making].icon} size={17} />{label}
        </Button>}>
        {steps.body}
      </WsPopover>
      {steps.upload.input}
    </>
  );
}
