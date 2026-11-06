/*
 * The blocks that aren't text, drawn from their attributes: photos, files, video, a link to a document, what the
 * call's notes say, and a quote from the transcript. Every state (waiting, uploading, failed) is in the attributes,
 * so everyone sees it, and everything they can do goes through the Editor's props. A stored picture is read through
 * the media handlers while its block is on the page, and a file that's been deleted for good says so where it was.
 */
import { Avatar, Button, Icon, IconButton, cn } from '@alcove/ui';
import type { Person } from '@alcove/api';
import { firstName } from '@alcove/api';
import type { Node as PMNode } from 'prosemirror-model';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { position } from '~/lib/time';
import { removeBlock, setBlockAttrs, setCaption } from '../actions';
import type { EditorRuntime } from '../runtime';
import { captionsOf, numberAttr, textAttr } from '../schema';
import type { MediaHandlers, MediaState, VideoPlay } from '../types';
import { clockOf, liveWhen } from '../../live/dates';
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

const noChanges = { subscribe: () => () => undefined, getSnapshot: () => 0 };

/** The media handlers, drawing again whenever what they say changes. */
function useMediaHandlers(): MediaHandlers | undefined {
  const media = useRuntime().props.media;
  const changes = media?.changes ?? noChanges;
  useSyncExternalStore(changes.subscribe, changes.getSnapshot, changes.getSnapshot);
  return media;
}

const LOADING: MediaState = { kind: 'loading' };

/** A stored picture, read for as long as this is on the page. */
function usePicture(id: string | null): MediaState {
  const media = useMediaHandlers();
  const hold = media?.hold;
  useEffect(() => (id && hold ? hold(id) : undefined), [id, hold]);
  if (!id || !media) return LOADING;
  if (media.state) return media.state(id);
  const url = media.url(id);
  return url ? { kind: 'ready', url } : LOADING;
}

/** What a block's upload is known by: its `upload` token, which follows the block when it's moved, or the block's ID. */
const uploadKey = (node: PMNode): string | null => textAttr(node, 'upload') ?? textAttr(node, 'id');

/** A block that says it's uploading. Whether it's going on somewhere, or nobody's sending it any more. */
function uploadOf(media: MediaHandlers | undefined, node: PMNode): { percent: number | null; stalled: boolean } {
  const up = numberAttr(node, 'up');
  const key = uploadKey(node);
  if (up === null || textAttr(node, 'failed') !== null) return { percent: null, stalled: false };
  const stalled = key !== null && media?.stalled?.(key) === true;
  return { percent: stalled ? null : Math.round(up), stalled };
}

/** The upload's ring and words. Once it's done they fade, 240 ms; once it's failed they make way at once. */
function Uploading({ percent, failed }: { percent: number | null; failed: boolean }) {
  const [last, setLast] = useState(percent);
  const leaving = percent === null && last !== null && !failed;
  useEffect(() => {
    if (percent !== null || failed) { setLast(percent); return undefined; }
    const t = setTimeout(() => setLast(null), 240);
    return () => clearTimeout(t);
  }, [percent, failed]);
  const shown = percent ?? (leaving ? last : null);
  if (shown === null) return null;
  return <span className={cn('wb-up', leaving && 'is-leaving')}><span className="wb-ring" style={{ '--p': shown }} /><span>Sealing and uploading · {shown}%</span></span>;
}

/**
 * What failed, with what to do about it. The rest of the document is untouched. Try again only where this browser still
 * has what it was sending, and for a photo it can't read, Add as a file in its place.
 */
