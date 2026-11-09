/*
 * Background: what shows behind you on camera, chosen in a window of its own with your camera large beside the choices,
 * before joining (Background, beside the device pickers) and in the call (the camera's menu, or Settings › Audio and video). Picking
 * applies at once. Pictures someone adds are kept sealed in this browser for their account (backgrounds.ts); a guest has
 * blur, Alcove's pictures and the colours.
 */
import { errorMessage, type CameraBackground } from '@alcove/api';
import { BackgroundModal, BackgroundPicker, BackgroundStatus, Button, backgroundLabel, type AvatarPerson } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { q } from '~/lib/queries';
import { BACKGROUND_TYPES, MAX_BACKGROUNDS, SCENES, canKeepBackgrounds, keepPicture, removePicture, useKeptPictures } from './backgrounds';
import type { LocalMedia, MediaSnapshot } from '../media';
import { Video } from '../Video';

const ACCEPT = BACKGROUND_TYPES.join(',');

/**
 * `backTo`: where focus goes once it closes, when what opened it has gone with its menu (the call's camera menu); without
 * it, focus goes back to what had it.
 */
export function ChooseBackground({ media, m, me, open, onOpenChange, backTo }: {
  media: LocalMedia; m: MediaSnapshot; me: AvatarPerson; open: boolean; onOpenChange: (open: boolean) => void;
  backTo?: (() => HTMLElement | null) | undefined;
}) {
  const owner = useQuery(q.session()).data?.ownerId ?? null;
  const keeps = owner !== null && canKeepBackgrounds();
  const supported = m.backgroundSupport === 'supported';
  const effectOn = m.background.kind !== 'none';
  const back = backTo && (() => { const to = backTo(); to?.focus({ preventScroll: true }); return to !== null; });
  return (
    <BackgroundModal open={open} onOpenChange={onOpenChange} onCloseFocus={back} person={me}
      video={m.cam && m.camera ? <Video stream={m.camera} /> : null} preparing={m.backgroundBusy} shows={effectOn ? backgroundLabel(m.background) : null}
      status={supported && <BackgroundStatus support={m.backgroundSupport} quality={m.backgroundQuality} preparing={m.backgroundBusy} cameraOn={m.cam} effectOn={effectOn} />}
      foot={supported && keeps && 'Your pictures stay in this browser, sealed for your account.'}>
      <Choices media={media} m={m} owner={owner} keeps={keeps} />
    </BackgroundModal>
  );
}

/** The choices, read only while the window is open: the pictures kept here are opened then. */
function Choices({ media, m, owner, keeps }: { media: LocalMedia; m: MediaSnapshot; owner: string | null; keeps: boolean }) {
  const pictures = useKeptPictures(owner);
  const [adding, setAdding] = useState(false);
  /** A picture that couldn't be added, replaced or removed, in its own words, until the next choice. */
  const [problem, setProblem] = useState<string | null>(null);
  const pick = (b: CameraBackground) => { setProblem(null); void media.setBackground(b); };
  const add = async (file: File, replace?: string) => {
    if (!owner || adding) return;
    setAdding(true);
    setProblem(null);
    try {
      const kept = await keepPicture(owner, file, replace);
      await media.setBackground({ kind: 'custom', id: kept.id });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };
  const remove = async (id: string) => {
    if (!owner) return;
    setProblem(null);
    try {
      // The one showing goes: blur takes its place, so what's behind you still doesn't show.
      if (m.background.kind === 'custom' && m.background.id === id) await media.setBackground({ kind: 'blur', strength: 'strong' });
      await removePicture(owner, id);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };
  if (m.backgroundSupport !== 'supported') return (
    <div className="ac-bgpick-groups">
      <BackgroundStatus support={m.backgroundSupport} quality={m.backgroundQuality} preparing={false} cameraOn={m.cam} effectOn={m.background.kind !== 'none'} />
      {m.backgroundSupport === 'unsupported' && m.background.kind !== 'none' && <div><Button variant="secondary" size="sm" onClick={() => pick({ kind: 'none' })}>Choose Off</Button></div>}
    </div>
  );
  return (
    <BackgroundPicker value={m.background} scenes={SCENES} pictures={keeps ? pictures : []} onPick={pick}
      onAdd={keeps ? (f) => void add(f) : undefined} onReplace={keeps ? (id, f) => void add(f, id) : undefined} onRemove={(id) => void remove(id)}
      adding={adding} most={keeps ? MAX_BACKGROUNDS : undefined} accept={ACCEPT} problem={problem}
      ownNote={keeps ? undefined : owner ? 'This browser can’t keep pictures of your own.' : 'Sign in to add pictures of your own.'} />
  );
}
