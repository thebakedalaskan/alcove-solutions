/* Live translation: Priya speaks Hindi; three listeners read her words in English, Spanish and Japanese. */
import { Avatar, Caption, CallTile, Chip, EASE, Fit, useSceneLoop } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { SceneFrame, WriteIn, box, words } from './parts';

const SENTENCES = [
  { hi: 'मुझे लगता है कि हमें लॉन्च 18 तारीख तक आगे बढ़ाना चाहिए।', en: 'I think we should move the launch to the 18th.', es: 'Creo que deberíamos mover el lanzamiento al día 18.', ja: 'ローンチを|18日に|移すべきだと|思います。' },
  { hi: 'नई स्क्रीन बुधवार तक तैयार हो जाएंगी।', en: 'The new screens will be ready by Wednesday.', es: 'Las nuevas pantallas estarán listas el miércoles.', ja: '新しい画面は|水曜日までに|準備|できます。' }
] as const;
const LISTENERS: { id: CastId; lang: 'en' | 'es' | 'ja'; name: string }[] = [
  { id: 'theo', lang: 'en', name: 'English' }, { id: 'diego', lang: 'es', name: 'Español' }, { id: 'aiko', lang: 'ja', name: '日本語' }
];
const out = { opacity: 0, y: -4, filter: 'blur(6px)', transition: { duration: 0.45, ease: EASE.in } };

export function TranslateScene() {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const [take, setTake] = useState(0);
  useSceneLoop(stage, async (c) => {
    for (;;) {
      await c.sleep(2600);
      setTake((t) => t + 1);
      await c.sleep(3400);
    }
  }, !reduce);
  const sent = SENTENCES[take % SENTENCES.length] ?? SENTENCES[0];
  const still = take === 0;
  return (
    <SceneFrame>
      <Fit width={1180} height={560} stageRef={stage} label="Priya speaks Hindi; three listeners read her words in English, Spanish and Japanese">
        <div className="lp-scene">
          <div className="lp-tile" style={box([40, 40, 520, 480])}><CallTile person={CAST.priya} name="Priya" speaking /></div>
          <div className="lp-orig">
            <Caption who={<><Avatar person={CAST.priya} size={18} />Priya</>} lang="HINDI">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={take} className="block" initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={out} transition={{ duration: 0.6, ease: EASE.out }}>{sent.hi}</motion.span>
              </AnimatePresence>
            </Caption>
          </div>
          {LISTENERS.map((l, j) => {
            const ja = l.lang === 'ja';
            return (
              <div key={l.id} className="lp-lst" style={box([600, 40 + j * 164, 540, 148])}>
                <div className="who"><Avatar person={CAST[l.id]} size={22} /><b>{firstOf(l.id)}</b> hears<Chip icon="translate">{l.name}</Chip></div>
                <div className="ac-caption">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p key={take} exit={out}>
                      <WriteIn chunks={ja ? sent.ja.split('|') : words(sent[l.lang])} joiner={ja ? '' : ' '} step={ja ? 0.22 : 0.09} delay={0.35 + j * 0.12} blur={5} still={still} />
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </Fit>
    </SceneFrame>
  );
}