function Failed({ name, block, upload, retry, asFile }: { name: string; block: string | null; upload: string | null; retry: boolean; asFile: boolean }) {
  const rt = useRuntime();
  return (
    <span className="wb-fail">
      <Icon name="alert" size={15} />
      <span>Couldn’t upload {name}</span>
      {!rt.readOnly && block && (
        <>
          {upload && asFile && <button type="button" className="ac-btn is-secondary is-xs" onClick={() => rt.props.media?.onAsFile?.(upload, block)}>Add as a file</button>}
          {upload && retry && <button type="button" className="ac-btn is-secondary is-xs" onClick={() => rt.props.media?.onRetry?.(upload)}>Try again</button>}
          <button type="button" className="ac-btn is-quiet is-xs" onClick={() => removeBlock(rt, block)}>Delete</button>
        </>
      )}
    </span>
  );
}

interface Failure { name: string; retry: boolean; asFile: boolean }

/** A block's failure, as it says it: what it says it failed with, or what it was sending when nobody was any more. */
function failureOf(media: MediaHandlers | undefined, node: PMNode, stalled: boolean, name: string): Failure | null {
  const failed = textAttr(node, 'failed');
  const key = uploadKey(node);
  const retry = key !== null && media?.onRetry !== undefined && media.canRetry?.(key) === true;
  const asFile = key !== null && media?.onAsFile !== undefined && media.canAddAsFile?.(key) === true;
  if (failed !== null) return { name: failed, retry, asFile };
  return stalled ? { name, retry, asFile: false } : null;
}

/** Where a picture was, once it's deleted for good: in this document, in another, or in an older version. */
function Deleted({ what }: { what: 'photo' | 'video' }) {
  return <span className="wb-gone"><Icon name="imageOff" size={18} /><span>{what === 'photo' ? 'This photo was deleted.' : 'This video was deleted.'}</span></span>;
}

/** A picture that's there and didn't come, however long it was tried for. It's tried again while it's on the page. */
const NotLoaded = () => <span className="wb-gone"><Icon name="image" size={18} /><span>This photo didn’t load.</span></span>;

/**
 * A caption is typed in peace and written 300 ms after the last key: it's one field, not a shared line of text. What's
 * still waiting is written if the block is moved or redrawn first. A photo has a caption once it's uploaded.
 */
