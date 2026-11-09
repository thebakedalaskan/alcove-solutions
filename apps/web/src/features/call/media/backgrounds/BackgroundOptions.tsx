/*
 * Choosing what shows behind you on camera, in the camera's menu and before joining. Pictures someone adds are kept
 * sealed in this browser for their account (backgrounds.ts); a guest has Alcove's pictures and blur.
 */
import { errorMessage, type CameraBackground } from '@alcove/api';
import { BackgroundPicker, BackgroundStatus, Button, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { q } from '~/lib/queries';
import { BACKGROUND_TYPES, MAX_BACKGROUNDS, SCENES, canKeepBackgrounds, keepPicture, removePicture, useKeptPictures } from './backgrounds';
import type { LocalMedia, MediaSnapshot } from '../media';

const ACCEPT = BACKGROUND_TYPES.join(',');

export function BackgroundOptions({ media, m }: { media: LocalMedia; m: MediaSnapshot }) {
  const owner = useQuery(q.session()).data?.ownerId ?? null;
  const pictures = useKeptPictures(owner);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const keeps = owner !== null && canKeepBackgrounds();
  const pick = (b: CameraBackground) => { void media.setBackground(b); };
  const add = async (file: File, replace?: string) => {
    if (!owner || adding) return;
    setAdding(true);
    try {
      const kept = await keepPicture(owner, file, replace);
      await media.setBackground({ kind: 'custom', id: kept.id });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    } finally {
      setAdding(false);
    }
  };
  const remove = async (id: string) => {
    if (!owner) return;
    try {
      // The one showing goes: blur takes its place, so what's behind you still doesn't show.
      if (m.background.kind === 'custom' && m.background.id === id) await media.setBackground({ kind: 'blur', strength: 'strong' });
      await removePicture(owner, id);
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    }
  };
  const status = <BackgroundStatus support={m.backgroundSupport} quality={m.backgroundQuality} preparing={m.backgroundBusy} cameraOn={m.cam} effectOn={m.background.kind !== 'none'} />;
  if (m.backgroundSupport !== 'supported') return <>
    {status}
    {m.backgroundSupport === 'unsupported' && <Button variant="secondary" size="sm" onClick={() => pick({ kind: 'none' })}>Choose Off</Button>}
  </>;
  return (
    <>
      <BackgroundPicker value={m.background} scenes={SCENES} pictures={keeps ? pictures : []} onPick={pick}
        onAdd={keeps ? (f) => void add(f) : undefined} onRemove={(id) => void remove(id)} adding={adding}
        onReplace={keeps ? (id, f) => void add(f, id) : undefined}
        full={(pictures?.length ?? 0) >= MAX_BACKGROUNDS} accept={ACCEPT} />
      {status}
      <p className="hint">{keeps ? 'Pictures you add stay in this browser, sealed for your account.' : owner ? 'This browser can’t keep pictures of your own.' : 'Sign in to add pictures of your own.'}</p>
      {keeps && <p className="hint">JPEG, PNG or WebP · Up to 20 MB · {MAX_BACKGROUNDS} pictures</p>}
    </>
  );
}
