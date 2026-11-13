/*
 * A file, as a large preview: a call's shared screens and what it made, the Drive's sheet, a workspace's home. The picture
 * says what kind of thing it is, drawn as the thing looks: a document's first lines on its page (ticks where it has
 * to-dos), a board's stickies, a PDF's page, a few photos, a shared screen with play over it. A picture of the real thing
 * can stand in for the drawing (a board drawn small, say). Under it, the name with its kind's icon, and one line of who
 * made it and when, after where it is when that isn't where you are. The name and who made it end at a word, with an
 * ellipsis, never cut through one; where it is shrinks to what it shows, so the line reads on without a gap. Styles in
 * files.css (`fc-`).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';

/** One canvas for measuring words, made the first time it's needed. */
let measurer: CanvasRenderingContext2D | null = null;
/** How wide `text` is in `font`. */
function widthOf(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return 0;
  measurer.font = font;
  return measurer.measureText(text).width;
}
/** Room kept beside the measured words, for the little a canvas and the page differ by. */
const SLACK = 2;
/**
 * As much of `text` as fits on one line `width` wide, ending at a word, with an ellipsis when some of it doesn't fit. Only a
 * single word too long for the line on its own is cut, since there's no word to end at.
 */
function fitted(text: string, width: number, font: string): string {
  if (width <= 0) return text;
  const words = text.split(/\s+/).filter(Boolean);
  let fit = 0;
  for (let n = 1; n < words.length; n++) {
    if (widthOf(`${words.slice(0, n).join(' ')}…`, font) > width - SLACK) break;
    fit = n;
  }
  if (fit > 0) return `${words.slice(0, fit).join(' ').replace(/[\s,.;:–—-]+$/, '')}…`;
  const first = words[0] ?? text;
  let cut = first.length;
  while (cut > 1 && widthOf(`${first.slice(0, cut)}…`, font) > width - SLACK) cut--;
  return `${first.slice(0, cut)}…`;
}

/**
 * Words on one line that end at a word, with an ellipsis when they don't all fit: never a word cut through. The whole of the
 * words sits in the box unseen, so the box is as wide as all of them would be wherever there's room, and what's shown is
 * fitted to the box: what's shown never changes how wide the box is. Measured in the box's font as it changes size, and again
 * once the fonts have loaded.
 */
function WordFit({ text, className }: { text: string; className?: string | undefined }) {
  const box = useRef<HTMLSpanElement>(null);
  const whole = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let gone = false;
    const fit = () => {
      if (gone) return;
      // The page says whether all of it fits, exactly; only words that don't are measured.
      if ((whole.current?.scrollWidth ?? 0) <= el.clientWidth) { setShown(text); return; }
      const s = getComputedStyle(el);
      setShown(fitted(text, el.clientWidth, `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`));
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(el);
    void document.fonts.ready.then(fit);
    return () => { gone = true; sizes.disconnect(); };
  }, [text]);
  return <span ref={box} className={cn('fc-fit', className)} title={shown === text ? undefined : text}><span ref={whole} className="fc-whole" aria-hidden="true">{text}</span>{shown}</span>;
}

/** What a file is, as its picture draws it. */
export type ThumbKind = 'doc' | 'board' | 'pdf' | 'photos' | 'share';

/** A line of a document's page as the picture draws it: plain, a bullet, or a to-do, ticked or not. */
export interface ThumbLine { text: string; mark?: 'dot' | 'todo' | 'done' | undefined }

/** How big the picture is: `md` on a call's page, `lg` on the Drive and a workspace's home. */
export type FileCardSize = 'md' | 'lg';

export interface ThumbProps {
  kind: ThumbKind;
  /** A document's title, at the top of its page. Left out where the name under the picture says it. */
  title?: string | undefined;
  /** A document's first lines, as its page starts. Without any, the page shows only that it's a page. */
  lines?: readonly ThumbLine[] | undefined;
  /** How many photos there are, on the last of them. */
  count?: number | undefined;
  /** The real thing drawn small, in place of the drawing: it fills the picture. */
  picture?: ReactNode;
  /** The picture's box, for whoever draws the real thing to measure: the drawing stands in until it's there. */
  thumbRef?: Ref<HTMLSpanElement> | undefined;
  size?: FileCardSize | undefined;
  className?: string | undefined;
}

