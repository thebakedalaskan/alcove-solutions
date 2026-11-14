/*
 * What shows behind someone on camera (nothing, blur, Alcove's pictures, a colour, or their own) and the window it's
 * chosen in: a big live preview of them beside the choices, so each one is seen on them before anyone else sees it.
 */
import { BACKGROUND_COLORS, type BackgroundColor, type BackgroundScene, type BlurStrength, type CameraBackground } from '@alcove/api';
import { useId, type ChangeEvent, type ReactNode } from 'react';
import balloons from '../backgrounds/balloons.jpg';
import balloonsThumb from '../backgrounds/balloons-thumb.jpg';
import beach from '../backgrounds/beach.jpg';
import beachThumb from '../backgrounds/beach-thumb.jpg';
import office from '../backgrounds/office.jpg';
import officeThumb from '../backgrounds/office-thumb.jpg';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Modal } from '../foundation/overlay';
import { Avatar, type AvatarPerson } from '../foundation/people';
import { Button, IconButton, Spinner } from '../foundation/primitives';

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

/** What shows behind someone, in a word or two: Off, Light blur, Beach, Slate, Your picture. */
export function backgroundLabel(b: CameraBackground): string {
  switch (b.kind) {
    case 'none': return 'Off';
    case 'blur': return b.strength === 'mild' ? 'Light blur' : 'Strong blur';
    case 'scene': return SCENE_PICTURES[b.id].label;
    case 'color': return CAMERA_COLORS[b.id].label;
    case 'custom': return 'Your picture';
  }
}

/** Live support and processing feedback, under the preview. */
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
const blurOf = (b: CameraBackground): BlurStrength | null => (b.kind === 'blur' ? b.strength : null);

function Choice({ on, label, onPick, children }: { on: boolean; label: string; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn('ac-bgpick-opt', on && 'is-on')} aria-pressed={on} aria-label={label} title={label} onClick={onPick}>
      {children}
    </button>
  );
}

/** A labelled group of choices, four to a row, with anything it has to say under them. */
function Group({ label, children, foot }: { label: string; children?: ReactNode; foot?: ReactNode }) {
  const id = useId();
  return (
    <div className="ac-bgpick-group" role="group" aria-labelledby={id}>
      <h3 id={id} className="ac-bgpick-h">{label}</h3>
      {children && <div className="ac-bgpick">{children}</div>}
      {foot}
    </div>
  );
}

/**
 * The background choices, in groups: Blur (Off, Light, Strong), Alcove's Pictures (`scenes`), Colours, and Yours (the
 * person's own `pictures`, null while they're read, each with Replace and Remove, then Add). Without `onAdd` (a guest, or a
 * browser that can't keep them) there's no adding, and `ownNote` says why. `most`: how many pictures someone can keep, said
 * in place of Add once there are that many. A picture that couldn't be added is said in `problem`, in its own words.
 */
