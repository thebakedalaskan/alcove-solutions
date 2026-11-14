/*
 * Shared screens in a note: a frame as it was shown, the part of it something points at, how well it could be read,
 * and the moment of the call it belongs to. Calm by design: a thumbnail beside the lines said while it was up, never a
 * wall of images.
 */
import type { ScreenLegible, ScreenRegion } from '@alcove/api';
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Chip } from '../foundation/primitives';

/**
 * Where a part's label goes: above its box, or under it when the box starts near the frame's top (the frame clips
 * what's outside it), or inside it when it runs from top to bottom; and from the box's right edge when the box sits on
 * the frame's right, so a long label doesn't run off it.
 */
const labelAt = (r: ScreenRegion) => cn(r.y < 0.16 && (r.y + r.h < 0.84 ? 'is-below' : 'is-inside'), r.x > 0.5 && 'is-end');

/**
 * A frame of a shared screen at its own shape. `focus` outlines one of its parts (what something points at), with its
 * label; `parts` outlines all of them, quietly.
 */
export function ScreenShot({ src, alt, width, height, regions = [], focus, parts = false, className }: {
  src: string; alt: string; width: number; height: number; regions?: ScreenRegion[] | undefined; focus?: number | undefined; parts?: boolean | undefined; className?: string | undefined;
}) {
  return (
    <span className={cn('ac-shot', className)} style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` }}>
      <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} />
      {regions.map((r, i) => (parts || i === focus) && (
        <span key={`${i}-${r.label}`} aria-hidden="true" className={cn('ac-shot-part', i === focus && 'is-focus')}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
          {i === focus && <span className={cn('lbl', labelAt(r))}>{r.label}</span>}
        </span>
      ))}
    </span>
  );
}

const LEGIBLE: Record<Exclude<ScreenLegible, 'clear'>, string> = { partly: 'Partly readable', unreadable: 'Couldn’t be read', unread: 'Not read' };
/** How well a frame could be read, when it wasn't all: said calmly, so nothing on it is taken for more than it shows. */
export function ScreenLegibility({ legible, className }: { legible: ScreenLegible; className?: string | undefined }) {
  if (legible === 'clear') return null;
  return <Chip tone={legible === 'unread' ? 'outline' : 'caution'} icon="eyeOff" className={cn('ac-screen-legible', className)}>{LEGIBLE[legible]}</Chip>;
}

/**
 * One moment a shared screen changed, among the lines said while it was up: its thumbnail, what it is, whose screen and
 * when (`meta`), what it shows, and how legible it was. Opens the frame.
 */
export function ScreenMomentCard({ src, width, height, title, meta, description, legible, onOpen, className }: {
  src: string; width: number; height: number; title: string; meta: ReactNode; description?: string | undefined; legible?: ScreenLegible | undefined;
  onOpen: () => void; className?: string | undefined;
}) {
  const name = title.trim() || 'A shared screen';
  return (
    <button type="button" className={cn('ac-screen', className)} onClick={onOpen} aria-label={`Open the screen: ${name}`}>
      <ScreenShot src={src} alt="" width={width} height={height} className="thumb" />
      <span className="what">
        <span className="t"><Icon name="monitor" size={14} />{name}</span>
        <span className="m">{meta}</span>
        {description && <span className="d">{description}</span>}
        {legible && <ScreenLegibility legible={legible} />}
      </span>
    </button>
  );
}
