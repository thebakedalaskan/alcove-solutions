/*
 * What component stories share (stories/components/). A component renders on the page's ground in the toolbar's theme,
 * with what the app's root would give it (theme, tooltips, toasts). What only exists at night, the call stage and Record,
 * stands on the stage whatever the toolbar says. What only ever shows inside a popover can be shown on one's surface.
 *
 *   const meta = { title: 'Components/CallTile', component: CallTile, ...onStage } satisfies Meta<typeof CallTile>;
 */
import type { Decorator } from '@storybook/react-vite';
import type { CSSProperties, ReactNode } from 'react';
import { action } from 'storybook/actions';
import './component.css';

/**
 * The call stage, standing in the story's frame instead of over the window: night in both themes. The whole frame goes
 * night with it, as the app's document does while a call is up, so menus and tooltips portalled out of it stay night too.
 */
const stage: Decorator = (Story) => <div className="stage sbc-stage"><Story /></div>;

/** Spread into a meta (or a story) that only exists at night: it stands on the stage, edge to edge. */
export const onStage = { decorators: [stage], parameters: { layout: 'fullscreen' } };

/**
 * A popover's surface without the popover, for what's only ever shown inside one. `ws` for the workspace's; `className`
 * for a popover's own look (`ag-pop`, an agent's).
 */
export function PopSurface({ ws = false, width, className, children }: { ws?: boolean | undefined; width?: number | undefined; className?: string | undefined; children: ReactNode }) {
  const style: CSSProperties | undefined = width === undefined ? undefined : { width };
  return <div className={[ws ? 'ws-pop sbc-pop' : 'ac-pop sbc-pop', className].filter(Boolean).join(' ')} style={style}>{children}</div>;
}

/** A modal's frame without the modal, standing in the page: for the call modal's pieces, which only show inside one. */
export function ModalFrame({ children }: { children: ReactNode }) {
  return <div className="ac-modal sbc-modal">{children}</div>;
}

/** A box of a fixed size, for what fills whatever it's given: a tile, a pane, a scene. */
export function Box({ width, height, children }: { width: number | string; height: number | string; children: ReactNode }) {
  return <div className="sbc-box" style={{ width, height }}>{children}</div>;
}

/** Several of a component side by side, wrapping on a phone. */
export const Row = ({ children }: { children: ReactNode }) => <div className="sbc-row">{children}</div>;
/** Several of a component one under another. */
export const Stack = ({ children }: { children: ReactNode }) => <div className="sbc-stack">{children}</div>;

/** A handler that does nothing but say it was called, in the Actions panel. */
export const did = (name: string) => action(name);
