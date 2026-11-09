/* What shows behind someone on camera: nothing, blur, Alcove's pictures, or their own. */
import { BACKGROUND_COLORS, type BackgroundColor, type BackgroundScene, type CameraBackground } from '@alcove/api';
import { useId, type ChangeEvent, type ReactNode } from 'react';
import balloons from '../backgrounds/balloons.jpg';
import balloonsThumb from '../backgrounds/balloons-thumb.jpg';
import beach from '../backgrounds/beach.jpg';
import beachThumb from '../backgrounds/beach-thumb.jpg';
import office from '../backgrounds/office.jpg';
import officeThumb from '../backgrounds/office-thumb.jpg';
import { cn } from '../cn';
import { Icon } from './icon';
import { IconButton, Segmented, Spinner } from './primitives';

/** Alcove's pictures (drawn in backgrounds/*.svg): what each is called, the full picture, and a small one to pick it by. */
export const SCENE_PICTURES: Record<BackgroundScene, { label: string; src: string; thumb: string }> = {
  balloons: { label: 'Balloons', src: balloons, thumb: balloonsThumb },
  beach: { label: 'Beach', src: beach, thumb: beachThumb },
  office: { label: 'Office', src: office, thumb: officeThumb }
};

/** Original, fixed Blue Hour colors. Both the camera's output and its swatch use these exact RGB values in every theme. */
export const CAMERA_COLORS: Record<BackgroundColor, { label: string; rgb: readonly [number, number, number] }> = {
  slate: { label: 'Slate', rgb: [52, 69, 95] },
  sand: { label: 'Sand', rgb: [216, 202, 186] },
  rose: { label: 'Rose', rgb: [185, 150, 161] }
};

/** One of someone's own pictures, ready to show. */
export interface PickerPicture { id: string; src: string }

/** Live support and processing feedback, shared by the camera menu and prejoin. */
export function BackgroundStatus({ support, quality, preparing, cameraOn, effectOn }: {
  support: 'checking' | 'supported' | 'unsupported';
  quality: 'full' | 'balanced' | 'light';
  preparing: boolean;
  cameraOn: boolean;
  effectOn: boolean;
}) {
  const text = support === 'checking' ? 'Checking camera effects…'
    : support === 'unsupported' ? 'This browser can’t draw camera effects. Choose Off to use your camera without them.'
    : preparing ? 'Preparing your background. Your camera stays covered.'
    : !cameraOn && effectOn ? 'Your camera is off. This background will be used when you turn it on.'
    : cameraOn && effectOn && quality !== 'full' ? 'Background quality is reduced to keep your call smooth. Your effect stays on.'
    : cameraOn && effectOn ? 'Your preview includes the background others will see.' : null;
  return text ? <p className="hint" role="status">{text}</p> : null;
}

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
export function BackgroundPicker({ value, scenes, pictures, onPick, onAdd, onRemove, onReplace, adding = false, full = false, accept }: {
  value: CameraBackground;
  scenes: readonly { id: BackgroundScene; label: string }[];
  pictures: readonly PickerPicture[] | null;
  onPick: (b: CameraBackground) => void;
  onAdd?: ((file: File) => void) | undefined;
  onRemove: (id: string) => void;
  onReplace?: ((id: string, file: File) => void) | undefined;
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
    <div className="ac-bgpick-wrap">
     <div className="ac-bgpick" role="group" aria-label="Background">
      <Swatch on={value.kind === 'none'} label="Off" onPick={() => onPick({ kind: 'none' })}>
        <Icon name="circleOff" size={18} /><span>Off</span>
      </Swatch>
      <Swatch on={value.kind === 'blur'} label="Blur" onPick={() => onPick(value.kind === 'blur' ? value : { kind: 'blur', strength: 'strong' })}>
        <span className="ac-bgpick-blur" aria-hidden="true" /><Icon name="droplets" size={18} /><span>Blur</span>
      </Swatch>
      {BACKGROUND_COLORS.map((id) => {
        const c = CAMERA_COLORS[id];
        return <Swatch key={id} on={value.kind === 'color' && value.id === id} label={`${c.label} background`} onPick={() => onPick({ kind: 'color', id })}>
          <span className="ac-bgpick-color" style={{ background: `rgb(${c.rgb.join(' ')})` }} aria-hidden="true" /><span className="ac-bgpick-caption">{c.label}</span>
        </Swatch>;
      })}
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
            {onReplace && <label className="ac-bgpick-replace" title={`Replace your picture ${i + 1}`}>
              <input type="file" accept={accept} className="ac-bgpick-file" disabled={adding} aria-label={`Replace your picture ${i + 1}`} onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onReplace(p.id, file);
              }} /><Icon name="imagePlus" size={14} />
            </label>}
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
     {value.kind === 'blur' && <div className="ac-bgpick-strength"><span>Blur strength</span><Segmented value={value.strength}
       onChange={(strength) => onPick({ kind: 'blur', strength })} label="Blur strength" options={[{ value: 'mild', label: 'Mild' }, { value: 'strong', label: 'Strong' }]} /></div>}
     {pictures === null && <p className="hint" role="status">Loading your pictures…</p>}
    </div>
  );
}