/** A document's page: its title when it has one, then its first lines. */
function Page({ title, lines }: { title: string | undefined; lines: readonly ThumbLine[] }) {
  return (
    <span className="fc-page">
      {title && <b><WordFit text={title} /></b>}
      {lines.slice(0, 4).map((l, i) => (
        <span key={i} className="fc-ln">
          {l.mark && <i className={cn('fc-mk', `is-${l.mark}`)} />}
          <WordFit text={l.text} />
        </span>
      ))}
      {!title && !lines.length && <><span className="fc-bar" /><span className="fc-bar is-short" /><span className="fc-bar" /></>}
    </span>
  );
}

/** The picture on a file's card. It's decoration: the card's own words say what it is. */
export function Thumb({ kind, title, lines = [], count, picture, thumbRef, size = 'md', className }: ThumbProps) {
  return (
    <span ref={thumbRef} className={cn('fc-thumb', `is-${kind}`, size === 'lg' && 'is-lg', picture !== undefined && picture !== null && 'has-picture', className)} aria-hidden="true">
      {picture ?? (
        kind === 'doc' ? <Page title={title} lines={lines} />
          : kind === 'board' ? (
            <>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M30 40C40 52 52 50 60 62" /></svg>
              <i className="fc-note n1" /><i className="fc-note n2" /><i className="fc-note n3" /><i className="fc-note n4" /><i className="fc-note n5" />
            </>
          )
            : kind === 'pdf' ? <span className="fc-pdf"><i /><b>PDF</b></span>
              : kind === 'photos' ? <><i className="fc-photo" /><i className="fc-photo" /><i className="fc-photo" /><i className="fc-photo" />{count !== undefined && count > 0 && <b className="fc-count">{count}</b>}</>
                : <><span className="fc-sheet"><i /><i /><i /></span><span className="fc-play"><Icon name="play" size={12} /></span></>
      )}
    </span>
  );
}

const KIND_ICON: Record<ThumbKind, IconName> = { doc: 'fileText', board: 'presentation', pdf: 'clip', photos: 'image', share: 'monitor' };

export interface FileCardProps {
  kind: ThumbKind;
  name: string;
  /** Its kind's icon, beside its name, when the kind's own isn't the one. */
  icon?: IconName | undefined;
  /** Who made it and when, or how long a screen was shared: "Kofi edited at 10:12", "2 min 30 s". */
  by?: ReactNode;
  /** Where it is, ahead of who made it: "In Launch", "From Team standup". Leave it out inside the place it names. */
  where?: string | undefined;
  /** For a shared screen, the moment it starts: "8:10", on a ▶ chip ahead of the by-line. */
  at?: string | undefined;
  onOpen: () => void;
  /** What pressing the card does, for a screen reader, when it's more than opening it: "Play Kofi’s screen from 8:10". */
  label?: string | undefined;
  /** A ⋯ button opening the card's menu, over the corner of its picture: there on hover and focus, and always on a touch screen. */
  menu?: ReactNode;
  /** What the picture shows besides its kind. */
  thumb?: Omit<ThumbProps, 'kind' | 'size'> | undefined;
  size?: FileCardSize | undefined;
  /** Lit: what's playing or open now. */
  current?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A file as a large preview. The whole card opens it: its name is the button, stretched over the card, so a screen reader
 * hears the name and the keyboard lands once. A menu sits over the picture's corner, above that, as a button of its own.
 */
export function FileCard({ kind, name, icon, by, where, at, onOpen, label, menu, thumb, size = 'md', current = false, className }: FileCardProps) {
  return (
    <div className={cn('fc', size === 'lg' && 'is-lg', current && 'is-current', className)}>
      <Thumb kind={kind} size={size} {...thumb} />
      <span className="fc-name">
        <Icon name={icon ?? KIND_ICON[kind]} size={15} />
        <button type="button" className="fc-open" aria-label={label ?? name} aria-current={current ? 'true' : undefined} onClick={onOpen}><WordFit text={name} /></button>
      </span>
      {(where || at || by) && (
        <span className="fc-by">
          {where && <em title={where}>{where}</em>}
          {where && (at || by) && <span className="fc-sep" aria-hidden="true">·</span>}
          {at && <span className="fc-at"><Icon name="play" size={9} />{at}</span>}
          {by && (typeof by === 'string' ? <WordFit text={by} /> : <span className="fc-fit">{by}</span>)}
        </span>
      )}
      {menu && <span className="fc-menu">{menu}</span>}
    </div>
  );
}
