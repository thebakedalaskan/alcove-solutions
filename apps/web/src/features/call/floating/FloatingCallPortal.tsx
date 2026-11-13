import { FloatingCall, type FloatingCallProps } from '@alcove/ui';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** All compact controls, errors and the inline departure question live in this child document's one portal. */
export function FloatingCallPortal({ target, view }: { target: Window | null; view: FloatingCallProps }) {
  const question = Boolean(view.children);
  const asked = useRef(false);
  useLayoutEffect(() => {
    // Stay returns focus to this document's Leave control, never to the full call behind it.
    if (asked.current && !question && target && !target.closed) target.document.querySelector<HTMLButtonElement>('[data-floating-leave]')?.focus();
    asked.current = question;
  }, [question, target]);
  return target && !target.closed ? createPortal(<div className="ic-floating-root"><FloatingCall {...view} /></div>, target.document.body) : null;
}
