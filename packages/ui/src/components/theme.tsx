import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'alcove-theme';
const Ctx = createContext<{ theme: ThemeChoice; resolved: 'light' | 'dark'; setTheme: (t: ThemeChoice) => void; toggle: () => void }>({
  theme: 'system', resolved: 'light', setTheme: () => {}, toggle: () => {}
});

/** Inline this in <head> so the right theme paints before React hydrates. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); setThemeState(v === 'light' || v === 'dark' ? v : 'system'); } catch { /* storage unavailable */ }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); }, [resolved]);
  const setTheme = useCallback((t: ThemeChoice) => { setThemeState(t); try { localStorage.setItem(KEY, t); } catch { /* ignore */ } }, []);
  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme]);
  return <Ctx.Provider value={{ theme, resolved, setTheme, toggle }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
