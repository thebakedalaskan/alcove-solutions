/*
 * The icons drawn inside the text: a tick in a checkbox, the fold on a toggle, the calendar in a date. There can be
 * hundreds, ProseMirror builds them outside React, and they never change, so each is drawn once with `Icon` when the
 * editor loads and copied from there.
 */
import { Icon, type IconName } from '@alcove/ui';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export const CALLOUT_ICONS = ['bulb', 'megaphone', 'alert'] as const satisfies readonly IconName[];

const SIZES: readonly (readonly [IconName, number])[] = [['check', 13], ['chevron', 14], ['cal', 13], ['fileText', 13], ['comment', 14], ...CALLOUT_ICONS.map((name) => [name, 17] as const)];

const drawn = new Map<string, Element>();

function draw(): void {
  for (const [name, size] of SIZES) {
    const box = document.createElement('div');
    const root = createRoot(box);
    flushSync(() => root.render(<Icon name={name} size={size} />));
    const svg = box.firstElementChild;
    if (svg) drawn.set(name, svg);
    root.unmount();
  }
}

/** Runs when the editor's code loads, which is never while React is rendering. */
draw();

/** A copy of an icon to put in the page. */
export function iconNode(name: IconName): Node {
  return drawn.get(name)?.cloneNode(true) ?? document.createTextNode('');
}
