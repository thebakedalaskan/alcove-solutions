/* Recording in the room, offline, at night: the recorder on the horizon where the sun would be. (Built in its own commit.) */
import type { ReactNode } from 'react';
import { Sky } from './Sky';

export function RecordScene({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <Sky moment="record" id="offline" className="lp-night dark" sky={<div className="lp-wrap lp-rec-up">{head}</div>}>
      {children}
    </Sky>
  );
}
