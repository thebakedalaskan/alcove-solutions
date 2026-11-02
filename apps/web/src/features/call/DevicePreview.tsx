import type { Person } from '@alcove/api';
import { Avatar, Icon, cn, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LocalMedia } from './media';

/** A <video> bound to a MediaStream. */
export function StreamVideo({ stream, mirrored = false, className }: { stream: MediaStream; mirrored?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={cn('size-full object-cover', mirrored && '-scale-x-100', className)} />;
}

export const useMedia = (m: LocalMedia) => useSyncExternalStore(m.subscribe, m.getSnapshot, m.getSnapshot);

/** Self-view before joining. */
export function DevicePreview({ media, me }: { media: LocalMedia; me: Pick<Person, 'name' | 'portrait'> }) {
  const s = useMedia(media);
  const hasVideo = !!s.camera?.getVideoTracks().length && s.cam;
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-[26px] bg-[#15120F] shadow-float">
      {hasVideo && s.camera ? <StreamVideo stream={s.camera} mirrored /> : (
        <div className="absolute inset-0 grid animate-fade place-items-center"><div className="flex flex-col items-center gap-3 text-[15px] text-[#8F877C]"><Avatar person={me} size={96} ring={false} />Camera is off</div></div>
      )}
      <span className="absolute left-[18px] top-4 rounded-[9px] bg-black/40 px-[11px] py-[5px] text-[13px] font-semibold text-white backdrop-blur-md">{me.name || 'You'}</span>
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2.5 bg-gradient-to-b from-transparent to-black/45 p-[18px]">
        {([
          { on: s.mic, toggle: () => media.setMic(!s.mic), icon: s.mic ? 'mic' : 'micOff', label: s.mic ? 'Mute microphone' : 'Unmute microphone' },
          { on: s.cam, toggle: () => void media.setCam(!s.cam), icon: s.cam ? 'cam' : 'camOff', label: s.cam ? 'Turn camera off' : 'Turn camera on' }
        ] satisfies { on: boolean; toggle: () => void; icon: IconName; label: string }[]).map((b) => (
          <button key={b.label} type="button" aria-label={b.label} aria-pressed={!b.on} onClick={b.toggle}
            className={cn('grid size-[50px] place-items-center rounded-full text-white backdrop-blur-md transition-colors', b.on ? 'bg-white/[.14] hover:bg-white/25' : 'bg-rec')}>
            <Icon name={b.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Live microphone level from the analyser. */
export function MicMeter({ media, dark = false }: { media: LocalMedia; dark?: boolean }) {
  const [h, setH] = useState<number[]>(Array(7).fill(3));
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const l = media.level();
      setH((x) => x.map((_, i) => 3 + Math.round(l * (i % 3 === 1 ? 15 : 11) * (0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 120 + i))))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media]);
  return <span className="flex h-[18px] items-center gap-[3px]" aria-hidden>{h.map((v, i) => <i key={i} className={cn('w-[3px] rounded-sm transition-[height] duration-75', dark ? 'bg-live' : 'bg-ok')} style={{ height: v }} />)}</span>;
}

export function DeviceRow({ media }: { media: LocalMedia }) {
  const s = useMedia(media);
  const chip = 'inline-flex h-[38px] items-center gap-2 rounded-[11px] bg-card px-3 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)]';
  const audioLabel = media.micTrack()?.label;
  const videoLabel = s.camera?.getVideoTracks()[0]?.label;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <span className={chip}><Icon name="mic" className="size-4" />{audioLabel || 'Microphone'}<MicMeter media={media} /></span>
        <span className={chip}><Icon name="cam" className="size-4" />{videoLabel || (s.cam ? 'Camera' : 'Camera off')}</span>
      </div>
      {s.error && <p className="m-0 flex items-center gap-2 text-[13px] text-bad"><Icon name="x" className="size-4" />{s.error}</p>}
    </div>
  );
}
