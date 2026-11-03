/*
 * The mark, large and alive: a dimensional arched window. The sun rises on load, the arch floats,
 * three points of light orbit it, the reflections shimmer, the stars twinkle, and it tilts toward
 * the pointer. Under reduced motion it's simply there, sun up.
 */
import { EASE, Fit } from '@alcove/ui';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { useEffect, useId, type RefObject } from 'react';

const STARS = [[90, 110, 1.6], [150, 70, 1.2], [210, 120, 1.8], [250, 180, 1.2], [120, 170, 1.1], [180, 200, 1.4]] as const;
const GLINTS = [[105, 310, 110, 5, 0.85], [128, 330, 64, 4.5, 0.5], [146, 348, 28, 4, 0.3]] as const;
const ARCH = 'M20 380V160A140 140 0 0 1 300 160V380Z';
const forever = (duration: number, delay: number) => ({ duration, delay, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } as const);

export function HeroMark({ hero }: { hero: RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion() ?? false;
  const id = useId().replace(/:/g, '');
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const drift = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const rx = useSpring(0, { stiffness: 90, damping: 18 });
  const ry = useSpring(0, { stiffness: 90, damping: 18 });

  /* Tilt toward the pointer while it's over the hero. */
  useEffect(() => {
    const el = hero.current;
    if (!el || reduce) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ry.set(((e.clientX - r.left) / r.width - 0.5) * 16);
      rx.set(-((e.clientY - r.top) / r.height - 0.5) * 12);
    };
    const leave = () => { rx.set(0); ry.set(0); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [hero, reduce, rx, ry]);

  const from = <T,>(v: T) => (reduce ? false : v);
  return (
    <Fit width={560} height={640} label="The Alcove mark: an arched window with the sun rising">
      <motion.div className="lp-mk" style={{ y: reduce ? 0 : drift }}>
        <motion.div className="lp-mk-orbit" initial={from({ opacity: 0 })} animate={{ opacity: 1 }} transition={{ duration: 2, delay: 1.2 }}>
          <motion.div className="lp-mk-orbit" animate={reduce ? {} : { rotate: 360 }} transition={{ duration: 40, ease: 'linear', repeat: Infinity }}>
            <svg viewBox="0 0 560 640" aria-hidden="true">
              <circle cx="280" cy="40" r="3.5" fill="#FFB547" /><circle cx="520" cy="330" r="2.5" fill="#A99FFF" /><circle cx="70" cy="470" r="3" fill="#FF7A45" />
            </svg>
          </motion.div>
        </motion.div>
        <motion.div className="lp-mk-tilt" initial={from({ y: 70, scale: 0.9, opacity: 0 })} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ duration: 1.8, delay: 0.1, ease: EASE.expo }}>
          <motion.div className="lp-mk-tilt" style={{ left: 0, top: 0, rotateX: rx, rotateY: ry }} animate={reduce ? {} : { y: [0, -14] }} transition={forever(4.5, 2)}>
            <svg viewBox="0 0 320 400" aria-hidden="true">
              <defs>
                <clipPath id={`${id}a`}><path d={ARCH} /></clipPath>
                <clipPath id={`${id}u`}><rect x="0" y="0" width="320" height="292" /></clipPath>
                <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1A1660" /><stop offset=".38" stopColor="#3B2EA6" /><stop offset=".6" stopColor="#C470A9" /><stop offset=".74" stopColor="#FFA06A" /></linearGradient>
                <radialGradient id={`${id}n`} cx=".42" cy=".38" r=".72"><stop offset="0" stopColor="#FFF6E0" /><stop offset=".5" stopColor="#FFD58A" /><stop offset="1" stopColor="#FFB547" /></radialGradient>
                <radialGradient id={`${id}g`}><stop offset="0" stopColor="#FFD58A" stopOpacity=".9" /><stop offset="1" stopColor="#FF9E5E" stopOpacity="0" /></radialGradient>
                <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3A2B8A" /><stop offset="1" stopColor="#5B2A55" /></linearGradient>
                <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".45" stopColor="#fff" stopOpacity="0" /></linearGradient>
              </defs>
              <path d={ARCH} fill={`url(#${id}e)`} transform="translate(10 16)" />
              <g clipPath={`url(#${id}a)`}>
                <rect width="320" height="400" fill={`url(#${id}s)`} />
                <g fill="#fff">
                  {STARS.map(([cx, cy, r], i) => (
                    <motion.g key={`${cx}-${cy}`} initial={from({ opacity: 0 })} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 0.9 + i * 0.12 }}>
                      <motion.circle cx={cx} cy={cy} r={r} animate={reduce ? {} : { opacity: [1, 0.25] }} transition={forever(1.4 + (i % 3) * 0.6, 2 + i * 0.3)} />
                    </motion.g>
                  ))}
                </g>
                <g clipPath={`url(#${id}u)`}>
                  <motion.g initial={from({ y: 120 })} animate={{ y: 0 }} transition={{ duration: 3, delay: 0.5, ease: EASE.out }}>
                    <motion.g animate={reduce ? {} : { y: [0, -6] }} transition={forever(5, 3.5)}>
                      <circle cx="160" cy="292" r="120" fill={`url(#${id}g)`} />
                      <circle cx="160" cy="292" r="64" fill={`url(#${id}n)`} />
                    </motion.g>
                  </motion.g>
                </g>
                <rect y="292" width="320" height="108" fill="#231C5E" />
                {GLINTS.map(([x, y, w, h, o], i) => (
                  <motion.rect key={y} x={x} y={y} width={w} height={h} rx={h / 2} fill="#FFB36E" opacity={o}
                    animate={reduce ? {} : { scaleX: [1, 0.8] }} transition={forever(2.2, i * 0.5)} />
                ))}
                <path d={ARCH} fill={`url(#${id}l)`} />
              </g>
              <path d={ARCH} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" />
            </svg>
          </motion.div>
        </motion.div>
      </motion.div>
    </Fit>
  );
}
