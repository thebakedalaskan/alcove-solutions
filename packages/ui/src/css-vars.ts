import type {} from 'react';

/* Allow CSS custom properties in style={{ '--x': ... }} without casts. */
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

export {};
