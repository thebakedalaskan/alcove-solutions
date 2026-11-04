/*
 * After moving, on the device that was left: it has let go of its microphone and camera and left the call, and says
 * so. If the move didn't finish after letting go, it says that instead, with the reference to quote, and the way back.
 */
import type { MoveDevice, MoveProblem } from '@alcove/api';
import { Button, Icon, Logo } from '@alcove/ui';
import { yourDevice } from './device';

export function Moved({ to, problem, signedIn, onAgain, onHome }: {
  to: MoveDevice | null; problem: MoveProblem | null; signedIn: boolean; onAgain: () => void; onHome: () => void;
}) {
  return (
    <div className="stage ac-stage">
      <div className="stg">
        <header className="stg-top"><div /><div className="stg-mid"><Logo /></div><div className="stg-right" /></header>
        <main className="mv-done">
          <span className={problem ? 'mv-ic is-caution' : 'mv-ic'}><Icon name={problem ? 'x' : 'swap'} size={28} /></span>
          {problem ? (
            <>
              <h1>The move didn’t finish</h1>
              <p>This device let go of its microphone and camera, so it isn’t in the call now. Join again here, or make a new code from a device that’s still in the call.</p>
              <p className="ac-mono mv-ref">{problem.message}{problem.requestId ? ` · Reference ${problem.requestId}` : ''}</p>
            </>
          ) : (
            <>
              <h1>You’re in the call on {yourDevice(to)} now</h1>
              <p>This device let go of its microphone and camera and left the call. Everything carries on there.</p>
            </>
          )}
          <div className="acts">
            {signedIn && <Button variant={problem ? 'secondary' : 'primary'} onClick={onHome}>Go to Home</Button>}
            <Button variant={problem ? 'primary' : signedIn ? 'quiet' : 'secondary'} iconRight="right" onClick={onAgain}>Join again here</Button>
          </div>
        </main>
      </div>
    </div>
  );
}
