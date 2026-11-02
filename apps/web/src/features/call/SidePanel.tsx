import { clock, type CallState, type CallSession } from '@alcove/api';
import { Avatar, Icon, IconButton, cn } from '@alcove/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export type Panel = 'notes' | 'people' | 'chat';

function Frame({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <motion.aside initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="flex w-[360px] min-h-0 flex-col overflow-hidden rounded-[20px] bg-stage-2 max-[1000px]:hidden">
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4"><b className="text-[15.5px]">{title}</b><IconButton tone="stage" icon="x" label="Close" onClick={onClose} /></div>
      {children}
      {footer && <div className="flex flex-col gap-2.5 border-t border-[#24211D] px-4 pb-4 pt-3">{footer}</div>}
    </motion.aside>
  );
}
const Fine = ({ children }: { children: React.ReactNode }) => <span className="flex items-start gap-1.5 text-[13px] text-stage-dim"><Icon name="lock" className="mt-0.5 size-3.5" />{children}</span>;

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [dep]);
  return ref;
}

export function NotesPanel({ state, onClose, onStart }: { state: CallState; onClose: () => void; onStart: () => void }) {
  const [tab, setTab] = useState<'live' | 'sofar'>('live');
  const ref = useStickToBottom(state.transcript.length + tab);
  const on = state.notes.status !== 'off';
  const audience = state.notes.audience === 'host' ? 'the host only' : 'everyone in the call';
  return (
    <Frame title="Notes" onClose={onClose} footer={on && <Fine>{state.notes.mode === 'notes' ? 'Used to write the notes, then deleted.' : 'Kept with the notes.'} Notes go to {audience}.</Fine>}>
      {on && (
        <div className="flex gap-1 px-3 pb-2.5">
          {([['live', state.notes.mode === 'full' ? 'Transcript' : 'Live'], ['sofar', 'Notes so far']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setTab(v)} className={cn('h-[30px] rounded-lg px-[11px] text-[13px] font-semibold', tab === v ? 'bg-[#2A2621] text-stage-ink' : 'text-stage-mute')}>{l}</button>
          ))}
        </div>
      )}
      <div ref={ref} className="flex flex-1 flex-col gap-3.5 overflow-auto px-4 pb-4 pt-1">
        {!on ? (
          <div className="my-auto flex flex-col items-center gap-2 px-2 py-6 text-center text-[#BEB5A9]">
            <Icon name="notes" className="size-7 text-stage-dim" /><b className="text-base text-stage-ink">Notes are off</b>
            <p className="m-0 mb-1.5 text-[13.5px]">Start notes and Alcove transcribes from that moment on, not before. Everyone sees a notice.</p>
            {state.canControlNotes ? <button type="button" onClick={onStart} className="h-[34px] rounded-[10px] bg-stage-ink px-3 text-[13.5px] font-semibold text-[#17140F]">Start notes</button> : <span className="text-[13px]">Only the host can start notes.</span>}
            {state.notes.everOn && <span className="text-[13px]">Notes so far are kept.</span>}
          </div>
        ) : tab === 'live' ? (
          state.transcript.length === 0 ? <div className="flex items-center gap-2.5 py-2 text-[13.5px] text-stage-dim"><Icon name="wave" className="size-4 animate-recpulse text-live" />Listening…</div>
            : state.transcript.map((l) => (
              <motion.div key={l.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className={cn(l.kind === 'screen' && 'rounded-xl bg-[#211E1A] px-3 py-2.5')}>
                {l.kind === 'screen' ? (
                  <><b className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#D9D2C7]"><Icon name="screen" className="size-3.5" />On screen<small className="font-mono font-medium text-stage-dim">{clock(l.at)}</small></b><p className="m-0 mt-0.5 text-[14.5px] text-[#D9D2C7]">{l.title} — {l.text}</p></>
                ) : (
                  <><b className="text-[12.5px] font-semibold text-[#D9D2C7]">{l.speaker.name}<small className="ml-1.5 font-mono font-medium text-stage-dim">{clock(l.at)}</small></b><p className="m-0 mt-0.5 text-[14.5px] leading-[1.45] text-stage-ink">{l.text}</p></>
                )}
              </motion.div>
            ))
        ) : (
          <>
            <Sec title="Summary so far"><p className="m-0 text-sm leading-normal text-[#BEB5A9]">{state.live.summary ?? 'Alcove writes a running summary once there’s enough to go on.'}</p></Sec>
            <Sec title="Decisions">{state.live.decisions.length ? state.live.decisions.map((d) => <Item key={d} icon="check">{d}</Item>) : <None />}</Sec>
            <Sec title="Action items">{state.live.actions.length ? state.live.actions.map((a) => <Item key={a.id} icon="flag">{a.text}</Item>) : <None />}</Sec>
          </>
        )}
      </div>
    </Frame>
  );
}
const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => <div><h4 className="mb-2 mt-1 text-xs font-bold tracking-[.02em] text-stage-dim">{title}</h4>{children}</div>;
const Item = ({ icon, children }: { icon: 'check' | 'flag'; children: React.ReactNode }) => <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2.5 py-1.5 text-[14.5px]"><Icon name={icon} className="mt-0.5 size-4 text-live" />{children}</motion.div>;
const None = () => <p className="m-0 text-sm text-stage-dim">None yet</p>;

