/*
 * Bring, in the scheduler: what the call brings, as chips, and a popover to pick documents and boards from your workspaces,
 * with a search. They open in the call and the notes can read them; anyone who can't open one is told whose it is.
 */
import { MAX_CALL_DOCUMENTS, type Document } from '@alcove/api';
import { Dots, Icon, Popover, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fold } from '~/lib/people';
import { q } from '~/lib/queries';
import { called, placesIn } from '../flow/Documents';

export function Bring({ picked, onChange }: { picked: readonly Document[]; onChange: (docs: Document[]) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const library = useQuery({ ...q.documents(), enabled: open });
  const places = useMemo(() => placesIn(library.data?.workspaces ?? []), [library.data]);
  const looking = fold(term.trim());
  const full = picked.length >= MAX_CALL_DOCUMENTS;
  const has = (d: Document) => picked.some((x) => x.id === d.id);
  const toggle = (d: Document) => onChange(has(d) ? picked.filter((x) => x.id !== d.id) : full ? [...picked] : [...picked, d]);
  const shown = places.map((p) => ({ ...p, documents: p.documents.filter((d) => !looking || fold(called(d)).includes(looking)) })).filter((p) => p.documents.length);
  return (
    <div className="sc-row is-bring">
      <Icon name="fileText" size={17} />
      <span className="min-w-0">
        <b>Bring</b>
        <span className="sc-docs">
          {picked.map((d) => (
            <span key={d.id} className="sc-doc">
              <Icon name={d.kind === 'board' ? 'stickyNote' : 'fileText'} size={14} />
              <span className="ac-clamp-1">{called(d)}</span>
              <button type="button" aria-label={`Take ${called(d)} off`} onClick={() => onChange(picked.filter((x) => x.id !== d.id))}><Icon name="x" size={12} /></button>
            </span>
          ))}
          <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTerm(''); }} label="Bring documents" align="start" className="sc-lib"
            anchor={<button type="button" className="sc-adddoc"><Icon name="plus" size={14} />{picked.length ? 'Add' : 'An agenda or a document'}</button>}>
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
        </span>
      </span>
    </div>
  );
}
