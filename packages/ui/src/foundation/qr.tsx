import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from './cn';

/**
 * A QR code for a link: dark modules on a light card in either theme (the way every camera reads them), drawn as one
 * SVG path with the quiet zone the standard asks for. Made in the browser; the link goes nowhere else. `ecc` is how much
 * of the code can be covered and still read: `H` for one with a mark over its middle.
 */
export function QrCode({ value, label, size = 196, ecc = 'M', className }: { value: string; label: string; size?: number; ecc?: 'M' | 'H'; className?: string | undefined }) {
  const { d, n } = useMemo(() => {
    const qr = encode(value, { ecc, border: 0 });
    let path = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
    return { d: path, n: qr.size };
  }, [value, ecc]);
  return (
    <svg role="img" aria-label={label} className={cn('ac-qr', className)} width={size} height={size} viewBox={`-4 -4 ${n + 8} ${n + 8}`} shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
