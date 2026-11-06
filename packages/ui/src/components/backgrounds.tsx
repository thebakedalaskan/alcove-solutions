/* What shows behind someone on camera: nothing, blur, Alcove's pictures, or their own. */
import type { BackgroundScene, CameraBackground } from '@alcove/api';
import { useId, type ChangeEvent, type ReactNode } from 'react';
import balloons from '../backgrounds/balloons.jpg';
import balloonsThumb from '../backgrounds/balloons-thumb.jpg';
import beach from '../backgrounds/beach.jpg';
import beachThumb from '../backgrounds/beach-thumb.jpg';
import office from '../backgrounds/office.jpg';
import officeThumb from '../backgrounds/office-thumb.jpg';
import { cn } from '../cn';
import { Icon } from './icon';
import { IconButton, Spinner } from './primitives';

/** Alcove's pictures (drawn in backgrounds/*.svg): what each is called, the full picture, and a small one to pick it by. */
export const SCENE_PICTURES: Record<BackgroundScene, { label: string; src: string; thumb: string }> = {
  balloons: { label: 'Balloons', src: balloons, thumb: balloonsThumb },
  beach: { label: 'Beach', src: beach, thumb: beachThumb },
  office: { label: 'Office', src: office, thumb: officeThumb }
};

/** One of someone's own pictures, ready to show. */
export interface PickerPicture { id: string; src: string }

const same = (a: CameraBackground, b: CameraBackground) => a.kind === b.kind && ('id' in a ? 'id' in b && a.id === b.id : true);

function Swatch({ on, label, onPick, children }: { on: boolean; label: string; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn('ac-bgpick-opt', on && 'is-on')} aria-pressed={on} aria-label={label} title={label} onClick={onPick}>
      {children}
    </button>
  );
}

/**
 * Background choices as small pictures: none, blur, `scenes`, then the person's own `pictures` (null while they're
 * read) with a way to remove each, and a tile to add one. Without `onAdd` (a guest, or a browser that can't keep
 * them) there's no adding, and `pictures` is empty.
 */
export function BackgroundPicker({ value, scenes, pictures, onPick, onAdd, onRemove, adding = false, full = false, accept }: {
  value: CameraBackground;
  scenes: readonly { id: BackgroundScene; label: string }[];
  pictures: readonly PickerPicture[] | null;
  onPick: (b: CameraBackground) => void;
  onAdd?: ((file: File) => void) | undefined;
  onRemove: (id: string) => void;
  /** A picture is being added. */
  adding?: boolean | undefined;
  /** No room for another picture. */
  full?: boolean | undefined;
  /** The picture types `onAdd` takes, for the file picker. */
  accept: string;
}) {
  const id = useId();
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && onAdd) onAdd(file);
  };
  return (
    <div className="ac-bgpick" role="group" aria-label="Background">
      <Swatch on={value.kind === 'none'} label="None" onPick={() => onPick({ kind: 'none' })}>
        <Icon name="circleOff" size={18} /><span>None</span>
      </Swatch>
      <Swatch on={value.kind === 'blur'} label="Blur" onPick={() => onPick({ kind: 'blur' })}>
        <span className="ac-bgpick-blur" aria-hidden="true" /><Icon name="droplets" size={18} /><span>Blur</span>
      </Swatch>
      {scenes.map((s) => {
        const b: CameraBackground = { kind: 'scene', id: s.id };
        return (
          <Swatch key={s.id} on={same(value, b)} label={s.label} onPick={() => onPick(b)}>
            <img src={SCENE_PICTURES[s.id].thumb} alt="" draggable={false} />
          </Swatch>
        );
      })}
      {pictures?.map((p, i) => {
        const b: CameraBackground = { kind: 'custom', id: p.id };
        return (
          <div key={p.id} className="ac-bgpick-cell">
            <Swatch on={same(value, b)} label={`Your picture ${i + 1}`} onPick={() => onPick(b)}>
              <img src={p.src} alt="" draggable={false} />
            </Swatch>
            <IconButton icon="x" size={14} label={`Remove your picture ${i + 1}`} className="ac-bgpick-x" onClick={() => onRemove(p.id)} />
          </div>
        );
      })}
      {onAdd && !full && (
        <label htmlFor={id} className={cn('ac-bgpick-opt is-add', adding && 'is-busy')} title="Add image">
          <input id={id} type="file" accept={accept} className="ac-bgpick-file" disabled={adding} onChange={pick} />
          {adding ? <Spinner /> : <Icon name="imagePlus" size={18} />}<span>{adding ? 'Adding…' : 'Add image'}</span>
        </label>
      )}
    </div>
  );
}
