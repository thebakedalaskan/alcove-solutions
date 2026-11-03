import type { ReactNode, SVGProps } from 'react';
import { cn } from '../cn';

/* One stroke family: 24px grid, 1.8 stroke, round caps and joins. */
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  home: <path d="M4 11.2 12 4.8l8 6.4V19a1 1 0 0 1-1 1h-4.6v-5.4H9.6V20H5a1 1 0 0 1-1-1z" />,
  notes: <><path d="M6.5 3.8h7.3l3.7 3.7v12.7H6.5z" /><path d="M13.6 3.8v3.9h3.9M9.3 12.2h5.4M9.3 15.8h3.8" /></>,
  search: <><circle cx="11" cy="11" r="6.4" /><path d="m20 20-4.4-4.4" /></>,
  video: <><rect x="3.4" y="6" width="12.2" height="12" rx="2.6" /><path d="m15.6 10.4 5-3v9.2l-5-3" /></>,
  videoOff: <><path d="M15.6 13.6v1.8a2.6 2.6 0 0 1-2.6 2.6H6a2.6 2.6 0 0 1-2.6-2.6V8.6A2.6 2.6 0 0 1 6 6h1.6M11 6h2a2.6 2.6 0 0 1 2.6 2.6v1.8l5-3v9.2l-3.4-2" /><path d="m3 3 18 18" /></>,
  mic: <><rect x="9" y="3.4" width="6" height="11" rx="3" /><path d="M5.6 11.2a6.4 6.4 0 0 0 12.8 0M12 17.6v3" /></>,
  micOff: <><path d="M15 10.6V6.4a3 3 0 0 0-5.8-1M9 9v2.4a3 3 0 0 0 4.6 2.5M18.4 11.2a6.3 6.3 0 0 1-1 3.4M5.6 11.2a6.4 6.4 0 0 0 10 5.3M12 17.6v3" /><path d="m3 3 18 18" /></>,
  screen: <><rect x="3.4" y="4.8" width="17.2" height="11.6" rx="2" /><path d="M8.4 20h7.2M12 16.4V20M12 13.2V8.2M9.6 10.4 12 8l2.4 2.4" /></>,
  chat: <path d="M4.4 5.4h15.2v10.2H9.6l-5.2 4.2z" />,
  people: <><circle cx="9" cy="8.6" r="3.1" /><path d="M3.4 19.4c.3-3.2 2.7-5.4 5.6-5.4s5.3 2.2 5.6 5.4" /><circle cx="16.8" cy="9.4" r="2.5" /><path d="M15.6 14.1c2.9-.4 4.9 1.6 5.1 4.7" /></>,
  leave: <path d="M3.3 13.8c4.8-4.4 12.6-4.4 17.4 0 .6.6.6 1.5 0 2.1l-1.5 1.4c-.5.5-1.3.5-1.8.1l-2.2-1.7c-.4-.3-.6-.8-.5-1.3l.3-1.4c-2-.7-4-.7-6 0l.3 1.4c.1.5-.1 1-.5 1.3l-2.2 1.7c-.5.4-1.3.4-1.8-.1l-1.5-1.4c-.6-.6-.6-1.5 0-2.1z" fill="currentColor" stroke="none" />,
  pen: <><path d="M4.4 19.6h4L19 9a2.1 2.1 0 0 0-3-3L5.4 16.6z" /><path d="m14.4 7.6 3 3" /></>,
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  pause: <path d="M8.6 5.4v13.2M15.4 5.4v13.2" />,
  stop: <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.4" fill="currentColor" stroke="none" />,
  check: <path d="m5 12.6 4.4 4.4L19 7.6" />,
  x: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  right: <path d="M5 12h14M13.4 6.4 19 12l-5.6 5.6" />,
  left: <path d="M19 12H5M10.6 6.4 5 12l5.6 5.6" />,
  down: <path d="m6.4 9.4 5.6 5.6 5.6-5.6" />,
  chevron: <path d="m9.4 6.4 5.6 5.6-5.6 5.6" />,
  link: <path d="M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" />,
  copy: <><rect x="8.4" y="8.4" width="11.6" height="11.6" rx="2.4" /><path d="M15.6 8.4V6.2A2.2 2.2 0 0 0 13.4 4H6.2A2.2 2.2 0 0 0 4 6.2v7.2a2.2 2.2 0 0 0 2.2 2.2h2.2" /></>,
  cal: <><rect x="3.6" y="5" width="16.8" height="15.4" rx="2.6" /><path d="M3.6 10h16.8M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.6V12l2.8 1.8" /></>,
  lock: <><rect x="5" y="10.6" width="14" height="9.8" rx="2.4" /><path d="M8.2 10.6V8a3.8 3.8 0 0 1 7.6 0v2.6" /></>,
  key: <><circle cx="8.2" cy="15.6" r="4" /><path d="m11.2 12.6 8.2-8.2M16.4 7.6l2.2 2.2M14.2 9.8l1.6 1.6" /></>,
  trash: <path d="M4.4 7h15.2M9.4 7V4.6h5.2V7M6.6 7l.9 12.4c.1.9.8 1.6 1.7 1.6h5.6c.9 0 1.6-.7 1.7-1.6L17.4 7" />,
  more: <><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  play: <path d="M8.4 5.6v12.8l10.2-6.4z" fill="currentColor" stroke="none" />,
  speaker: <><path d="M4.4 9.4h3.4l4.6-4v13.2l-4.6-4H4.4z" /><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" /></>,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4 6 6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6" /></>,
  moon: <path d="M19.4 14.6A7.6 7.6 0 0 1 9.4 4.6a7.6 7.6 0 1 0 10 10z" />,
  ask: <><path d="M4.4 5.4h15.2v10.2H9.6l-5.2 4.2z" /><path d="M10 9.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 14.2v.1" /></>,
  share: <path d="M12 14.6V3.6M7.6 7.8 12 3.4l4.4 4.4M5 12.6v6.8h14v-6.8" />,
  send: <><path d="M4.6 11.6 19.4 4.6l-4.2 15-3.6-6.2z" /><path d="m11.6 13.4 7.8-8.8" /></>,
  room: <><circle cx="12" cy="12" r="2.4" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
  server: <><rect x="4" y="4.4" width="16" height="6.4" rx="1.8" /><rect x="4" y="13.2" width="16" height="6.4" rx="1.8" /><path d="M7.6 7.6h.01M7.6 16.4h.01" /></>,
  hand: <path d="M8 12.4V6.2a1.4 1.4 0 0 1 2.8 0v5M10.8 10.6V4.8a1.4 1.4 0 0 1 2.8 0v5.8M13.6 10.6V6a1.4 1.4 0 0 1 2.8 0v6.8M16.4 9.6a1.4 1.4 0 0 1 2.8 0v4.2c0 3.6-2.6 6.6-6.4 6.6-2.8 0-4.4-1.4-6-3.8l-2-3.2a1.4 1.4 0 0 1 2.4-1.4L8 13.4" />,
  mail: <><rect x="3.6" y="5.6" width="16.8" height="12.8" rx="2.6" /><path d="m4.6 7.4 7.4 5.6 7.4-5.6" /></>,
  addUser: <><circle cx="10" cy="8.4" r="3.6" /><path d="M3.6 19.6c.5-3.6 3.1-5.8 6.4-5.8 1.6 0 3 .5 4.2 1.4M18 13.6v6M15 16.6h6" /></>,
  signOut: <path d="M9.4 19.4H6.2a1.6 1.6 0 0 1-1.6-1.6V6.2a1.6 1.6 0 0 1 1.6-1.6h3.2M15.4 16.4 19.8 12l-4.4-4.4M19.8 12H9.8" />,
  door: <><path d="M6.4 20.4V4.8a1.2 1.2 0 0 1 1.2-1.2h8.8a1.2 1.2 0 0 1 1.2 1.2v15.6M3.6 20.4h16.8" /><circle cx="14.4" cy="12.4" r="1" fill="currentColor" stroke="none" /></>
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('i', className)} {...rest}>
      {PATHS[name]}
    </svg>
  );
}
