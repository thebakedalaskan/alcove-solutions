import { useEffect, useState } from 'react';

/** How wide the window is: on a phone, one thing at a time. */
export function useWidth() {
  const [w, setW] = useState(() => innerWidth);
  useEffect(() => { const on = () => setW(innerWidth); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  return w;
}
