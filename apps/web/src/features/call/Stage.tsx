import type { CallParticipant, CallState } from '@alcove/api';
import { Avatar, Chip, Icon, cn } from '@alcove/ui';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { StreamVideo, useMedia } from './DevicePreview';
import type { LocalMedia } from './media';

/** True while the microphone is picking up speech. */
function useSpeaking(media: LocalMedia): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 120) { last = t; setOn(media.level() > 0.08); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media]);
  return on;
}

function MyTile({ p, media, compact }: { p: CallParticipant; media: LocalMedia; compact: boolean }) {
  const m = useMedia(media);
  const speaking = useSpeaking(media);
  const video = m.cam && m.camera?.getVideoTracks().length ? m.camera : null;
  return (
    <div className={cn('relative size-full min-h-0 overflow-hidden rounded-[18px] bg-[#1B1814] transition-shadow duration-200', speaking && 'shadow-[0_0_0_2px_#F5F1EA]')}>
      {video ? <StreamVideo stream={video} mirrored /> : (
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn('rounded-full transition-shadow duration-200', speaking && 'shadow-[0_0_0_5px_rgba(245,241,234,.2),0_0_0_14px_rgba(245,241,234,.06)]')}><Avatar person={p.person} size={compact ? 64 : 104} ring={false} /></span>
        </div>
      )}
      {p.hand && <span className="absolute left-3 top-3 grid size-8 animate-pop place-items-center rounded-full bg-lamp text-[#2A1700]"><Icon name="hand" className="size-[18px]" /></span>}
      <span className="absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1 text-[13px] font-semibold text-white backdrop-blur-md">
        {!m.mic && <Icon name="micOff" className="size-3.5 text-rec-ink" />}You
      </span>
    </div>
  );
}

export function Stage({ state, media, onStopShare }: { state: CallState; media: LocalMedia; onStopShare: () => void }) {
  const m = useMedia(media);
  const me = state.participants.find((p) => p.isMe);
  if (!me) return null;
  if (m.screen) {
    return (
      <div className="relative grid min-h-0 grid-cols-[minmax(0,1fr)_220px] gap-2.5">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="relative min-h-0 overflow-hidden rounded-[18px] bg-black">
          <StreamVideo stream={m.screen} className="object-contain" />
          <div className="absolute left-4 top-4 z-[2] flex items-center gap-2">
            <Chip tone="stage" icon="screen" className="bg-black/60">You’re presenting</Chip>
            <button type="button" onClick={onStopShare} className="h-[34px] rounded-[10px] bg-rec px-3 text-[13.5px] font-semibold text-white">Stop presenting</button>
          </div>
        </motion.div>
        <div className="aspect-video self-start"><MyTile p={me} media={media} compact /></div>
      </div>
    );
  }
  return (
    <div className="relative grid min-h-0 place-items-center">
      <div className="aspect-video max-h-full w-[min(100%,calc((100vh-190px)*16/9))]"><MyTile p={me} media={media} compact={false} /></div>
    </div>
  );
}
