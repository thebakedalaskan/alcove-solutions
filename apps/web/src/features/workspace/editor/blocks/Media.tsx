/*
 * The blocks that aren't text, drawn from their attributes: photos, files, video, a link to a document, what the
 * call's notes say, and a quote from the transcript. Every state (waiting, uploading, failed) is in the attributes,
 * so everyone sees it, and everything they can do goes through the Editor's props.
 */
import { Avatar, Button, Icon } from '@alcove/ui';
import type { Person } from '@alcove/api';
import { firstName } from '@alcove/api';
import type { Node as PMNode } from 'prosemirror-model';
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { position } from '~/lib/time';
import { removeBlock, setBlockAttrs, setCaption } from '../actions';
import type { EditorRuntime } from '../runtime';
import { numberAttr, textAttr } from '../schema';
import { galleryItems, liveLines, type GalleryItem } from './attrs';

export const RuntimeContext = createContext<EditorRuntime | null>(null);

function useRuntime(): EditorRuntime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('Editor blocks render inside the Editor');
  return rt;
}

export function PersonFace({ id, name, size }: { id: string; name: string; size: number }) {
  const rt = useRuntime();
  const person: Pick<Person, 'name'> = rt.people.get(id) ?? { name };
  return <Avatar person={person} size={size} />;
}

function Uploading({ percent }: { percent: number }) {
  return <span className="wb-up"><span className="wb-ring" style={{ '--p': percent }} /><span>Sealing and uploading · {percent}%</span></span>;
}

/** What failed, with what to do about it. The rest of the document is untouched. */
function Failed({ name, block }: { name: string; block: string | null }) {
  const rt = useRuntime();
  return (
    <span className="wb-fail">
      <Icon name="alert" size={15} />
      <span>Couldn’t upload {name}</span>
      {!rt.readOnly && block && (
        <>
          {rt.props.media?.onRetry && <button type="button" className="ac-btn is-secondary is-xs" onClick={() => rt.props.media?.onRetry?.(block)}>Try again</button>}
          <button type="button" className="ac-btn is-quiet is-xs" onClick={() => removeBlock(rt, block)}>Delete</button>
        </>
      )}
    </span>
  );
}