export function PeoplePanel({ state, onClose }: { state: CallState; onClose: () => void }) {
  const on = state.notes.status !== 'off';
  return (
    <Frame title={`People · ${state.participants.length}`} onClose={onClose} footer={<span className="text-[13px] text-stage-dim">{on ? `Everyone here can see that notes are on. Notes go to ${state.notes.audience === 'host' ? 'the host only' : 'everyone in the call'}.` : 'Notes are off for this call.'}</span>}>
      <div className="flex flex-1 flex-col gap-1 overflow-auto px-4 pb-4">
        {state.participants.map((p) => (
          <motion.div layout key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 py-1.5">
            <Avatar person={p.person} size={32} ring={false} />
            <span><b className="block text-sm">{p.person.name}{p.isMe && ' (you)'}</b><span className="text-xs text-stage-dim">{[p.isHost && 'Host', p.isGuest && 'Guest', p.hand && 'Hand raised'].filter(Boolean).join(' · ')}</span></span>
            <Icon name={p.mic ? 'mic' : 'micOff'} className={cn('size-[17px]', p.mic ? 'text-stage-dim' : 'text-rec-ink')} />
          </motion.div>
        ))}
      </div>
    </Frame>
  );
}

export function ChatPanel({ state, session, onClose }: { state: CallState; session: CallSession; onClose: () => void }) {
  const [text, setText] = useState('');
  const ref = useStickToBottom(state.chat.length);
  const send = () => { if (!text.trim()) return; session.sendChat(text); setText(''); };
  return (
    <Frame title="Chat" onClose={onClose} footer={<>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 rounded-xl bg-stage-3 py-1 pl-3 pr-1">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" aria-label="Chat message" className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-stage-ink outline-none placeholder:text-stage-dim" />
        <IconButton tone="stage" icon="send" label="Send" type="submit" />
      </form>
      <Fine>End-to-end encrypted. Chat isn’t added to the notes.</Fine>
    </>}>
      <div ref={ref} className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-4">
        {state.chat.length === 0 && <span className="py-2 text-[13.5px] text-stage-dim">No messages yet</span>}
        {state.chat.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn(m.isMe && 'text-right')}>
            <b className="text-[12.5px] font-semibold text-[#D9D2C7]">{m.isMe ? 'You' : m.from.name}<small className="ml-1.5 font-mono font-medium text-stage-dim">{clock(m.at)}</small></b>
            <p className={cn('m-0 mt-[3px] inline-block px-3 py-2 text-left text-sm leading-[1.45]', m.isMe ? 'rounded-[14px_4px_14px_14px] bg-stage-ink text-[#17140F]' : 'rounded-[4px_14px_14px_14px] bg-[#26221E]')}>{m.text}</p>
          </motion.div>
        ))}
      </div>
    </Frame>
  );
}
