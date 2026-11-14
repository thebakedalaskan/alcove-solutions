/*
 * The camera, microphone and device pickers before joining, the same for the organizer and everyone else: what starts
 * them, the self-view with its two switches, and under it a picker for each device and Background.
 */
import type { Person } from '@alcove/api';
import { Avatar, CallDock, DockButton, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PrejoinDevices } from '~/features/call/media/DevicePickers';
import { Video, useLevels } from '~/features/call/media/Video';
import { useDevices } from '~/features/call/media/devices';
import { LocalMedia } from '~/features/call/media/media';
import { useLive } from '~/lib/live';
import { accountQueries } from '~/features/account/queries';
import { sessions } from '~/features/call/session/handoff';

const shape = (l: number, i: number) => 18 + Math.min(1, l * (0.75 + Math.random() * 0.5)) * (i === 2 ? 82 : 62);

/**
 * They start once there's a call to join (`go`), and stop if it goes (it ended, or the link leads nowhere): the camera is
 * only ever on where it can be seen. `muted`: everyone joins this call with their microphone and camera off.
 */
export function usePrejoinMedia(go: boolean, muted: boolean) {
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const levels = useLevels(media, 5, m.mic && !!m.camera, shape);
  // Named once the browser has been allowed the devices, so read again when they start.
  const devices = useDevices(m.camera);
  // Whose pictures can show behind the camera: a guest's none.
  const session = useQuery(accountQueries.session());
  const owner = session.isPending ? undefined : session.data?.ownerId ?? null;
  useEffect(() => { if (owner !== undefined) media.setAccount(owner); }, [media, owner]);
  useEffect(() => {
    sessions.media = media;
    // Leaving without joining lets go of the camera and microphone.
    return () => { if (!sessions.call) { media.stop(); sessions.media = null; } };
  }, [media]);
  useEffect(() => {
    if (go && !media.started) void media.start({ mic: !muted, cam: !muted });
    else if (!go && media.started && !sessions.call) media.stop();
  }, [go, muted, media]);
  return { media, m, levels, devices };
}
export type Prejoining = ReturnType<typeof usePrejoinMedia>;

/** The self-view, its two switches, the device pickers and Background. */
export function PrejoinMain({ media: { media, m, levels, devices }, me, className }: { media: Prejoining; me: Person; className?: string | undefined }) {
  return (
    <div className={cn('pj-main', className)}>
      <div className={cn('feed', !m.mic && 'muted')}>
        {m.cam && m.camera ? <Video stream={m.camera} /> : <div className="feed-off"><Avatar person={me} size={120} /><span>Your camera is off</span></div>}
        <span className="lvl" aria-hidden="true">{levels.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
        <CallDock className="ctrls" label="Microphone and camera">
          <DockButton icon={m.mic ? 'mic' : 'micOff'} off={!m.mic} alert={!!m.access.mic.problem} label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => void media.setMic(!m.mic)} />
          <DockButton icon={m.cam ? 'video' : 'videoOff'} off={!m.cam} alert={!!m.access.cam.problem} label={m.cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.setCam(!m.cam)} />
        </CallDock>
      </div>
      <PrejoinDevices media={media} m={m} devices={devices} me={me} />
    </div>
  );
}

/** Said beside what's captured when a call starts everyone off. */
export const JoinMuted = () => <p className="pj-ask">Everyone joins with their microphone and camera off.</p>;
