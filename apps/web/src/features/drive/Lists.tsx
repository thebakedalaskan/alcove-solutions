/*
 * On a phone the tree becomes chips along the top, so what it lists under Workspaces and From calls is a place of its own:
 * every workspace with its mark, and every call's own workspace, the next ones first with their time. Each opens on the sheet.
 */
import type { WorkspaceSummary } from '@alcove/api';
import { EmptyState, Icon } from '@alcove/ui';
import { useState } from 'react';
import { namesIn, peopleWords } from '~/features/workspace/List';
import { noteAt } from '~/lib/time';
import { NameField } from './Card';
import type { DriveActions } from './actions';
import { SheetHead } from './Sheet';
import { callOrder, callTitle, isAhead, isSpace, marksFor } from './places';

export function SpacesList({ spaces, actions }: { spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const [naming, setNaming] = useState(false);
  const mark = marksFor(spaces);
  const named = namesIn(spaces);
  const yours = spaces.filter(isSpace);
  return (
    <>
      <SheetHead title="Workspaces" />
      <div className="dv-rows" role="list">
        {yours.map((w) => (
          <div key={w.id} className="dv-row" role="listitem">
            <button type="button" className="dv-row-open" aria-label={`Open ${named(w)}`} onClick={() => actions.go({ ws: w.id })} />
            <span className="dv-mk is-row" aria-hidden="true">{mark(w)}</span>
            <span className="dv-row-t"><b className="ac-clamp-1">{named(w)}</b><small>{peopleWords(w.people)}</small></span>
            <Icon name="chevron" size={15} className="dv-row-go" />
          </div>
        ))}
        <div className="dv-row is-new" role="listitem">
          {naming ? (
            <><span className="dv-k"><Icon name="folders" size={17} /></span><NameField name="" label="Name this workspace" onDone={(name) => { setNaming(false); if (name) void actions.newWorkspace(name); }} /></>
          ) : (
            <><button type="button" className="dv-row-open" aria-label="New workspace" onClick={() => setNaming(true)} /><span className="dv-k"><Icon name="plus" size={17} /></span><span className="dv-row-t"><b>New workspace</b></span></>
          )}
        </div>
      </div>
    </>
  );
}

export function CallsList({ spaces, actions }: { spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const calls = callOrder(spaces);
  return (
    <>
      <SheetHead title="From calls" />
      {calls.length === 0 ? (
        <EmptyState className="dv-none" title="No calls’ workspaces yet">Each call keeps what it makes in a workspace of its own, here once it’s made something.</EmptyState>
      ) : (
        <div className="dv-rows" role="list">
          {calls.map((w) => (
            <div key={w.id} className="dv-row" role="listitem">
              <button type="button" className="dv-row-open" aria-label={`Open ${callTitle(w)}`} onClick={() => actions.go({ ws: w.id })} />
              <span className="dv-k"><Icon name={isAhead(w) ? 'cal' : 'video'} size={17} /></span>
              <span className="dv-row-t"><b className="ac-clamp-1">{callTitle(w)}</b><small>{w.call ? noteAt(w.call.at) : ''}</small></span>
              <Icon name="chevron" size={15} className="dv-row-go" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
