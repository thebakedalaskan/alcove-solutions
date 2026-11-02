import { Button, Dialog, Icon, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { q, usePurchase } from '~/lib/queries';

export function TopUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: packs } = useQuery(q.packs());
  const [sel, setSel] = useState('p10');
  const buy = usePurchase();
  const toast = useToast();
  const pack = packs?.find((p) => p.id === sel);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add credits"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={buy.isPending} disabled={!pack} onClick={async () => { if (!pack) return; await buy.mutateAsync(pack.id); toast(`${pack.credits.toLocaleString('en-US')} credits added`); onClose(); }}>Pay {pack?.priceUsdc ?? ''} USDC</Button></>}>
      <p className="m-0 text-ink-3">Pay in USDC from any wallet or chain. Credits never expire.</p>
      <div role="radiogroup" className="grid grid-cols-3 gap-2">
        {packs?.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={sel === p.id} onClick={() => setSel(p.id)}
            className={cn('flex flex-col gap-1 rounded-2xl px-3.5 py-4 text-left transition-shadow', sel === p.id ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'shadow-[inset_0_0_0_1px_var(--hair-2)]')}>
            <b className="font-mono text-xl font-semibold tracking-[-.02em]">{p.credits.toLocaleString('en-US')}</b>
            <span className="font-semibold">{p.priceUsdc} USDC</span>
            <em className="text-[12.5px] not-italic text-ink-3">{p.badge ?? `≈ ${Math.round(p.credits / 25 / 60)} hours of notes`}</em>
          </button>
        ))}
      </div>
      <p className="m-0 flex items-start gap-2 text-[13px] text-ink-3"><Icon name="lock" className="mt-0.5 size-[15px]" />Payment is matched to your account inside the sealed server. Alcove can’t link a payment to your calls.</p>
    </Dialog>
  );
}
