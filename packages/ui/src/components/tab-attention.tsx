import { Mark } from './brand';

export type TabAttentionKind = 'information' | 'action';
export interface TabAttentionColors { badge: string; ink: string; rim: string }

/** The same still icon in Storybook and the browser tab. The lamp stays branding; shape and colour name the state. */
export function TabAttentionIcon({ kind, count, colors, size = 32 }: { kind: TabAttentionKind; count: number; colors: TabAttentionColors; size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 32 32" aria-label={kind === 'action' ? 'Admission requests waiting' : 'Unread mentions'} role="img">
      <g transform="translate(1 0)"><Mark size={30} /></g>
      {kind === 'action'
        ? <rect x="16" y="16" width="15" height="15" rx="4" fill={colors.badge} stroke={colors.rim} strokeWidth="2" />
        : <circle cx="23.5" cy="23.5" r="7.5" fill={colors.badge} stroke={colors.rim} strokeWidth="2" />}
      <text x="23.5" y="27.5" fill={colors.ink} fontFamily="Arial, sans-serif" fontSize="12" fontWeight="700" textAnchor="middle">{count > 9 ? '+' : Math.max(1, count)}</text>
    </svg>
  );
}
