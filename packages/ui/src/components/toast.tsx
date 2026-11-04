import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';

export interface ToastOptions {
  /** `false` for no icon. */
  icon?: IconName | false | undefined;
  action?: { label: string; onClick: () => void } | undefined;
  ms?: number | undefined;
}
/** Shows a toast. Returns what takes it away early, for a toast about something that can be over before it times out. */
type Push = (text: ReactNode, o?: ToastOptions) => () => void;
interface ToastItem { id: number; text: ReactNode; o: ToastOptions }

const PushCtx = createContext<Push>(() => () => {});
const RaiseCtx = createContext<(raised: boolean) => void>(() => {});

/** Short confirmations in past tense, bottom-centre and inverted, with an optional action such as Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [raised, setRaised] = useState(false);
  const n = useRef(0);
  const close = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((text, o = {}) => {
    const id = ++n.current;
    setItems((s) => [...s.slice(-2), { id, text, o }]);
    setTimeout(() => close(id), o.ms ?? 3600);
    return () => close(id);
  }, [close]);
  return (
    <PushCtx.Provider value={push}>
      <RaiseCtx.Provider value={setRaised}>
        {children}
        <div aria-live="polite" className={cn('ac-toasts', raised && 'on-stage')}>
          <AnimatePresence initial={false}>
            {items.map((t) => (
              <motion.div key={t.id} layout className="ac-toast" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>
                {t.o.icon !== false && <Icon name={t.o.icon ?? 'check'} size={17} />}
                <span>{t.text}</span>
                {t.o.action && <button type="button" onClick={() => { t.o.action?.onClick(); close(t.id); }}>{t.o.action.label}</button>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </RaiseCtx.Provider>
    </PushCtx.Provider>
  );
}
export const useToast = (): Push => useContext(PushCtx);
/** Lifts toasts above a bottom control bar while the calling screen is mounted. */
export function useRaisedToasts() {
  const set = useContext(RaiseCtx);
  useEffect(() => { set(true); return () => set(false); }, [set]);
}