export function BackgroundPicker({ value, scenes, pictures, onPick, onAdd, onRemove, onReplace, adding = false, most, accept, ownNote, problem }: {
  value: CameraBackground;
  scenes: readonly { id: BackgroundScene; label: string }[];
  pictures: readonly PickerPicture[] | null;
  onPick: (b: CameraBackground) => void;
  onAdd?: ((file: File) => void) | undefined;
  onRemove: (id: string) => void;
  onReplace?: ((id: string, file: File) => void) | undefined;
  /** A picture is being added. */
  adding?: boolean | undefined;
  most?: number | undefined;
  /** The picture types `onAdd` takes, for the file picker. */
  accept: string;
  ownNote?: string | undefined;
  problem?: string | null | undefined;
}) {
  const id = useId();
  const full = most !== undefined && (pictures?.length ?? 0) >= most;
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && onAdd) onAdd(file);
  };
  const own = (pictures?.length ?? 0) > 0 || (onAdd !== undefined && !full);
  return (
    <div className="ac-bgpick-groups">
      <Group label="Blur">
        <Choice on={value.kind === 'none'} label="Off" onPick={() => onPick({ kind: 'none' })}>
          <Icon name="circleOff" size={18} /><span>Off</span>
        </Choice>
        <Choice on={blurOf(value) === 'mild'} label="Light blur" onPick={() => onPick({ kind: 'blur', strength: 'mild' })}>
          <span className="ac-bgpick-blur is-light" aria-hidden="true" /><Icon name="droplet" size={18} /><span>Light</span>
        </Choice>
        <Choice on={blurOf(value) === 'strong'} label="Strong blur" onPick={() => onPick({ kind: 'blur', strength: 'strong' })}>
          <span className="ac-bgpick-blur" aria-hidden="true" /><Icon name="droplets" size={18} /><span>Strong</span>
        </Choice>
      </Group>
      <Group label="Pictures">
        {scenes.map((s) => {
          const b: CameraBackground = { kind: 'scene', id: s.id };
          return <Choice key={s.id} on={same(value, b)} label={s.label} onPick={() => onPick(b)}><img src={SCENE_PICTURES[s.id].thumb} alt="" draggable={false} /></Choice>;
        })}
      </Group>
      <Group label="Colours">
        {BACKGROUND_COLORS.map((c) => (
          <Choice key={c} on={value.kind === 'color' && value.id === c} label={`${CAMERA_COLORS[c].label} background`} onPick={() => onPick({ kind: 'color', id: c })}>
            <span className="ac-bgpick-color" style={{ background: `rgb(${CAMERA_COLORS[c].rgb.join(' ')})` }} aria-hidden="true" />
          </Choice>
        ))}
      </Group>
      <Group label="Yours" foot={<>
        {pictures === null && <p className="ac-bgpick-note" role="status">Loading your pictures…</p>}
        {ownNote && <p className="ac-bgpick-note">{ownNote}</p>}
        {full && <p className="ac-bgpick-note">You can keep {most} pictures. Remove one to add another.</p>}
        {problem && <p className="ac-bgpick-note is-problem" role="alert">{problem}</p>}
      </>}>
        {own && <>
          {pictures?.map((p, i) => {
            const b: CameraBackground = { kind: 'custom', id: p.id };
            return (
              <div key={p.id} className="ac-bgpick-cell">
                <Choice on={same(value, b)} label={`Your picture ${i + 1}`} onPick={() => onPick(b)}>
                  <img src={p.src} alt="" draggable={false} />
                </Choice>
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
            <label htmlFor={id} className={cn('ac-bgpick-opt is-add', adding && 'is-busy')} title="Add a picture">
              <input id={id} type="file" accept={accept} className="ac-bgpick-file" disabled={adding} aria-label="Add a picture" onChange={pick} />
              {adding ? <Spinner /> : <Icon name="imagePlus" size={18} />}<span>{adding ? 'Adding…' : 'Add'}</span>
            </label>
          )}
        </>}
      </Group>
    </div>
  );
}

/**
 * Background, in a window of its own: a big live preview on the left (`video`, your camera with the background drawn, or
 * your arch while it's off) with what shows behind you named on it, and the choices on the right. Picking applies at once;
 * Done or Escape closes, and focus starts on the choice in use. On a phone the preview sits on top and the choices scroll
 * under it. `status` sits under the preview (BackgroundStatus); `foot` beside Done says where your own pictures are kept.
 */
export function BackgroundModal({ open, onOpenChange, video, person, shows, preparing = false, status, foot, onCloseFocus, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: ReactNode;
  person: AvatarPerson;
  /** What shows behind you now ("Beach"); nothing with no background. */
  shows?: string | null | undefined;
  /** The background is being got ready, and the camera stays covered meanwhile. */
  preparing?: boolean | undefined;
  status?: ReactNode;
  foot?: ReactNode;
  onCloseFocus?: (() => boolean) | undefined;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Background" className="ac-bgm" focusOn=".ac-bgpick-opt.is-on" onCloseFocus={onCloseFocus}>
      <div className="ac-bgm-h">
        <h2 className="ac-title">Background</h2>
        <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} />
      </div>
      <div className="ac-bgm-body">
        <div className="ac-bgm-look">
          <div className="ac-bgm-prev">
            {video ?? <div className="ac-bgm-off"><Avatar person={person} size={88} /><span>Your camera is off</span></div>}
            {preparing && <div className="ac-bgm-busy"><Spinner /></div>}
            {shows && <span className="ac-bgm-shows"><Icon name="image" size={14} />{shows}</span>}
          </div>
          {status}
        </div>
        <div className="ac-bgm-choices">{children}</div>
      </div>
      <div className="ac-bgm-f">
        {foot && <p className="ac-bgm-note"><Icon name="lock" size={13} />{foot}</p>}
        <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
      </div>
    </Modal>
  );
}