function Caption({ value, block, media }: { value: string; block: string | null; media: string | null }) {
  const rt = useRuntime();
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef<string | null>(null);
  useEffect(() => () => {
    clearTimeout(timer.current);
    const cap = waiting.current;
    if (cap !== null && block && media) queueMicrotask(() => setCaption(rt, block, media, cap));
  }, [rt, block, media]);
  if ((rt.readOnly && !value) || !block || !media) return null;
  const commit = (cap: string) => {
    clearTimeout(timer.current);
    waiting.current = null;
    /* Not straight away: the field losing focus can be ProseMirror taking it off the page, in the middle of drawing. */
    if (cap !== value) queueMicrotask(() => setCaption(rt, block, media, cap));
  };
  return (
    <input
      className="wb-cap" type="text" aria-label="Caption" placeholder="Add a caption" readOnly={rt.readOnly} value={draft ?? value}
      onChange={(e) => {
        const cap = e.target.value;
        setDraft(cap);
        waiting.current = cap;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(cap), 300);
      }}
      onBlur={() => { if (draft !== null) commit(draft); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

/** The shape of a picture, within reason: the numbers come from other people's browsers, and a sliver or a tower hides the page. */
const shapeOf = (width: number | null, height: number | null): string | undefined => {
  if (!width || !height || width < 0 || height < 0) return undefined;
  return String(Math.max(0.25, Math.min(4, width / height)));
};

/** Space for a picture before it's here, so nothing jumps when it arrives: its own shape, or a photo's, if nobody said. */
const holdSpace = (item: GalleryItem): CSSProperties => ({ aspectRatio: shapeOf(item.width, item.height) ?? '3 / 2' });

/**
 * What a photo shows: the stored picture once it's here, and until then, in the browser sending it, the file it's sending.
 * That stays until the stored one has come, so the picture never blinks as it lands.
 */
function useShown(item: GalleryItem, upload: string | null, index: number): { src: string | undefined; state: MediaState } {
  const media = useMediaHandlers();
  const state = usePicture(item.media);
  const preview = upload ? media?.preview?.(upload, index) : undefined;
  return { src: state.kind === 'ready' ? state.url : preview, state };
}

/** One photo at full width, or narrower: the handles at its sides pull it in. */
function Photo({ node, item, getPos }: { node: PMNode; item: GalleryItem; getPos: () => number | undefined }) {
  const rt = useRuntime();
  const media = useMediaHandlers();
  const box = useRef<HTMLElement>(null);
  const stored = numberAttr(node, 'width') ?? 100;
  const [width, setWidth] = useState<number | null>(null);
  const id = textAttr(node, 'id');
  const { src, state } = useShown(item, uploadKey(node), 0);
  const upload = uploadOf(media, node);
  const failed = failureOf(media, node, upload.stalled, item.name);

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
  /* Nothing will ever show of a photo that failed before it was stored without a size: only what went wrong. */
  const bare = !src && failed !== null && item.media === null && shapeOf(item.width, item.height) === undefined;
  return (
    <figure ref={box} className={shown >= 100 ? 'wb-fig is-full' : 'wb-fig'} style={shown < 100 ? { width: `${shown}%`, flex: 'none', marginInline: 'auto' } : undefined}>
      <div className={cn('wb-ph', bare && 'is-bare')} style={src || bare ? undefined : holdSpace(item)}>
        {src && <img className="wb-img" src={src} alt={item.cap} draggable={false} />}
        {!src && state.kind === 'gone' && <Deleted what="photo" />}
        {!src && state.kind === 'failed' && <NotLoaded />}
        <Uploading percent={upload.percent} failed={failed !== null} />
        {failed && <Failed name={failed.name} block={id} upload={uploadKey(node)} retry={failed.retry} asFile={failed.asFile} />}
        {!rt.readOnly && !bare && <><span className="wb-hand l" aria-hidden="true" onPointerDown={resize} /><span className="wb-hand r" aria-hidden="true" onPointerDown={resize} /></>}
      </div>
      <Caption value={item.cap} block={id} media={item.media} />
    </figure>
  );
}

/** A photo in a gallery: cropped to the same shape as the others. */
function GalleryPhoto({ item, block, upload, index }: { item: GalleryItem; block: string | null; upload: string | null; index: number }) {
  const { src, state } = useShown(item, upload, index);
  return (
    <figure className="wb-gi">
      <div className="wb-ph">
        {src ? <img className="wb-img" src={src} alt={item.cap} draggable={false} /> : (
          <div className={cn('wb-img', state.kind === 'gone' && 'is-gone')} title={state.kind === 'gone' ? 'This photo was deleted.' : undefined}>
            {state.kind === 'gone' && <Icon name="imageOff" size={18} />}
          </div>
        )}
      </div>
      <Caption value={item.cap} block={block} media={item.media} />
    </figure>
  );
}

/** Photos picked from `/` before any are chosen: drop them here, or press it to choose them. */
function EmptyPhotos({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const id = textAttr(node, 'id');
  const drag = useSyncExternalStore(rt.fileDrag.subscribe, rt.fileDrag.get, rt.fileDrag.get);
  const over = drag !== null && 'into' in drag && drag.into === id;
  const choose = rt.props.media?.onChoose;
  const inner = <><Icon name="imagePlus" size={20} /><span>Drop photos here, or choose them</span></>;
  if (rt.readOnly || !choose || !id) return <div className={cn('wb-drop', over && 'is-over')}>{inner}</div>;
  return <button type="button" className={cn('wb-drop', over && 'is-over')} onClick={(e) => choose(id, e.currentTarget.getBoundingClientRect())}>{inner}</button>;
}

function Gallery({ node, getPos }: { node: PMNode; getPos: () => number | undefined }) {
  const media = useMediaHandlers();
  const items = galleryItems(node);
  const first = items[0];
  const id = textAttr(node, 'id');
  const upload = uploadOf(media, node);
  /* Photos someone took off the page, with a caption that reached them afterwards: what it says is what's left. */
  if (textAttr(node, 'gone') !== null) return <p className="wb-left">{captionsOf(node).join(' · ')}</p>;
  if (!first) return <EmptyPhotos node={node} />;
  if (items.length === 1) return <Photo node={node} item={first} getPos={getPos} />;
  const failed = failureOf(media, node, upload.stalled, items.find((i) => i.media === null)?.name ?? first.name);
  return (
    <div className={items.length === 3 ? 'wb-gal n3' : 'wb-gal'}>
      {items.map((item, i) => <GalleryPhoto key={i} item={item} block={id} upload={uploadKey(node)} index={i} />)}
      <Uploading percent={upload.percent} failed={failed !== null} />
      {failed && <Failed name={failed.name} block={id} upload={uploadKey(node)} retry={failed.retry} asFile={failed.asFile} />}
    </div>
  );
}

const sizeLabel = (bytes: number | null): string => {
  if (bytes === null) return '';
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

function FileRow({ node }: { node: PMNode }) {
  const media = useMediaHandlers();
  const name = textAttr(node, 'name') ?? '';
  const file = textAttr(node, 'media');
  const upload = uploadOf(media, node);
  const failed = failureOf(media, node, upload.stalled, name);
  const watch = media?.watch;
  useEffect(() => (file && watch ? watch(file) : undefined), [file, watch]);
  const gone = file !== null && media?.gone?.(file) === true;
  const open = media?.onOpenFile;
  return (
    <div className={cn('wb-file', gone && 'is-gone')}>
      <span className="i"><Icon name="clip" size={17} /></span>
      <span className="m"><b>{name}</b><small>{gone ? 'Deleted' : sizeLabel(numberAttr(node, 'size'))}</small></span>
      {failed ? <Failed name={failed.name} block={textAttr(node, 'id')} upload={uploadKey(node)} retry={failed.retry} asFile={failed.asFile} /> : upload.percent !== null ? <span className="wb-ring" style={{ '--p': upload.percent }} /> : null}
      {!failed && upload.percent === null && file && !gone && open && <button type="button" className="wb-dl" aria-label={`Download ${name}`} onClick={() => open({ media: file, name })}><Icon name="download" size={16} /></button>}
    </div>
  );
}

/**
 * A video plays here, for whoever presses Play, from where a player reads it. A read that runs out gives way and the
 * player asks again from where it got to; a URL that's gone stale is asked for afresh, once a minute at most. While it plays
 * for everyone in the call (`together`), what was playing here alone stops, and doesn't come back by itself after.
 */
function usePlayer(file: string | null, together: boolean) {
  const media = useMediaHandlers();
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const asked = useRef(0);
  const ask = (resume?: number | undefined) => {
    const stream = media?.stream;
    if (!file || !stream) return;
    asked.current = Date.now();
    stream(file).then((url) => { setSrc(resume === undefined ? url : `${url}#t=${resume}`); setBroken(false); }, () => { setSrc(null); });
  };
  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (Date.now() - asked.current < 60_000) { setBroken(true); return; }
    ask(e.currentTarget.currentTime);
  };
  useEffect(() => { if (together) { setSrc(null); setBroken(false); } }, [together]);
  return { src, broken, play: () => ask(), onError };
}

/**
 * The picture everyone in the call is watching, lent to this block while it's on the page, with where it's got to. It's
 * given back before the page under it goes, so it's never out of the page for a moment, which would stop it.
 */
function Showing({ play, dur }: { play: VideoPlay; dur: number }) {
  const box = useRef<HTMLDivElement>(null);
  const show = play.show;
  useLayoutEffect(() => { const el = box.current; return el ? show(el) : undefined; }, [show]);
  const clock = useSyncExternalStore(play.clock.subscribe, play.clock.getSnapshot);
  const total = clock.total || dur;
  return (
    <>
      <div ref={box} className="wb-vlive" />
      <div className="wb-vbar"><span className="wb-vfill" style={{ width: `${total > 0 ? Math.min(1, clock.seconds / total) * 100 : 0}%` }} /></div>
      <span className="wb-vtime ac-time">{position(clock.seconds)} / {position(total)}</span>
    </>
  );
}

function VideoBlock({ node }: { node: PMNode }) {
  const media = useMediaHandlers();
  const id = textAttr(node, 'id');
  const file = textAttr(node, 'media');
  const title = textAttr(node, 'title') ?? '';
  const poster = usePicture(textAttr(node, 'poster'));
  const key = uploadKey(node);
  const preview = key ? media?.preview?.(key, 0) : undefined;
  const still = poster.kind === 'ready' ? poster.url : preview;
  const dur = numberAttr(node, 'dur') ?? 0;
  const upload = uploadOf(media, node);
  const failed = failureOf(media, node, upload.stalled, title);
  const width = numberAttr(node, 'width'), height = numberAttr(node, 'height');
  const play = file !== null && media?.playing?.media === file ? media.playing : null;
  const watch = media?.watch;
  useEffect(() => (file && watch ? watch(file) : undefined), [file, watch]);
  const gone = file !== null && media?.gone?.(file) === true;
  const ready = upload.percent === null && !failed && file !== null && !gone;
  const player = usePlayer(file, play !== null);
  const learned = (e: SyntheticEvent<HTMLVideoElement>) => {
    const seconds = e.currentTarget.duration;
    if (id && dur <= 0 && Number.isFinite(seconds) && seconds > 0) media?.onDuration?.(id, Math.round(seconds));
  };
  const onPlay = media?.onPlay;
  const everyone = onPlay && id && file ? <Button variant="primary" size="sm" icon="play" onClick={() => onPlay({ block: id, media: file })}>Play for everyone</Button> : null;
  return (
    /* A film is always seen against the night, whatever the page's theme: what's on it wears the night's colours. */
    <div className="wb-vid dark" style={{ aspectRatio: shapeOf(width, height) }}>
      {player.src && !play ? (
        <video className="wb-player" src={player.src} controls autoPlay playsInline onError={player.onError} onLoadedMetadata={learned} />
      ) : still && <img className="wb-img" src={still} alt="" draggable={false} />}
      {gone && <Deleted what="video" />}
      {ready && !play && !player.src && (
        <div className="wb-vctl">
          {everyone}
          {media?.stream && (everyone
            ? <IconButton icon="play" size={15} label="Play here" className="wb-here" onClick={player.play} />
            : <Button variant="primary" size="sm" icon="play" onClick={player.play}>Play</Button>)}
          {dur > 0 && <span className="ac-time">{position(dur)}</span>}
        </div>
      )}
      {player.broken && <span className="wb-gone"><Icon name="alert" size={18} /><span>This video can’t play in this browser.</span></span>}
      {play && <Showing play={play} dur={dur} />}
      {!player.src && <span className="wb-vt">{title}</span>}
      <Uploading percent={upload.percent} failed={failed !== null} />
      {failed && <Failed name={failed.name} block={id} upload={uploadKey(node)} retry={failed.retry} asFile={failed.asFile} />}
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
  const inCall = rt.props.call !== undefined && textAttr(node, 'call') === rt.props.call.id;
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
          <span className="ac-time">{liveWhen(l)}</span>
        </div>
      ))}
    </div>
  );
}

function Moment({ node }: { node: PMNode }) {
  const rt = useRuntime();
  const name = textAttr(node, 'name') ?? '';
  const at = textAttr(node, 'at') ?? '';
  const note = textAttr(node, 'note');
  const line = textAttr(node, 'line');
  return (
    <div className="wb-mom">
      <PersonFace id={textAttr(node, 'person') ?? ''} name={name} size={26} />
      <div>
        <p>“{textAttr(node, 'text')}”</p>
        <span className="m">
          <span>{firstName(name)} · {clockOf(at)}</span>
          {note && line && rt.props.hear?.({ note, line })}
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
