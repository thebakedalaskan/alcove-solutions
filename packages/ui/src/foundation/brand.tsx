import { useId } from 'react';
import { cn } from './cn';

/** The mark: an arched window with the sun coming up over the horizon. */
export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={(size * 22) / 26} height={size} viewBox="0 0 22 26" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={`${id}a`}><path d="M2 24.6V11a9 9 0 0 1 18 0v13.6z" /></clipPath>
        <clipPath id={`${id}u`}><rect x="0" y="0" width="22" height="19.2" /></clipPath>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2373" /><stop offset=".42" stopColor="#5847DA" /><stop offset=".64" stopColor="#C470A9" /><stop offset=".74" stopColor="#FFA06A" />
        </linearGradient>
        <radialGradient id={`${id}n`} cx=".42" cy=".38" r=".72"><stop offset="0" stopColor="#FFF6E0" /><stop offset=".5" stopColor="#FFD58A" /><stop offset="1" stopColor="#FFB547" /></radialGradient>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor="#FFD58A" stopOpacity=".85" /><stop offset="1" stopColor="#FF9E5E" stopOpacity="0" /></radialGradient>
      </defs>
      <g clipPath={`url(#${id}a)`}>
        <rect width="22" height="26" fill={`url(#${id}s)`} />
        <g clipPath={`url(#${id}u)`}>
          <circle cx="11" cy="19.2" r="7.8" fill={`url(#${id}g)`} />
          <circle cx="11" cy="19.2" r="4.4" fill={`url(#${id}n)`} />
        </g>
        <rect y="19.2" width="22" height="7" fill="#231C5E" />
        <rect x="7.2" y="20.5" width="7.6" height=".9" rx=".45" fill="#FFB36E" opacity=".8" />
        <rect x="8.8" y="22.1" width="4.4" height=".8" rx=".4" fill="#FFB36E" opacity=".45" />
      </g>
      <path className="m-rim" d="M2 24.6V11a9 9 0 0 1 18 0v13.6z" strokeWidth="1" />
    </svg>
  );
}

export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  return <span className={cn('ac-brand', className)}><Mark size={size} />alcove</span>;
}

/** Sign-in providers' marks, drawn as each provider publishes them. */
export function ProviderMark({ provider, className }: { provider: 'google' | 'microsoft'; className?: string }) {
  if (provider === 'microsoft') {
    return (
      <svg viewBox="0 0 21 21" aria-hidden="true" className={cn('ac-logo', className)}>
        <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn('ac-logo', className)}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Stablecoin and network logos, served with the app rather than fetched from a third party (which would learn that
 * someone is paying). Keyed by token symbol (USDC) and by 1Click's chain name (near, eth, base, arb, sol, pol, bsc, op,
 * avax, tron: Tron for top-ups paid in USDT before only USDC was taken). From web3icons (MIT).
 */
const CRYPTO_MARKS = new Map<string, string>([
  ['usdc', new URL('../marks/usdc.svg', import.meta.url).href],
  ['near', new URL('../marks/near.svg', import.meta.url).href],
  ['eth', new URL('../marks/eth.svg', import.meta.url).href],
  ['base', new URL('../marks/base.svg', import.meta.url).href],
  ['arb', new URL('../marks/arb.svg', import.meta.url).href],
  ['sol', new URL('../marks/sol.svg', import.meta.url).href],
  ['pol', new URL('../marks/pol.svg', import.meta.url).href],
  ['bsc', new URL('../marks/bsc.svg', import.meta.url).href],
  ['op', new URL('../marks/op.svg', import.meta.url).href],
  ['avax', new URL('../marks/avax.svg', import.meta.url).href],
  ['tron', new URL('../marks/tron.svg', import.meta.url).href]
]);
/** A token's or a network's logo, or a plain disc for one without a logo here. Decorative: the name is said beside it. */
export function CryptoMark({ name, className }: { name: string; className?: string | undefined }) {
  const src = CRYPTO_MARKS.get(name.toLowerCase());
  if (!src) return <span aria-hidden="true" className={cn('ac-crypto is-blank', className)} />;
  return <img src={src} alt="" aria-hidden="true" className={cn('ac-crypto', className)} />;
}