/** A caption is typed in peace and written 300 ms after the last key: it's one field, not a shared line of text. */
function Caption({ value, onChange }: { value: string; onChange: (cap: string) => void }) {
  const rt = useRuntime();
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (rt.readOnly && !value) return null;
  const commit = (cap: string) => { clearTimeout(timer.current); if (cap !== value) onChange(cap); };
  return (
    <input
      className="wb-cap" type="text" aria-label="Caption" placeholder="Add a caption" readOnly={rt.readOnly} value={draft ?? value}
      onChange={(e) => {
        const cap = e.target.value;
        setDraft(cap);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(cap), 300);
      }}
      onBlur={() => { if (draft !== null) commit(draft); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

/** Space for a picture before it's here, so nothing jumps when it arrives. */
const holdSpace = (item: GalleryItem): CSSProperties => (item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : {});

/** One photo at full width, or narrower: the handles at its sides pull it in. */
function Photo({ node, item, getPos }: { node: PMNode; item: GalleryItem; getPos: () => number | undefined }) {
  const rt = useRuntime();
  const box = useRef<HTMLElement>(null);
  const stored = numberAttr(node, 'width') ?? 100;
  const [width, setWidth] = useState<number | null>(null);
  const url = item.media ? rt.props.media?.url(item.media) : undefined;
  const up = numberAttr(node, 'up');
  const failed = textAttr(node, 'failed');
  const id = textAttr(node, 'id');

  const resize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const fig = box.current, column = fig?.parentElement;
    if (!fig || !column || rt.readOnly) return;
    const handle = e.currentTarget;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const room = column.getBoundingClientRect();
    const middle = room.left + room.width / 2;
    let next = stored;
    const move = (m: PointerEvent) => {
      next = Math.round(Math.max(30, Math.min(100, (Math.abs(m.clientX - middle) * 2 / room.width) * 100)));
      setWidth(next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      const pos = getPos();
      if (pos !== undefined && next !== stored) setBlockAttrs(rt, pos, { width: next });
      setWidth(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const shown = width ?? stored;
  return (
    <figure ref={box} className={shown >= 100 ? 'wb-fig is-full' : 'wb-fig'} style={shown < 100 ? { width: `${shown}%`, flex: 'none', marginInline: 'auto' } : undefined}>
      <div className="wb-ph" style={url ? undefined : holdSpace(item)}>
        {url && <img className="wb-img" src={url} alt={item.cap} draggable={false} />}
        {up !== null && !failed && <Uploading percent={Math.round(up)} />}
        {failed && <Failed name={failed} block={id} />}
        {!rt.readOnly && <><span className="wb-hand l" aria-hidden="true" onPointerDown={resize} /><span className="wb-hand r" aria-hidden="true" onPointerDown={resize} /></>}
      </div>
      <Caption value={item.cap} onChange={(cap) => { const pos = getPos(); if (pos !== undefined) setCaption(rt, pos, 0, cap); }} />
    </figure>
  );
}

function Gallery({ node, getPos }: { node: PMNode; getPos: () => number | undefined }) {
  const rt = useRuntime();
  const items = galleryItems(node);
  const first = items[0];
  if (!first) return <div className="wb-drop"><Icon name="imagePlus" size={20} /><span>Drop photos here, or choose them</span></div>;
  if (items.length === 1) return <Photo node={node} item={first} getPos={getPos} />;
  const up = numberAttr(node, 'up');
  const failed = textAttr(node, 'failed');
  return (
    <div className={items.length === 3 ? 'wb-gal n3' : 'wb-gal'}>
      {items.map((item, i) => {
        const url = item.media ? rt.props.media?.url(item.media) : undefined;
        return (
          <figure key={item.media ?? `${item.name}-${i}`} className="wb-gi">
            <div className="wb-ph">{url ? <img className="wb-img" src={url} alt={item.cap} draggable={false} /> : <div className="wb-img" />}</div>
            <Caption value={item.cap} onChange={(cap) => { const pos = getPos(); if (pos !== undefined) setCaption(rt, pos, i, cap); }} />
          </figure>
        );
      })}
      {up !== null && !failed && <Uploading percent={Math.round(up)} />}
      {failed && <Failed name={failed} block={textAttr(node, 'id')} />}
    </div>
  );
}

const sizeLabel = (bytes: number | null): string => {
  if (bytes === null) return '';
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

function FileRow({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const name = textAttr(node, 'name') ?? '';
  const media = textAttr(node, 'media');
  const up = numberAttr(node, 'up');
  const failed = textAttr(node, 'failed');
  const open = rt.props.media?.onOpenFile;
  return (
    <div className="wb-file">
      <span className="i"><Icon name="clip" size={17} /></span>
      <span className="m"><b>{name}</b><small>{sizeLabel(numberAttr(node, 'size'))}</small></span>
      {failed ? <Failed name={failed} block={textAttr(node, 'id')} /> : up !== null ? <span className="wb-ring" style={{ '--p': Math.round(up) }} /> : null}
      {!failed && up === null && media && open && <button type="button" className="wb-dl" aria-label={`Download ${name}`} onClick={() => open({ media, name })}><Icon name="download" size={16} /></button>}
    </div>
  );
}

function VideoBlock({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const media = rt.props.media;
  const id = textAttr(node, 'id');
  const poster = textAttr(node, 'poster');
  const url = poster ? media?.url(poster) : undefined;
  const dur = numberAttr(node, 'dur') ?? 0;
  const up = numberAttr(node, 'up');
  const failed = textAttr(node, 'failed');
  const width = numberAttr(node, 'width'), height = numberAttr(node, 'height');
  const play = media?.playing?.block === id ? media?.playing : null;
  const ready = up === null && !failed;
  return (
    <div className="wb-vid" style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
      {url && <img className="wb-img" src={url} alt="" draggable={false} />}
      {ready && !play && (
        <div className="wb-vctl">
          {media?.onPlay && id && <Button variant="primary" size="sm" icon="play" onClick={() => media.onPlay?.(id)}>Play for everyone</Button>}
          <span className="ac-time">{position(dur)}</span>
        </div>
      )}
      {play && (
        <>
          <div className="wb-vbar"><span className="wb-vfill" style={{ width: `${play.total > 0 ? (play.seconds / play.total) * 100 : 0}%` }} /></div>
          <span className="wb-vtime ac-time">{position(play.seconds)} / {position(play.total)}</span>
        </>
      )}
      <span className="wb-vt">{textAttr(node, 'title')}</span>
      {up !== null && !failed && <Uploading percent={Math.round(up)} />}
      {failed && <Failed name={failed} block={id} />}
    </div>
  );
}

function DocLink({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const doc = textAttr(node, 'doc') ?? '';
  const name = rt.props.documentName?.(doc);
  return (
    <button type="button" className="wb-doc" disabled={name === undefined} onClick={() => rt.props.onOpenDocument?.(doc)}>
      <Icon name="fileText" size={16} /><span>{name ?? 'A document you can’t open'}</span>{name !== undefined && <Icon name="external" size={14} />}
    </button>
  );
}

function Live({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const decided = textAttr(node, 'what') !== 'followups';
  const lines = liveLines(node);
  const inCall = rt.props.call !== undefined;
  return (
    <div className="wb-live">
      <div className="wb-lh">
        {inCall && <span className="ac-rec-dot" />}
        <b>{decided ? 'Decided so far' : 'Follow-ups so far'}</b>
        {inCall && <span className="d">Live from the notes</span>}
      </div>
      {lines.length === 0 && <div className="wb-lr is-none"><span className="tx">{decided ? 'Nothing decided yet' : 'No follow-ups yet'}</span></div>}
      {lines.map((l, i) => (
        <div key={`${l.at}-${i}`} className="wb-lr">
          {(l.person || l.name) && <PersonFace id={l.person ?? ''} name={l.name ?? ''} size={18} />}
          <span className="tx">{l.text}</span>
          <span className="ac-time">{l.due || l.at}</span>
        </div>
      ))}
    </div>
  );
}

function Moment({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const name = textAttr(node, 'name') ?? '';
  const at = textAttr(node, 'at') ?? '';
  const hear = rt.props.call?.onHear;
  return (
    <div className="wb-mom">
      <PersonFace id={textAttr(node, 'person') ?? ''} name={name} size={26} />
      <div>
        <p>“{textAttr(node, 'text')}”</p>
        <span className="m">
          <span>{firstName(name)} · {at}</span>
          {hear && <button type="button" className="pl" onClick={() => hear({ line: textAttr(node, 'line'), at })}><Icon name="play" size={11} />Hear it</button>}
        </span>
      </div>
    </div>
  );
}

export function MediaBlock({ node, getPos }: { node: PMNode; getPos: () => number | undefined }): ReactNode {
  switch (node.type.name) {
    case 'gallery': return <Gallery node={node} getPos={getPos} />;
    case 'file': return <FileRow node={node} />;
    case 'video': return <VideoBlock node={node} />;
    case 'doclink': return <DocLink node={node} />;
    case 'live': return <Live node={node} />;
    case 'moment': return <Moment node={node} />;
    default: return <p className="wb-unknown">This block needs a newer Alcove. Reload to see it.</p>;
  }
}
