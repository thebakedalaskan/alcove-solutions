import { clock, type CallSession, type CallState } from '@alcove/api';
import { Avatar, Icon, IconButton, cn } from '@alcove/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { MicMeter } from './DevicePreview';
import type { LocalMedia } from './media';

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
const Fine = ({ children }: { children: React.ReactNode }) => <span className="flex items-start gap-1.5 text-[13px] text-stage-dim"><Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />{children}</span>;

export function NotesPanel({ state, media, onClose, onStart, uploadError }: { state: CallState; media: LocalMedia; onClose: () => void; onStart: () => void; uploadError: string | null }) {
  const n = state.notes;
  const rec = n.recording;
  return (
    <Frame title="Notes" onClose={onClose} footer={n.status !== 'off' && <Fine>Audio is encrypted with a key for this recording before it’s stored. {n.mode === 'notes' ? 'The transcript will be deleted once notes are written.' : 'The transcript will be kept with the notes.'}</Fine>}>
      <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 pb-4 pt-1">
        {n.status === 'off' ? (
          <div className="my-auto flex flex-col items-center gap-2 px-2 py-6 text-center text-[#BEB5A9]">
            <Icon name="notes" className="size-7 text-stage-dim" /><b className="text-base text-stage-ink">Notes are off</b>
            <p className="m-0 mb-1.5 text-[13.5px]">Start notes and Alcove records from that moment on, not before. Everyone sees a notice.</p>
            <button type="button" onClick={onStart} className="h-[34px] rounded-[10px] bg-stage-ink px-3 text-[13.5px] font-semibold text-[#17140F]">Start notes</button>
            {n.everOn && <span className="text-[13px]">What was recorded so far is kept.</span>}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-2xl bg-[#211E1A] p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">{n.status === 'on' ? <><i className="size-2 animate-recpulse rounded-full bg-rec" />Recording</> : <><Icon name="pause" className="size-4" />Paused</>}</span>
                {n.status === 'on' && <MicMeter media={media} dark />}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[13px] text-stage-mute">
                <div><b className="block font-mono text-[22px] font-semibold text-stage-ink tabular">{clock(rec.seconds)}</b>recorded</div>
                <div><b className="block font-mono text-[22px] font-semibold text-stage-ink tabular">{rec.pieces}</b>encrypted pieces saved</div>
              </div>
              {uploadError && <p className="m-0 text-[13px] text-rec-ink">{uploadError}</p>}
            </div>
            <div className="rounded-2xl p-1 text-[13.5px] leading-normal text-[#BEB5A9]">
              <b className="mb-1 block text-stage-ink">What happens next</b>
              When the call ends, the recording is handed to the notes service, which writes the summary, decisions and action items{n.mode === 'full' ? ' and keeps the transcript' : ''}. In this build the notes service isn’t connected yet, so you’ll find the encrypted recording on the notes page, ready to play back.
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

export function PeoplePanel({ state, onClose }: { state: CallState; onClose: () => void }) {
  return (
    <Frame title={`People · ${state.participants.length}`} onClose={onClose} footer={<span className="text-[13px] text-stage-dim">Only you can be in calls in this build. Inviting others comes next.</span>}>
      <div className="flex flex-1 flex-col gap-1 overflow-auto px-4 pb-4">
        {state.participants.map((p) => (
          <div key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 py-1.5">
            <Avatar person={p.person} size={32} ring={false} />
            <span><b className="block text-sm">{p.person.name}{p.isMe && ' (you)'}</b><span className="text-xs text-stage-dim">{[p.isHost && 'Host', p.hand && 'Hand raised'].filter(Boolean).join(' · ')}</span></span>
            <Icon name={p.mic ? 'mic' : 'micOff'} className={cn('size-[17px]', p.mic ? 'text-stage-dim' : 'text-rec-ink')} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function ChatPanel({ state, session, onClose }: { state: CallState; session: CallSession; onClose: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [state.chat.length]);
  const send = () => { if (!text.trim()) return; session.sendChat(text); setText(''); };
  return (
    <Frame title="Chat" onClose={onClose} footer={<>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 rounded-xl bg-stage-3 py-1 pl-3 pr-1">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" aria-label="Chat message" className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-stage-ink outline-none placeholder:text-stage-dim" />
        <IconButton tone="stage" icon="send" label="Send" type="submit" />
      </form>
      <Fine>Stored encrypted with the call. Chat isn’t added to the notes.</Fine>
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
