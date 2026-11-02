import type { AuthProvider } from '@alcove/api';
import { Button, cn, Spinner } from '@alcove/ui';

const PROVIDERS: { id: Exclude<AuthProvider, 'email'>; name: string; glyph: string; tile: string }[] = [
  { id: 'google', name: 'Google', glyph: 'G', tile: 'bg-[#3B6FE0] text-white' },
  { id: 'microsoft', name: 'Microsoft', glyph: 'M', tile: 'bg-[#F5F1EA] text-[#111]' },
  { id: 'apple', name: 'Apple', glyph: 'A', tile: 'bg-[#F5F1EA] text-[#111]' }
];

export function ProviderButtons({ busy, onPick }: { busy: AuthProvider | null; onPick: (p: AuthProvider) => void }) {
  return (
    <div className="flex w-full flex-col gap-2.5">
      {PROVIDERS.map((p) => (
        <Button key={p.id} size="lg" block disabled={!!busy} onClick={() => onPick(p.id)}
          className="h-[54px] justify-start bg-white/[.06] text-[15.5px] text-[#F5F1EA] shadow-[inset_0_0_0_1px_rgba(255,255,255,.13)] hover:bg-white/10 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,.24)] disabled:opacity-100">
          <span className={cn('mr-1.5 grid size-[26px] place-items-center rounded-lg font-display text-sm font-extrabold', p.tile)}>{p.glyph}</span>
          {busy === p.id ? <><Spinner /> Waiting for {p.name}…</> : `Continue with ${p.name}`}
        </Button>
      ))}
    </div>
  );
}
