import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from '../cn';

/**
 * A QR code for a link: dark modules on a light card in either theme (the way every camera reads them), drawn as one
 * SVG path with the quiet zone the standard asks for. Made in the browser; the link goes nowhere else.
 */
export function QrCode({ value, label, size = 196, className }: { value: string; label: string; size?: number; className?: string | undefined }) {
  const { d, n } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 0 });
    let path = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
    return { d: path, n: qr.size };
  }, [value]);
  return (
    <svg role="img" aria-label={label} className={cn('ac-qr', className)} width={size} height={size} viewBox={`-4 -4 ${n + 8} ${n + 8}`} shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
