/*
 * Recent, Shared with you and what a search finds: files from every workspace, as large previews. Recent is everything you
 * can open, the most recently edited first, by day; Shared with you is what's in workspaces you're not in; a search narrows
 * them all by name, with the workspaces and calls it names first.
 */
import type { WorkspaceSummary } from '@alcove/api';
import { Button, EmptyState, Icon } from '@alcove/ui';
import { useState } from 'react';
import { fold } from '~/lib/people';
import { plural } from '~/lib/words';
import type { DriveActions } from './actions';
import { MakeAsking } from './New';
import { FileList, Section, SheetHead, ViewSwitch, useListView } from './Sheet';
import { callTitle, dayGroup, grouped, isAhead, isCallSpace, isSharedOnly, isSpace, type DriveFile } from './places';

/** How many files Recent shows before Show more, and how many more each press shows. */
const PAGE = 24;

export function Recent({ files, spaces, actions }: { files: readonly DriveFile[]; spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const [list, setList] = useListView();
  const [shown, setShown] = useState(PAGE);
  if (files.length === 0) {
    return (
      <>
        <SheetHead title="Recent" />
        <EmptyState className="dv-none" title="Nothing here yet" action={<MakeAsking spaces={spaces} actions={actions} />}>
          Documents, boards and files from your calls land here, with anything you make yourself.
        </EmptyState>
      </>
    );
  }
  const now = new Date();
  const groups = grouped(files.slice(0, shown), (f) => dayGroup(f.editedAt, now));
  return (
    <>
      <SheetHead title="Recent" actions={<ViewSwitch list={list} onList={setList} />} />
      {groups.map((g) => (
        <Section key={g.label} label={g.label}>
          <FileList files={g.items} spaces={spaces} actions={actions} list={list} />
        </Section>
      ))}
      {files.length > shown && (
        <div className="dv-show">
          <Button variant="quiet" size="sm" iconRight="down" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, files.length - shown)} more</Button>
        </div>
      )}
    </>
  );
}

export function SharedWithYou({ files, spaces, actions }: { files: readonly DriveFile[]; spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const [list, setList] = useListView();
  return (
    <>
      <SheetHead title="Shared with you" meta={<p>Files people shared with you, from calls you weren’t on and workspaces you’re not in</p>}
        actions={files.length > 0 && <ViewSwitch list={list} onList={setList} />} />
      {files.length === 0
        ? <EmptyState className="dv-none" title="Nothing shared with you yet">When someone shares a document or a board with you, it’s here.</EmptyState>
        : <Section className="is-bare"><FileList files={files} spaces={spaces} actions={actions} list={list} inside /></Section>}
    </>
  );
}

/** Whether a name has every word typed in it, however it's accented or cased. */
const named = (name: string, words: readonly string[]) => { const n = fold(name); return words.every((w) => n.includes(w)); };

export function Found({ text, files, spaces, actions, onClear }: { text: string; files: readonly DriveFile[]; spaces: readonly WorkspaceSummary[]; actions: DriveActions; onClear: () => void }) {
  const [list, setList] = useListView();
  const words = fold(text).split(/\s+/).filter(Boolean);
  const places = spaces.filter((w) => (isSpace(w) || isCallSpace(w)) && named(isCallSpace(w) ? callTitle(w) : w.name ?? '', words));
  const found = files.filter((f) => named(f.name, words));
  const nothing = found.length === 0 && places.length === 0;
  const head = <SheetHead title={`“${text.trim()}”`} meta={!nothing && <p>{plural(found.length, 'file')}{places.length > 0 ? `, ${plural(places.length, 'workspace')}` : ''}</p>}
    actions={found.length > 0 && <ViewSwitch list={list} onList={setList} />} />;
  if (nothing) {
    return (
      <>
        {head}
        <EmptyState className="dv-none" title="Nothing matches" action={<Button variant="secondary" onClick={onClear}>Clear search</Button>}>
          No document, board, file or workspace you can open is called that.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {head}
      {places.length > 0 && (
        <Section label="Workspaces">
          <div className="dv-rows" role="list">
            {places.map((w) => (
              <div key={w.id} className="dv-row" role="listitem">
                <button type="button" className="dv-row-open" aria-label={`Open ${isCallSpace(w) ? callTitle(w) : w.name ?? ''}`} onClick={() => actions.go({ ws: w.id })} />
                <span className="dv-k"><Icon name={isCallSpace(w) ? (isAhead(w) ? 'cal' : 'video') : 'folders'} size={17} /></span>
                <span className="dv-row-t"><b className="ac-clamp-1">{isCallSpace(w) ? callTitle(w) : w.name}</b>{isCallSpace(w) && <small>This call’s own workspace</small>}</span>
                <span className="dv-row-by" />
              </div>
            ))}
          </div>
        </Section>
      )}
      {found.length > 0 && <Section label="Files"><FileList files={found} spaces={spaces} actions={actions} list={list} /></Section>}
    </>
  );
}

/** The files Shared with you holds: those in workspaces you only have documents in. */
export const sharedIn = (files: readonly DriveFile[], spaces: readonly WorkspaceSummary[]): DriveFile[] =>
  files.filter((f) => { const w = spaces.find((s) => s.id === f.workspaceId); return w !== undefined && isSharedOnly(w); });
