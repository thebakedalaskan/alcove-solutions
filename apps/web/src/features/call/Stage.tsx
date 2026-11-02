import type { CallParticipant, CallState } from '@alcove/api';
import { Avatar, CameraScene, Chip, Icon, WaitingDots, cn } from '@alcove/ui';
import { motion } from 'motion/react';

function Tile({ p, highlight }: { p: CallParticipant; highlight: boolean }) {
  return (
    <motion.div layout transition={{ type: 'spring', stiffness: 300, damping: 34 }}
      className={cn('relative min-h-0 overflow-hidden rounded-[18px] bg-[#1B1814] transition-shadow duration-300', highlight && 'shadow-[0_0_0_2px_#F5F1EA]')}>
      {p.cam ? <CameraScene person={p.person} speaking={p.speaking} /> : (
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn('rounded-full transition-shadow duration-300', p.speaking && 'shadow-[0_0_0_5px_rgba(245,241,234,.2),0_0_0_14px_rgba(245,241,234,.06)]')}><Avatar person={p.person} size={104} ring={false} /></span>
        </div>
      )}
      {p.speaking && p.mic && <span className="absolute right-3 top-3 flex h-3.5 items-end gap-0.5">{[0, 1, 2].map((i) => <i key={i} className="w-[3px] rounded-sm bg-[#F5F1EA] animate-[wv_.8s_ease-in-out_infinite]" style={{ animationDelay: `${-i * 0.25}s` }} />)}</span>}
      {p.hand && <span className="absolute left-3 top-3 grid size-8 animate-pop place-items-center rounded-full bg-lamp text-[#2A1700]"><Icon name="hand" className="size-[18px]" /></span>}
      <span className="absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1 text-[13px] font-semibold text-white backdrop-blur-md">
        {!p.mic && <Icon name="micOff" className="size-3.5 text-rec-ink" />}{p.isMe ? 'You' : p.person.name}{p.isGuest && !p.isMe && <span className="font-normal text-white/60"> · guest</span>}
      </span>
    </motion.div>
  );
}

function SharedScreen({ notesOn }: { notesOn: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.22, 0.8, 0.24, 1] }}
      className="relative row-span-full flex flex-col gap-[18px] overflow-hidden rounded-[18px] bg-[#F7F4EE] px-10 py-[34px] text-[#17140F]">
      <small className="text-xs text-[#6F675D]">Harbor pilot · Q4</small>
      <h2 className="text-[34px]">Pilot timeline</h2>
      <div className="flex flex-col gap-3">
        {[{ l: 'Kickoff', w: 24, ml: 0, d: 'Nov 10' }, { l: 'Data review', w: 56, ml: 22, d: 'Nov 24' }, { l: 'Go / no-go', w: 18, ml: 76, d: 'Dec 8' }].map(({ l, w, ml, d }) => (
          <div key={l} className="grid grid-cols-[110px_1fr_60px] items-center gap-3 text-[15px]"><span>{l}</span><i className="h-3 rounded-md bg-[#FFA62B]" style={{ width: `${w}%`, marginLeft: `${ml}%` }} /><em className="font-mono text-[13px] not-italic text-[#6F675D]">{d}</em></div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        {[['3', 'clinics'], ['120', 'staff on calls'], ['4 wks', 'to go/no-go'], ['0', 'installs needed']].map(([b, s]) => (
          <div key={s} className="rounded-[14px] bg-white p-4 shadow-[inset_0_0_0_1px_#E6E1D9]"><b className="block font-display text-[30px] font-bold tracking-[-.03em]">{b}</b><span className="text-[13px] text-[#6F675D]">{s}</span></div>
        ))}
      </div>
      {notesOn && <span className="absolute bottom-3.5 right-4 inline-flex animate-pop items-center gap-1.5 rounded-lg bg-[#17140F] px-2.5 py-[5px] text-[12.5px] font-semibold text-[#F2EEE7]"><Icon name="notes" className="size-3.5" />Notes include this screen</span>}
    </motion.div>
  );
}

export function Stage({ state, onStopShare }: { state: CallState; onStopShare: () => void }) {
  const n = state.participants.length;
  const alone = n === 1;
  const share = !!state.sharing;
  return (
    <div className={cn('relative grid min-h-0 gap-2.5',
      share ? 'grid-cols-[minmax(0,1fr)_190px] grid-rows-[repeat(4,minmax(0,1fr))]' : alone ? 'grid-cols-1 place-items-center content-center' : n <= 2 ? 'grid-cols-2 auto-rows-fr' : n <= 4 ? 'grid-cols-2 auto-rows-fr' : 'grid-cols-3 auto-rows-fr')}>
      {share && (
        <>
          <SharedScreen notesOn={state.notes.status === 'on'} />
          <div className="absolute left-4 top-4 z-[2] flex items-center gap-2"><Chip tone="neutral" icon="screen" className="bg-[#ECE7DF] text-[#5B544B]">You’re presenting</Chip><button type="button" onClick={onStopShare} className="h-[34px] rounded-[10px] bg-rec px-3 text-[13.5px] font-semibold text-white">Stop presenting</button></div>
        </>
      )}
      {state.participants.map((p) => (
        <div key={p.id} className={cn('min-h-0', share ? 'col-start-2 [&>*]:h-full' : alone ? 'aspect-video w-[min(100%,calc((100vh-190px)*16/9))] [&>*]:h-full' : '[&>*]:h-full')}>
          <Tile p={p} highlight={p.speaking && n > 1} />
        </div>
      ))}
      {alone && !share && (
        <span className="absolute bottom-4 left-1/2 z-[2] inline-flex -translate-x-1/2 animate-pop items-center gap-2.5 rounded-full bg-black/50 px-3.5 py-2 text-[13.5px] font-semibold backdrop-blur-md [animation-delay:.4s]"><WaitingDots />Waiting for others to join</span>
      )}
    </div>
  );
}
