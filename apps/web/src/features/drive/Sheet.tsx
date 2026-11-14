/*
 * What every place on the Drive's sheet is made of: its head (a title in Newsreader, with a workspace's mark, a line under it,
 * and its few actions at the right), sections that start with a label on a hairline, the switch between pictures and a list,
 * and the cards' previews, asked for a workspace at a time.
 */
import type { DocumentPreview, WorkspaceSummary } from '@alcove/api';
import { IconButton, cn } from '@alcove/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { workspaceQueries } from '~/features/workspace/queries';
import { canEdit, type DriveActions } from './actions';
import { DriveCard, FileRow, Files, type CardActions } from './Card';
import { byLine, callTitle, whereOf, type DriveFile } from './places';
import { FileShare } from './Share';

/* ---------- the head and its sections ---------- */

export function SheetHead({ title, mark, meta, actions }: { title: ReactNode; mark?: string | undefined; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="dv-mh">
      <div>
        <h2>{mark && <span className="dv-mk is-big" aria-hidden="true">{mark}</span>}<span className="ac-clamp-2">{title}</span></h2>
        {meta && <div className="dv-mh-meta">{meta}</div>}
      </div>
      {actions && <div className="dv-mh-acts">{actions}</div>}
    </header>
  );
}

export function Section({ label, children, className }: { label?: string | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn('dv-sec', className)} aria-label={label}>
      {label && <h3 className="dv-gh">{label}</h3>}
      {children}
    </section>
  );
}

/* ---------- pictures or a list ---------- */

const VIEW_KEY = 'alcove.drive.view';
const dlog = log.child({ component: 'drive' });
/** Whether the sheet shows files as pictures or as a list, remembered in this browser: a convenience, nothing more. */
export function useListView(): [boolean, (list: boolean) => void] {
  const [list, setList] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list'; } catch { return false; }
  });
  const set = useCallback((to: boolean) => {
    setList(to);
    try { localStorage.setItem(VIEW_KEY, to ? 'list' : 'grid'); } catch (e) { dlog.debug('this browser’s storage is unavailable', { err: e }); }
  }, []);
  return [list, set];
}
export function ViewSwitch({ list, onList }: { list: boolean; onList: (list: boolean) => void }) {
  return (
    <span className="dv-view" role="group" aria-label="Show files">
      <IconButton icon="grid" size={15} label="As pictures" aria-pressed={!list} className={cn(!list && 'is-on')} onClick={() => onList(false)} />
      <IconButton icon="list" size={15} label="As a list" aria-pressed={list} className={cn(list && 'is-on')} onClick={() => onList(true)} />
    </span>
  );
}

/* ---------- previews ---------- */

/** What the documents among these say at the top, by ID: asked of each workspace once, for the ones on screen. */
export function usePreviews(files: readonly DriveFile[]): Map<string, DocumentPreview> {
  const asks = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const f of files) if (f.kind === 'doc') by.set(f.workspaceId, [...(by.get(f.workspaceId) ?? []), f.id]);
    return [...by].map(([workspaceId, ids]) => workspaceQueries.previews(workspaceId, [...ids].sort()));
  }, [files]);
  const found = useQueries({ queries: asks });
  return useMemo(() => new Map(found.flatMap((r) => r.data ?? []).map((p) => [p.id, p])), [found]);
}

/* ---------- cards ---------- */

/**
 * What a card's ⋯ offers for a file: Rename and Trash only where its workspace lets you change things, and Share only for
 * someone in its workspace who can edit there, as only they can say who has something of it.
 */
export function cardActions(f: DriveFile, w: WorkspaceSummary | undefined, a: DriveActions): CardActions {
  const changes = w === undefined || w.role === null || canEdit(w.role);
  return {
    onOpen: () => a.open(f),
    onFullScreen: () => a.openFull(f.workspaceId, f.id),
    onCopyLink: () => a.copyLink(f),
    share: w !== undefined && canEdit(w.role) ? (back) => <FileShare file={f} space={w.call ? callTitle(w) : w.name ?? 'Its workspace'} onBack={back} /> : undefined,
    onRename: changes ? (name) => a.rename(f, name) : undefined,
    onTrash: changes ? () => a.trash(f) : undefined
  };
}

/**
 * Files as cards, or a list. `inside`: the place they're all in, so a card doesn't say so again. `tail`: what ends the grid.
 */
export function FileList({ files, spaces, actions, list, inside = false, tail }: {
  files: readonly DriveFile[]; spaces: readonly WorkspaceSummary[]; actions: DriveActions; list: boolean; inside?: boolean | undefined; tail?: ReactNode;
}) {
  const me = useQuery(accountQueries.session()).data?.user.name;
  const previews = usePreviews(files);
  const now = new Date();
  return (
    <Files list={list} tail={tail}>
      {files.map((f) => {
        const w = spaces.find((s) => s.id === f.workspaceId);
        const where = inside ? null : whereOf(f, spaces);
        const by = byLine(f, me, now);
        const acts = cardActions(f, w, actions);
        return list
          ? <FileRow key={`${f.workspaceId}/${f.id}`} file={f} where={where} by={by} actions={acts} />
          : <DriveCard key={`${f.workspaceId}/${f.id}`} file={f} preview={previews.get(f.id)} where={where} by={by} actions={acts} />;
      })}
    </Files>
  );
}
