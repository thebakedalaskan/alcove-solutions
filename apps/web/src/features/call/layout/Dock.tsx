/*
 * The dock, at the foot of the call: your microphone and camera, each with its menu of devices; Share; your hand and React on a
 * wider screen; More, which holds everything else, and Board's picker or React in its place on a phone; Show everything while
 * what's open fills your window; and Leave, with Leave's question for whoever hosts. Reactions rise out of it. Turning on a device
 * that isn't working opens its menu, which says what's wrong and how to fix it (useCallControls.ts). In focus it tucks away.
 */
import type { AvatarPerson, BurstItem } from '@alcove/ui';
import { CallDock, DockButton, DockLeave, DockSeparator, DockSplit, DockWords, LeaveAsk, Popover, ReactionBurst, cn, useToast } from '@alcove/ui';
import type { CallReaction } from '@alcove/api';
import type { ReactNode, RefObject } from 'react';
import type { useFloatingWindow } from '../floating/floatingWindow';
import { stateOf } from '../media/access';
import { CamMenu, MicMenu } from '../media/DevicePickers';
import type { Devices } from '../media/devices';
import type { LocalMedia, MediaSnapshot } from '../media/media';
import type { useLeaving } from '../session/leaving';
import type { useCallControls } from '../session/useCallControls';
import { MORE_SAYS } from './More';
import type { Pop } from './pop';
import { ReactMenu } from './ReactMenu';

export function Dock({ dock, burst, tucked, phone, media, m, devices, me, micLabel, controls, busy, pop, setPop, onBackground, share, hand, react, more, floating, unread, onShowEverything, leave, asking }: {
  /** The dock's own element: what's opened from it hands focus back there, and focus keeps clear of it. */
  dock: RefObject<HTMLElement | null>;
  burst: BurstItem[];
  /** What's open fills your window: the dock tucks away until you need it. */
  tucked: boolean;
  phone: boolean;
  media: LocalMedia;
  m: MediaSnapshot;
  devices: Devices;
  me: AvatarPerson;
  /** The microphone in use, as its menu names it. */
  micLabel: string | undefined;
  controls: ReturnType<typeof useCallControls>;
  /** Leaving, or the call's over here: nothing in the dock does anything. */
  busy: boolean;
  pop: Pop;
  setPop: (pop: Pop) => void;
  /** Background's window, from the camera's menu, which closes as it opens. */
  onBackground: () => void;
  /** Share, in its place in the dock. */
  share: ReactNode;
  /** Your hand: raised or not, what its button says and its tooltip, and whether it can go up now. */
  hand: { up: boolean; label: string; tip: string; ready: boolean; set: (up: boolean) => void };
  react: (reaction: CallReaction) => void;
  /** What More holds. */
  more: ReactNode;
  floating: ReturnType<typeof useFloatingWindow>;
  /** What's new in Chat, which More counts on a phone. */
  unread: number;
  onShowEverything: () => void;
  leave: ReturnType<typeof useLeaving>;
  /** Leave's question is up over Leave. */
  asking: boolean;
}) {
  const toast = useToast();
  const moreOpen = pop === 'more' || pop === 'board' || pop === 'reactMore';
  const camLabel = devices.cam.find((d) => d.id === m.camId)?.label;
  return (
    <footer ref={dock} className="ic-dockbar">
      <ReactionBurst items={burst} />
      <CallDock tucked={tucked}>
        <DockSplit className="keep">
          <DockButton icon={m.mic ? 'mic' : 'micOff'} label={m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : m.mic ? 'Mute' : 'Unmute'} off={!m.mic} alert={!!m.access.mic.problem} disabled={controls.pending.mic || busy} aria-busy={controls.pending.mic} onClick={() => controls.mic()}
            tip={m.access.mic.problem ? `${stateOf('mic', m.access.mic.problem)}. Press to see how to fix it` : `${m.mic ? 'Mute' : 'Unmute'}${micLabel ? ` · ${micLabel}` : ''}`} />
          <MicMenu media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)}
            onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
        </DockSplit>
        <DockSplit className="keep">
          <DockButton icon={m.cam ? 'video' : 'videoOff'} label={m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} alert={!!m.access.cam.problem} disabled={controls.pending.cam || busy} aria-busy={controls.pending.cam} onClick={() => controls.cam()}
            tip={m.access.cam.problem ? `${stateOf('cam', m.access.cam.problem)}. Press to see how to fix it` : `${m.cam ? 'Turn camera off' : 'Turn camera on'}${camLabel ? ` · ${camLabel}` : ''}`} />
          <CamMenu media={media} m={m} devices={devices} me={me} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)}
            onBackground={() => { setPop(null); onBackground(); }} onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
        </DockSplit>
        {!phone && <DockSeparator />}
        {share}
        {!phone && (
          <DockButton icon="hand" label={hand.label} tip={hand.tip} on={hand.up} disabled={controls.pending.hand || !hand.ready || busy} aria-busy={controls.pending.hand} onClick={() => hand.set(!hand.up)} />
        )}
        {!phone && <ReactMenu open={pop === 'react'} onOpenChange={(o) => setPop(o ? 'react' : null)} onPick={react} />}
        <Popover open={moreOpen} onOpenChange={(o) => setPop(o ? 'more' : null)} side="top" align="center" label={pop === 'board' ? 'Open a board' : pop === 'reactMore' ? 'React' : 'More'}
          onCloseFocus={() => { const current = floating.owner.getSnapshot(); return current.pending || current.target !== null; }}
          tip={phone ? undefined : MORE_SAYS}
          className={cn(pop === 'board' ? 'bl' : 'ic-menu ic-morepop', phone && 'is-sheet')}
          anchor={<DockButton icon="more" label={!phone ? MORE_SAYS : unread ? `More: ${unread} new in Chat` : 'More: react, board, workspace, notes, chat, people'} title={undefined} data-more="" on={moreOpen} badge={phone ? unread : 0} />}>
          {more}
        </Popover>
        {!phone && <DockSeparator />}
        {tucked && <DockWords icon="shrink" className="keep" onClick={onShowEverything}>Show everything</DockWords>}
        <LeaveAsk {...leave.choices} title={leave.title} phone={phone} open={asking} onOpenChange={(o) => { if (!o) leave.stay(); }}
          anchor={<DockLeave className="keep" disabled={busy} onClick={() => leave.request('dock')}>{leave.choices.busy !== null ? 'Leaving…' : 'Leave'}</DockLeave>} />
      </CallDock>
    </footer>
  );
}
