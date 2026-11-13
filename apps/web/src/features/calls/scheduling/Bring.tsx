/*
 * Add an agenda, in the scheduler's Details: what the call brings, picked in a popover from your workspaces' documents and
 * boards, with a search, and listed under it, each with ×, up to 12. They open in the call and the notes can read them;
 * anyone who can't open one is told whose it is.
 */
import { MAX_CALL_DOCUMENTS, type Document } from '@alcove/api';
import { Dots, Icon, Popover, SchedDoc, SchedQuiet, SchedRow, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fold } from '~/lib/people';
import { q } from '~/lib/queries';
import { called, placesIn } from '../flow/Documents';

export function Bring({ picked, open, onOpenChange, onChange }: {
  picked: readonly Document[];
  /** Whether the library is open: the scheduler's, as everything it opens. */
  open: boolean; onOpenChange: (open: boolean) => void;
  onChange: (docs: Document[]) => void;
}) {
  const [term, setTerm] = useState('');
  const library = useQuery({ ...q.documents(), enabled: open });
  const places = useMemo(() => placesIn(library.data?.workspaces ?? []), [library.data]);
  const looking = fold(term.trim());
  const full = picked.length >= MAX_CALL_DOCUMENTS;
  const has = (d: Document) => picked.some((x) => x.id === d.id);
  const toggle = (d: Document) => onChange(has(d) ? picked.filter((x) => x.id !== d.id) : full ? [...picked] : [...picked, d]);
  const shown = places.map((p) => ({ ...p, documents: p.documents.filter((d) => !looking || fold(called(d)).includes(looking)) })).filter((p) => p.documents.length);
  return (
    <>
      <SchedRow icon="fileText">
        <Popover open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setTerm(''); }} label="Add an agenda" align="start" className="sc-pop is-lib"
          anchor={<SchedQuiet>Add an agenda</SchedQuiet>}>
          <div className="sc-lib-q"><Icon name="search" size={16} /><input type="text" value={term} aria-label="Search documents" placeholder="Search docs and boards" onChange={(e) => setTerm(e.target.value)} /></div>
          <div className="sc-lib-l" role="group" aria-label="Documents">
            {library.isPending ? <p className="sc-lib-n"><Dots /></p>
              : library.isError ? <p className="sc-lib-n">Documents can’t be read just now. The call works without them.</p>
                : !places.length ? <p className="sc-lib-n">Documents and boards from your workspaces show here, ready to bring.</p>
                  : !shown.length ? <p className="sc-lib-n">Nothing matches “{term.trim()}”.</p>
                    : shown.map((p) => (
                      <div key={p.id}>
                        <p className="sc-lib-h ac-clamp-1">{p.label}</p>
                        {p.documents.map((d) => {
                          const on = has(d);
                          return (
                            <button key={d.id} type="button" className={cn('sc-lib-r', on && 'is-on')} aria-pressed={on} disabled={full && !on} onClick={() => toggle(d)}>
                              <span className="tick" aria-hidden="true">{on && <Icon name="check" size={13} />}</span>
                              <Icon name={d.kind === 'board' ? 'stickyNote' : 'fileText'} size={16} />
                              <span className="ac-clamp-1">{called(d)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
          </div>
          {full && <p className="sc-lib-n">A call can bring {MAX_CALL_DOCUMENTS} documents at most.</p>}
        </Popover>
      </SchedRow>
      {picked.length > 0 && (
        <SchedRow flush>
          <span className="sc-docs" role="list" aria-label="What the call brings">
            {picked.map((d) => (
              <span key={d.id} role="listitem">
                <SchedDoc icon={d.kind === 'board' ? 'stickyNote' : 'fileText'} name={called(d)} removeLabel={`Take ${called(d)} off`} onRemove={() => onChange(picked.filter((x) => x.id !== d.id))} />
              </span>
            ))}
          </span>
        </SchedRow>
      )}
    </>
  );
}
