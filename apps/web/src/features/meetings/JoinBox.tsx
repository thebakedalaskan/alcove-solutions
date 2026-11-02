import { Button, Icon, cn } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

/** Paste a code or a full link. Anything after the last slash (minus the #key) is the code. */
export function JoinBox() {
  const [v, setV] = useState('');
  const navigate = useNavigate();
  const code = (v.trim().split('#')[0] ?? '').split('/').filter(Boolean).pop() ?? '';
  const go = () => { if (code) void navigate({ to: '/join/$code', params: { code } }); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex h-[50px] min-w-[300px] items-center gap-2 rounded-[14px] bg-card pl-3.5 pr-1.5 shadow-[inset_0_0_0_1px_var(--hair-2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink)]">
      <Icon name="keyboard" className="text-ink-3" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Enter a code or link" aria-label="Call code or link" className="h-full flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-ink-3" />
      <Button type="submit" size="sm" variant={code ? 'primary' : 'ghost'} className={cn(!code && 'text-ink-3')}>Join</Button>
    </form>
  );
}
