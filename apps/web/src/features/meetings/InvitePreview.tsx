import type { MeetingNotesSetting } from '@alcove/api';
import { Avatar, Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { q } from '~/lib/queries';

/** What a guest will receive once email invites are connected. */
export function InvitePreview({ title, when, code, notes }: { title: string; when: string; code: string; notes: MeetingNotesSetting }) {
  const { data: s } = useQuery(q.session());
  const line = notes === 'off' ? 'This call won’t take notes.'
    : notes === 'ask' ? 'The host decides on notes when the call starts. You’ll see it before you join.'
    : `This call takes ${notes === 'full' ? 'notes and a transcript' : 'notes (no transcript is kept)'}. Everyone in the call gets a copy.`;
  return (
    <div className="overflow-hidden rounded-[20px] bg-card shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair)]">
      <div className="flex items-center gap-2.5 border-b border-hair px-[18px] py-3.5">
        {s && <Avatar person={s.user} size={34} ring={false} />}
        <div><b className="block text-sm">{s?.user.name}</b><span className="text-[12.5px] text-ink-3">{s?.user.email}</span></div>
        <span className="ml-auto rounded-full bg-well px-[9px] py-[3px] text-xs font-semibold text-ink-2">Invitation</span>
      </div>
      <div className="flex flex-col items-start gap-2 px-[18px] pb-[18px] pt-5">
        <b className="font-display text-[22px] font-bold leading-[1.15] tracking-[-.02em]">{title || 'Untitled call'}</b>
        <span className="text-sm text-ink-2">{when}</span>
        <span className="mt-2 inline-flex h-10 items-center gap-2 rounded-[11px] bg-btn px-4 text-sm font-semibold text-btn-ink"><Icon name="cam" className="size-4" /> Join with Alcove</span>
        <span className="font-mono text-[12.5px] text-ink-3">alcove.app/{code}</span>
        <div className="mt-2 flex w-full gap-2 rounded-xl bg-raised px-3 py-2.5 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)]"><Icon name="notes" className="mt-px size-4" /><span>{line}</span></div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-3">Going? {['Yes', 'Maybe', 'No'].map((x) => <i key={x} className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold not-italic text-ink shadow-[inset_0_0_0_1px_var(--hair-2)]">{x}</i>)}</div>
      </div>
    </div>
  );
}
