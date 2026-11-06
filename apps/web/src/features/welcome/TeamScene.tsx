/* Find a time: the team on the horizon with the sun low behind them, and their week on the water. (Built in its own commit.) */
import type { ReactNode } from 'react';
import { Sky } from './Sky';

export function TeamScene({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <Sky moment="team" id="time" className="lp-team" sky={<div className="lp-wrap lp-team-up">{head}</div>}>
      <div className="lp-wrap lp-team-water" />
      {children}
    </Sky>
  );
}
