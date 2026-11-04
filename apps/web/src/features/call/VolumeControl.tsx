/* How loud one person is for you, from their tile's menu and from People. Only your own playback changes. */
import { IconButton, Scope, Slider } from '@alcove/ui';
import { useRef } from 'react';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A slider and a quick mute for one person, for you alone. Unmuting goes back to the level they had. */
export function VolumeControl({ name, level, onChange }: { name: string; level: number; onChange: (level: number) => void }) {
  const last = useRef(level > 0 ? level : 1);
  if (level > 0) last.current = level;
  const muted = level === 0;
  return (
    <div className="ic-vol">
      <div className="ic-vol-h"><span>Volume for you</span><Scope>Only you</Scope></div>
      <div className="ic-vol-row">
        <IconButton icon={muted ? 'speakerOff' : level < 0.5 ? 'speakerLow' : 'speaker'} size={17} on={muted}
          label={muted ? `Unmute ${name} for you` : `Mute ${name} for you`} onClick={() => onChange(muted ? last.current : 0)} />
        <Slider value={level} step={0.05} label={`How loud ${name} is for you`} valueText={muted ? 'Muted for you' : pct(level)} onChange={onChange} />
        <span className="n">{muted ? 'Off' : pct(level)}</span>
      </div>
    </div>
  );
}

/** How a level reads beside someone's name: nothing at full volume. */
export function volumeTag(level: number): string | null {
  if (level >= 1) return null;
  return level === 0 ? 'Muted for you' : `${pct(level)} for you`;
}
