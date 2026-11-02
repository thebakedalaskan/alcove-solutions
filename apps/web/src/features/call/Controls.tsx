import type { CallSession, CallState, NotesKeep } from '@alcove/api';
import { selfIn } from '~/lib/live';
import { Button, Icon, Popover, Segmented, Tooltip, cn, type IconName } from '@alcove/ui';
import { forwardRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Panel } from './SidePanel';

const Round = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; state?: 'off' | 'on' | 'sel' | 'notes' | 'notes-paused' | undefined; badge?: number | undefined }>(
  function Round({ icon, label, state, badge, className, ...rest }, ref) {
    return (
      <button ref={ref} type="button" aria-label={label} {...rest}
        className={cn('relative grid size-[52px] place-items-center rounded-full transition-[background-color,transform] duration-200 active:scale-[.94]',
          state === 'off' ? 'bg-rec text-white' : state === 'on' || state === 'notes' || state === 'notes-paused' ? 'bg-stage-ink text-[#17140F]' : state === 'sel' ? 'bg-[#3A342D] text-stage-ink' : 'bg-stage-3 text-stage-ink hover:bg-stage-4', className)}>
        <Icon name={icon} />
        {(state === 'notes' || state === 'notes-paused') && <i className={cn('absolute right-1.5 top-1.5 size-[9px] rounded-full shadow-[0_0_0_2px_#F2EEE7]', state === 'notes' ? 'animate-recpulse bg-rec' : 'bg-stage-dim')} />}
        {!!badge && <span className="absolute -right-0.5 -top-0.5 h-[18px] min-w-[18px] animate-pop rounded-full bg-rec px-[5px] text-center text-[11px] font-bold leading-[18px] text-white">{badge}</span>}
      </button>
    );
  });

export function NotesButton({ state, session }: { state: CallState; session: CallSession }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<NotesKeep>('full');
  const st = state.notes.status;
  const label = st === 'off' ? 'Start notes' : st === 'paused' ? 'Notes paused' : 'Notes are on';
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={<Round icon="notes" label={label} state={st === 'on' ? 'notes' : st === 'paused' ? 'notes-paused' : undefined} />}>
      {!state.canControlNotes ? (
        <><b className="text-[15.5px]">{st === 'off' ? 'Notes are off' : label}</b><p className="m-0 text-[13.5px] text-[#BEB5A9]">Only the host can change notes. Everyone sees a notice whenever they start, pause or stop.</p></>
      ) : st === 'off' ? (
        <>
          <b className="text-[15.5px]">Start notes?</b>
          <p className="m-0 text-[13.5px] text-[#BEB5A9]">Everyone in the call sees that notes are on. Alcove transcribes from now, not what was said before.</p>
          <Segmented tone="stage" label="Keep" value={mode} onChange={setMode} options={[{ value: 'full', label: 'Notes + transcript' }, { value: 'notes', label: 'Notes only' }]} />
          <div className="flex justify-end gap-2"><Button size="sm" variant="glass" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" variant="light" onClick={() => { session.startNotes(mode); setOpen(false); }}>Start notes</Button></div>
        </>
      ) : (
        <>
          <b className="text-[15.5px]">{st === 'paused' ? 'Notes are paused' : 'Notes are on'}</b>
          <p className="m-0 text-[13.5px] text-[#BEB5A9]">{st === 'paused' ? 'Nothing is transcribed while paused. Everyone sees that notes are paused.' : `${state.notes.mode === 'full' ? 'Notes and the transcript' : 'Notes'} go to ${state.notes.audience === 'host' ? 'you only' : 'everyone in the call'} when it ends. Pause for anything that shouldn’t be in them.`}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="glass" onClick={() => { session.stopNotes(); setOpen(false); }}>Stop notes</Button>
            <Button size="sm" variant="light" onClick={() => { (st === 'paused' ? session.resumeNotes : session.pauseNotes)(); setOpen(false); }}>{st === 'paused' ? 'Resume' : 'Pause'}</Button>
          </div>
        </>
      )}
    </Popover>
  );
}

export function Controls({ state, session, panel, setPanel, unread, onLeave, leaving }: { state: CallState; session: CallSession; panel: Panel | null; setPanel: (p: Panel | null) => void; unread: number; onLeave: () => void; leaving: boolean }) {
  const me = selfIn(state);
  if (!me) return null;
  const sharing = !!state.sharing;
  const tip = (label: string, el: React.ReactNode) => <Tooltip label={label}>{el}</Tooltip>;
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);
  return (
    <div className="relative flex items-center justify-center gap-2.5 px-5 pb-5 pt-4">
      <span className="absolute left-5 font-mono text-[13px] text-stage-dim max-[900px]:hidden">{state.code}</span>
      {tip(me.mic ? 'Mute (M)' : 'Unmute (M)', <Round icon={me.mic ? 'mic' : 'micOff'} label={me.mic ? 'Mute' : 'Unmute'} state={me.mic ? undefined : 'off'} onClick={() => session.setMic(!me.mic)} />)}
      {tip(me.cam ? 'Camera off (V)' : 'Camera on (V)', <Round icon={me.cam ? 'cam' : 'camOff'} label={me.cam ? 'Turn camera off' : 'Turn camera on'} state={me.cam ? undefined : 'off'} onClick={() => session.setCam(!me.cam)} />)}
      {tip(sharing ? 'Stop presenting' : 'Present your screen', <Round icon="screen" label={sharing ? 'Stop presenting' : 'Present your screen'} state={sharing ? 'on' : undefined} onClick={() => session.setSharing(!sharing)} />)}
      <NotesButton state={state} session={session} />
      {tip(me.hand ? 'Lower hand' : 'Raise hand', <Round icon="hand" label={me.hand ? 'Lower hand' : 'Raise hand'} state={me.hand ? 'on' : undefined} onClick={() => session.setHand(!me.hand)} />)}
      <button type="button" onClick={onLeave} disabled={leaving} className="ml-2 inline-flex h-[52px] items-center gap-2 rounded-[26px] bg-rec px-[22px] font-semibold text-white transition-transform active:scale-[.97] disabled:opacity-70">
        <Icon name="leave" />Leave
      </button>
      <div className="absolute right-5 flex gap-2">
        {tip('Notes', <Round icon="notes" label="Notes panel" state={panel === 'notes' ? 'sel' : undefined} onClick={() => toggle('notes')} />)}
        {tip('People', <Round icon="users" label="People" state={panel === 'people' ? 'sel' : undefined} onClick={() => toggle('people')} />)}
        {tip('Chat (C)', <Round icon="chat" label="Chat" state={panel === 'chat' ? 'sel' : undefined} badge={panel === 'chat' ? 0 : unread} onClick={() => toggle('chat')} />)}
      </div>
    </div>
  );
}
