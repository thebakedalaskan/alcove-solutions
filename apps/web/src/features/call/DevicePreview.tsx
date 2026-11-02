import { CameraScene, Icon, cn, type AvatarPerson, type IconName } from '@alcove/ui';
import { useEffect, useState } from 'react';

/** Self-view before joining. Real builds swap CameraScene for a <video> bound to getUserMedia. */
export function DevicePreview({ me, mic, cam, onMic, onCam }: { me: AvatarPerson; mic: boolean; cam: boolean; onMic: () => void; onCam: () => void }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-[26px] bg-[#15120F] shadow-float">
      {cam ? <CameraScene person={me} /> : <div className="absolute inset-0 grid animate-fade place-items-center text-[15px] text-[#8F877C]">Camera is off</div>}
      <span className="absolute left-[18px] top-4 rounded-[9px] bg-black/40 px-[11px] py-[5px] text-[13px] font-semibold text-white backdrop-blur-md">{me.name || 'You'}</span>
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2.5 bg-gradient-to-b from-transparent to-black/45 p-[18px]">
        {([{ on: mic, toggle: onMic, icon: mic ? 'mic' : 'micOff', label: mic ? 'Mute microphone' : 'Unmute microphone' }, { on: cam, toggle: onCam, icon: cam ? 'cam' : 'camOff', label: cam ? 'Turn camera off' : 'Turn camera on' }] satisfies { on: boolean; toggle: () => void; icon: IconName; label: string }[]).map((b) => (
          <button key={b.label} type="button" aria-label={b.label} aria-pressed={!b.on} onClick={b.toggle}
            className={cn('grid size-[50px] place-items-center rounded-full text-white backdrop-blur-md transition-colors', b.on ? 'bg-white/[.14] hover:bg-white/25' : 'bg-rec')}>
            <Icon name={b.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function MicMeter({ active }: { active: boolean }) {
  const [h, setH] = useState<number[]>(Array(7).fill(3));
  useEffect(() => {
    if (!active) { setH(Array(7).fill(3)); return; }
    const id = setInterval(() => setH((x) => x.map((_, i) => 3 + Math.round(Math.random() * (i % 3 === 1 ? 14 : 10)))), 140);
    return () => clearInterval(id);
  }, [active]);
  return <span className="flex h-[18px] items-center gap-[3px]" aria-hidden>{h.map((v, i) => <i key={i} className="w-[3px] rounded-sm bg-ok transition-[height] duration-100" style={{ height: v }} />)}</span>;
}

export function DeviceRow({ mic, onTest }: { mic: boolean; onTest: () => void }) {
  const chip = 'inline-flex h-[38px] items-center gap-2 rounded-[11px] bg-card px-3 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)]';
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <span className={chip}><Icon name="mic" className="size-4" />MacBook Pro Microphone<MicMeter active={mic} /></span>
      <span className={chip}><Icon name="cam" className="size-4" />FaceTime HD Camera</span>
      <button type="button" onClick={onTest} className={cn(chip, 'hover:text-ink')}><Icon name="speaker" className="size-4" />Test speakers</button>
    </div>
  );
}
