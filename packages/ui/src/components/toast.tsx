import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';

interface ToastItem { id: number; text: string; icon: IconName }
const Ctx = createContext<(text: string, icon?: IconName) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, icon: IconName = 'check') => {
    const id = ++n.current;
    setItems((s) => [...s.slice(-2), { id, text, icon }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 2800);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-[14px] bg-[#17140F] px-4 py-[11px] text-sm font-medium text-[#F5F1EA] shadow-float dark:bg-[#F5F1EA] dark:text-[#17140F]">
              <Icon name={t.icon} className="size-[18px]" />{t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
